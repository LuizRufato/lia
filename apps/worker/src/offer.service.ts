import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import {
  CanonicalOffer,
  DeduplicationRule,
  FatigueRule,
  firstHttpsImageUrl,
  LiaScoreV1,
  MercadoLivreScoreProfile,
} from '@lia/core';

const SCORE_VERSION = 'lia-score-v1';
const FATIGUE_WINDOW_MS = 12 * 60 * 60 * 1000;
const RECONSIDERATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LIVE_CANDIDATE_STATUSES = [
  'PENDING',
  'DEFERRED',
  'QUEUED',
  'PUBLISHING',
] as const;
const COOLDOWN_PUBLICATION_STATUSES = [
  'PUBLISHED',
  'DELIVERY_UNKNOWN',
] as const;

@Injectable()
export class OfferService {
  private readonly logger = new Logger(OfferService.name);
  private readonly scorer = new LiaScoreV1();
  private readonly mercadoLivreScorer = new MercadoLivreScoreProfile();
  private readonly dedupRule = new DeduplicationRule({
    priceDropBpsThreshold: 500,
  });
  private readonly fatigueRule = new FatigueRule({
    maxCategoryPublicationsPerWindow: 3,
  });

  constructor(private readonly prisma: PrismaService) {}

  public clock = () => Date.now();

  async processObservation(observationId: string) {
    this.logger.log(`Processing observation ${observationId}`);

    const observation = await this.prisma.offerObservation.findUnique({
      where: { id: observationId },
      include: { offer: true },
    });

    if (!observation) {
      this.logger.error(`Observation ${observationId} not found`);
      return;
    }

    const canonicalOffer =
      observation.canonicalPayload as unknown as CanonicalOffer;
    const isMercadoLivre = canonicalOffer.marketplace === 'MERCADO_LIVRE';
    const breakdown = isMercadoLivre
      ? this.mercadoLivreScorer.evaluate(canonicalOffer)
      : this.scorer.evaluate(canonicalOffer);
    const scoreVersion = isMercadoLivre ? 'lia-score-ml-v1' : SCORE_VERSION;

    const decision = await this.prisma.$transaction(async (tx) => {
      // Serialize lifecycle reads and candidate creation per canonical Offer
      // across all Worker processes; PostgreSQL releases this lock on commit.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${observation.offerId}, 0))
      `;

      const previousHistory = await tx.priceHistory.findMany({
        where: { offerId: observation.offerId },
        orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }],
        take: 20,
      });
      const previousSnapshot = previousHistory.find(
        (snapshot) => snapshot.observationId !== observation.id,
      );
      const previousPrice = previousSnapshot?.priceCents ?? null;
      const isDuplicate = this.dedupRule.isDuplicate(
        canonicalOffer,
        previousPrice,
      );

      const category =
        canonicalOffer.product.normalizedCategory ||
        canonicalOffer.product.sourceCategory ||
        null;

      let nextDecision: string = 'ELIGIBLE';
      let reasons: string[] = ['Offer is eligible for publication'];

      if (canonicalOffer.marketplace === 'MERCADO_LIVRE') {
        nextDecision = 'REJECTED_MARKETPLACE_POLICY';
        reasons = [
          'Mercado Livre permanece em ingestão somente até a calibração do score e monetização.',
        ];
      } else if (isDuplicate) {
        if (
          !(await this.canReconsiderDuplicate(
            tx,
            observation,
            previousSnapshot,
            new Date(this.clock()),
          ))
        ) {
          nextDecision = 'REJECTED_DUPLICATE';
          reasons = ['No significant price drop'];
        } else {
          reasons = ['Reconsidered after the previous publication lifecycle'];
        }
      }

      if (nextDecision === 'ELIGIBLE' && breakdown.dataCoverage < 0.6) {
        nextDecision = 'REJECTED_INSUFFICIENT_DATA';
        reasons = ['Not enough data signals'];
      } else if (nextDecision === 'ELIGIBLE' && breakdown.finalScore < 40) {
        nextDecision = 'REJECTED_LOW_SCORE';
        reasons = ['Score below threshold'];
      } else if (nextDecision === 'ELIGIBLE' && category) {
        const categoryCount = await tx.publication.count({
          where: {
            createdAt: {
              gte: new Date(this.clock() - FATIGUE_WINDOW_MS),
            },
            // DELIVERY_UNKNOWN is counted conservatively: the message may
            // have reached the channel even though confirmation is missing.
            status: {
              in: ['PUBLISHED', 'PUBLISHING', 'DELIVERY_UNKNOWN'],
            },
            candidate: {
              evaluation: {
                observation: {
                  category,
                  offer: { tenantId: observation.offer.tenantId },
                },
              },
            },
          },
        });

        if (this.fatigueRule.isFatigued(canonicalOffer, categoryCount)) {
          nextDecision = 'REJECTED_FATIGUE';
          reasons = [`Category fatigue reached: ${categoryCount}`];
        }
      }

      // Every valid observation gets one immutable-by-observation snapshot,
      // including duplicate, low-score and fatigue decisions.
      await tx.priceHistory.upsert({
        where: { observationId: observation.id },
        update: {
          offerId: observation.offerId,
          priceCents: canonicalOffer.pricing.currentPriceCents,
          originalPriceCents: canonicalOffer.pricing.originalPriceCents ?? null,
          discountBps: canonicalOffer.pricing.discountBps ?? null,
          commissionCents:
            canonicalOffer.commission.estimatedAmountCents ?? null,
          salesCount: canonicalOffer.metrics.marketplaceSalesCount ?? null,
          rating: canonicalOffer.metrics.rating ?? null,
          observedAt: observation.observedAt,
        },
        create: {
          offerId: observation.offerId,
          observationId: observation.id,
          priceCents: canonicalOffer.pricing.currentPriceCents,
          originalPriceCents: canonicalOffer.pricing.originalPriceCents ?? null,
          discountBps: canonicalOffer.pricing.discountBps ?? null,
          commissionCents:
            canonicalOffer.commission.estimatedAmountCents ?? null,
          salesCount: canonicalOffer.metrics.marketplaceSalesCount ?? null,
          rating: canonicalOffer.metrics.rating ?? null,
          observedAt: observation.observedAt,
        },
      });

      const evaluation = await tx.offerEvaluation.upsert({
        where: {
          observationId_scoreVersion: {
            observationId: observation.id,
            scoreVersion,
          },
        },
        update: {
          score: breakdown.finalScore,
          decision: nextDecision as any,
          decisionReasons: reasons,
          scoreBreakdown: breakdown as any,
          inputsSnapshot: observation.canonicalPayload as any,
        },
        create: {
          observationId: observation.id,
          scoreVersion,
          score: breakdown.finalScore,
          decision: nextDecision as any,
          decisionReasons: reasons,
          scoreBreakdown: breakdown as any,
          inputsSnapshot: observation.canonicalPayload as any,
        },
      });

      const autopilotMinScore = await this.getAutopilotMinScore(
        tx,
        observation.offer.tenantId,
      );
      if (
        nextDecision === 'ELIGIBLE' &&
        autopilotMinScore != null &&
        breakdown.finalScore >= autopilotMinScore &&
        !(await this.hasLiveCandidate(
          tx,
          observation.offerId,
          autopilotMinScore,
        ))
      ) {
        await tx.publicationCandidate.upsert({
          where: { evaluationId: evaluation.id },
          update: {},
          create: {
            evaluationId: evaluation.id,
            status: 'PENDING',
          },
        });
      }

      // The offer's consolidated state is updated in the same transaction as
      // its evaluation and snapshot, so no half-decision can be persisted.
      const imageUrl = firstHttpsImageUrl(canonicalOffer.product.images);
      await tx.offer.update({
        where: { id: observation.offerId },
        data: {
          title: canonicalOffer.product.title,
          price: canonicalOffer.pricing.currentPriceCents,
          commission: canonicalOffer.commission.estimatedAmountCents ?? null,
          url: canonicalOffer.canonicalUrl,
          ...(imageUrl ? { imageUrl } : {}),
        },
      });

      return nextDecision;
    });

    this.logger.log(
      `Observation ${observation.id} completed with decision ${decision}.`,
    );
    return decision;
  }

  private async hasLiveCandidate(
    tx: any,
    offerId: string,
    minScore: number | null,
  ): Promise<boolean> {
    const candidates = await tx.publicationCandidate.findMany({
      where: {
        status: { in: LIVE_CANDIDATE_STATUSES },
        evaluation: { observation: { offerId } },
      },
      select: { evaluation: { select: { score: true } } },
    });

    return candidates.some((candidate: any) => {
      if (minScore == null) return true;
      const score = candidate.evaluation?.score;
      const numericScore =
        typeof score?.toNumber === 'function'
          ? score.toNumber()
          : Number(score);
      return Number.isFinite(numericScore) && numericScore >= minScore;
    });
  }

  private async getAutopilotMinScore(
    tx: any,
    tenantId: string,
  ): Promise<number | null> {
    const config = await tx.autopilotConfig.findUnique({
      where: { tenantId },
      select: { minScore: true },
    });
    if (config?.minScore == null) return null;

    const minScore = config.minScore;
    const numericScore =
      typeof minScore?.toNumber === 'function'
        ? minScore.toNumber()
        : Number(minScore);
    return Number.isFinite(numericScore) ? numericScore : null;
  }

  private async canReconsiderDuplicate(
    tx: any,
    observation: any,
    previousSnapshot: any,
    now: Date,
  ): Promise<boolean> {
    // Offer is the canonical tenant + marketplace + externalId identity from
    // ingestion; do not use title-only or fuzzy matching for lifecycle state.
    const autopilotMinScore = await this.getAutopilotMinScore(
      tx,
      observation.offer.tenantId,
    );
    if (
      await this.hasLiveCandidate(tx, observation.offerId, autopilotMinScore)
    ) {
      return false;
    }

    const policy = await tx.autopilotCatalogPolicy.findFirst({
      where: { autopilotConfig: { tenantId: observation.offer.tenantId } },
      select: { productCooldownHours: true },
    });
    const publications = (await tx.publication.findMany({
      where: {
        status: { in: COOLDOWN_PUBLICATION_STATUSES },
        candidate: {
          evaluation: { observation: { offerId: observation.offerId } },
        },
      },
      select: { publishedAt: true, createdAt: true },
    })) as Array<{ publishedAt: Date | null; createdAt: Date }>;
    const latestPublicationAt = publications.reduce(
      (latest: number | null, publication) => {
        const publishedAt = publication.publishedAt ?? publication.createdAt;
        if (!publishedAt) return latest;
        const timestamp = new Date(publishedAt).getTime();
        if (!Number.isFinite(timestamp) || timestamp > now.getTime()) {
          return latest;
        }
        return latest == null ? timestamp : Math.max(latest, timestamp);
      },
      null,
    );

    if (latestPublicationAt != null) {
      const cooldownHours = policy?.productCooldownHours;
      if (
        cooldownHours != null &&
        latestPublicationAt + cooldownHours * 60 * 60 * 1000 > now.getTime()
      ) {
        return false;
      }
      return true;
    }

    const terminalCandidates = (await tx.publicationCandidate.findMany({
      where: {
        status: { notIn: LIVE_CANDIDATE_STATUSES },
        evaluation: { observation: { offerId: observation.offerId } },
      },
      select: { createdAt: true, updatedAt: true },
    })) as Array<{ createdAt: Date; updatedAt: Date }>;
    const latestTerminalAt = terminalCandidates.reduce(
      (latest: number | null, candidate) => {
        const lifecycleAt = candidate.updatedAt ?? candidate.createdAt;
        if (!lifecycleAt) return latest;
        const timestamp = new Date(lifecycleAt).getTime();
        if (!Number.isFinite(timestamp)) return latest;
        return latest == null ? timestamp : Math.max(latest, timestamp);
      },
      null,
    );
    const previousObservedAt = previousSnapshot?.observedAt ?? null;
    const reconsiderationAnchor = latestTerminalAt ?? previousObservedAt;
    if (!reconsiderationAnchor) return false;

    return (
      (typeof reconsiderationAnchor === 'number'
        ? reconsiderationAnchor
        : new Date(reconsiderationAnchor).getTime()) +
        RECONSIDERATION_INTERVAL_MS <=
      now.getTime()
    );
  }
}
