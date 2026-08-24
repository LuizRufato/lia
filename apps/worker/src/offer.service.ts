import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import {
  CanonicalOffer,
  DeduplicationRule,
  FatigueRule,
  firstHttpsImageUrl,
  LiaScoreV1,
} from '@lia/core';

const SCORE_VERSION = 'lia-score-v1';
const FATIGUE_WINDOW_MS = 12 * 60 * 60 * 1000;

@Injectable()
export class OfferService {
  private readonly logger = new Logger(OfferService.name);
  private readonly scorer = new LiaScoreV1();
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
    const breakdown = this.scorer.evaluate(canonicalOffer);

    const decision = await this.prisma.$transaction(async (tx) => {
      const previousHistory = await tx.priceHistory.findMany({
        where: { offerId: observation.offerId },
        orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }],
        take: 20,
      });
      const previousSnapshot = previousHistory.find(
        (snapshot) => snapshot.observationId !== observation.id,
      );
      const previousPrice = previousSnapshot?.priceCents ?? null;

      const category =
        canonicalOffer.product.normalizedCategory ||
        canonicalOffer.product.sourceCategory ||
        null;

      let nextDecision: string = 'ELIGIBLE';
      let reasons: string[] = ['Offer is eligible for publication'];

      if (canonicalOffer.marketplace === 'MERCADO_LIVRE') {
        nextDecision = 'REJECTED_MARKETPLACE_POLICY';
        reasons = ['Mercado Livre permanece em ingestão somente até a calibração do score e monetização.'];
      } else if (this.dedupRule.isDuplicate(canonicalOffer, previousPrice)) {
        nextDecision = 'REJECTED_DUPLICATE';
        reasons = ['No significant price drop'];
      } else if (breakdown.dataCoverage < 0.6) {
        nextDecision = 'REJECTED_INSUFFICIENT_DATA';
        reasons = ['Not enough data signals'];
      } else if (breakdown.finalScore < 40) {
        nextDecision = 'REJECTED_LOW_SCORE';
        reasons = ['Score below threshold'];
      } else if (category) {
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
            scoreVersion: SCORE_VERSION,
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
          scoreVersion: SCORE_VERSION,
          score: breakdown.finalScore,
          decision: nextDecision as any,
          decisionReasons: reasons,
          scoreBreakdown: breakdown as any,
          inputsSnapshot: observation.canonicalPayload as any,
        },
      });

      if (nextDecision === 'ELIGIBLE') {
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
}
