import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import {
  CanonicalOffer,
  LiaScoreV1,
  DeduplicationRule,
  FatigueRule,
} from '@lia/core';

@Injectable()
export class OfferService {
  private readonly logger = new Logger(OfferService.name);
  private scorer = new LiaScoreV1();
  private dedupRule = new DeduplicationRule({ priceDropBpsThreshold: 500 });
  private fatigueRule = new FatigueRule({
    maxCategoryPublicationsPerWindow: 3,
  });

  constructor(private readonly prisma: PrismaService) {}

  public clock = () => Date.now();

  async processObservation(observationId: string) {
    this.logger.log(`Processing observation ${observationId}`);

    // 1. Load Observation
    const observation = await this.prisma.offerObservation.findUnique({
      where: { id: observationId },
      include: { offer: true },
    });

    if (!observation) {
      this.logger.error(`Observation ${observationId} not found`);
      return;
    }

    const payload = observation.canonicalPayload as any;
    // Assume it is already validated by ingestion, but we can cast it
    const canonicalOffer = payload as CanonicalOffer;

    // 3. Score
    const breakdown = this.scorer.evaluate(canonicalOffer);

    // 2. Load latest state for Dedup
    const prevEvalsCount = await this.prisma.offerEvaluation.count({
      where: { observation: { offerId: observation.offerId } },
    });

    if (prevEvalsCount > 0) {
      const lastPriceHistory = await this.prisma.priceHistory.findFirst({
        where: { offerId: observation.offerId },
        orderBy: { createdAt: 'desc' },
      });
      const lastPrice = lastPriceHistory
        ? lastPriceHistory.priceCents
        : observation.offer.price;

      const isDup = this.dedupRule.isDuplicate(canonicalOffer, lastPrice);
      if (isDup) {
        await this.saveEvaluation(
          observation,
          'REJECTED_DUPLICATE',
          breakdown.finalScore,
          ['No significant price drop'],
          breakdown,
        );
        return;
      }
    }

    if (breakdown.dataCoverage < 0.6) {
      await this.saveEvaluation(
        observation,
        'REJECTED_INSUFFICIENT_DATA',
        breakdown.finalScore,
        ['Not enough data signals'],
        breakdown,
      );
      return;
    }

    if (breakdown.finalScore < 40) {
      await this.saveEvaluation(
        observation,
        'REJECTED_LOW_SCORE',
        breakdown.finalScore,
        ['Score below threshold'],
        breakdown,
      );
      return;
    }

    // 4. Fatigue
    const cat =
      canonicalOffer.product.normalizedCategory ||
      canonicalOffer.product.sourceCategory;
    let categoryCount = 0;

    // In V1, count how many publications recently for this tenant/marketplace/category (approximated here)
    if (cat) {
      const recent = await this.prisma.publicationCandidate.count({
        where: {
          createdAt: { gte: new Date(this.clock() - 12 * 60 * 60 * 1000) }, // 12 hours
          status: { in: ['PENDING', 'QUEUED'] },
          evaluation: {
            observation: {
              offer: { tenantId: observation.offer.tenantId },
              category: cat,
            },
          },
        },
      });
      categoryCount = recent;
    }

    if (this.fatigueRule.isFatigued(canonicalOffer, categoryCount)) {
      await this.saveEvaluation(
        observation,
        'REJECTED_FATIGUE',
        breakdown.finalScore,
        [`Category fatigue reached: ${categoryCount}`],
        breakdown,
      );
      return;
    }

    // 5. Eligible!
    const evaluation = await this.saveEvaluation(
      observation,
      'ELIGIBLE',
      breakdown.finalScore,
      ['Offer is eligible for publication'],
      breakdown,
    );

    // Create PublicationCandidate (PENDING)
    await this.prisma.publicationCandidate.create({
      data: {
        evaluationId: evaluation.id,
        status: 'PENDING',
      },
    });

    // Update the Offer with latest data
    await this.prisma.offer.update({
      where: { id: observation.offerId },
      data: {
        title: canonicalOffer.product.title,
        price: canonicalOffer.pricing.currentPriceCents,
        commission: canonicalOffer.commission.estimatedAmountCents ?? 0,
        url: canonicalOffer.canonicalUrl,
      },
    });

    // Save PriceHistory
    await this.prisma.priceHistory.create({
      data: {
        offerId: observation.offerId,
        priceCents: canonicalOffer.pricing.currentPriceCents,
        discountBps: canonicalOffer.pricing.discountBps ?? null,
      },
    });

    this.logger.log(
      `Offer ${observation.offerId} became ELIGIBLE! Candidate PENDING.`,
    );
  }

  private async saveEvaluation(
    observation: any,
    decision: any,
    score: number,
    reasons: string[],
    breakdown?: any,
  ) {
    return this.prisma.offerEvaluation.create({
      data: {
        observationId: observation.id,
        scoreVersion: breakdown?.scoreVersion || 'lia-score-v1',
        score: score,
        decision: decision,
        decisionReasons: reasons,
        scoreBreakdown: breakdown || {},
        inputsSnapshot: observation.canonicalPayload,
      },
    });
  }
}
