import { CanonicalOffer } from "../models/CanonicalOffer";

export const MERCADO_LIVRE_SCORE_CONFIG = {
  version: "lia-score-ml-v1",
  weights: {
    dealQuality: 25,
    demand: 20,
    trust: 20,
    sellerReputation: 15,
    ranking: 10,
    completeness: 10,
  },
} as const;

export interface MercadoLivreScoreBreakdown {
  scoreVersion: string;
  dataCoverage: number;
  availableComponents: string[];
  absentComponents: string[];
  originalWeights: Record<string, number>;
  effectiveWeights: Record<string, number>;
  componentScores: Record<string, number | null>;
  componentContributions: Record<string, number>;
  finalScore: number;
}

/**
 * Mercado Livre has no affiliate commission API. This profile deliberately
 * excludes commission and normalizes only real marketplace signals.
 */
export class MercadoLivreScoreProfile {
  evaluate(offer: CanonicalOffer): MercadoLivreScoreBreakdown {
    const scores = this.components(offer);
    const weights = MERCADO_LIVRE_SCORE_CONFIG.weights;
    const available = Object.entries(scores).filter(
      ([, value]) => value != null,
    );
    const availableWeight = available.reduce(
      (sum, [key]) => sum + weights[key as keyof typeof weights],
      0,
    );
    const totalWeight = Object.values(weights).reduce(
      (sum, value) => sum + value,
      0,
    );
    const dataCoverage = totalWeight ? availableWeight / totalWeight : 0;
    const contributions: Record<string, number> = {};
    const effectiveWeights: Record<string, number> = {};
    let rawScore = 0;

    for (const [key, value] of available) {
      const originalWeight = weights[key as keyof typeof weights];
      const effectiveWeight = availableWeight
        ? (originalWeight / availableWeight) * 100
        : 0;
      effectiveWeights[key] = Number(effectiveWeight.toFixed(4));
      contributions[key] = Number(
        (((value as number) * effectiveWeight) / 100).toFixed(4),
      );
      rawScore += contributions[key];
    }

    return {
      scoreVersion: MERCADO_LIVRE_SCORE_CONFIG.version,
      dataCoverage: Number(dataCoverage.toFixed(4)),
      availableComponents: available.map(([key]) => key),
      absentComponents: Object.keys(scores).filter(
        (key) => scores[key] == null,
      ),
      originalWeights: { ...weights },
      effectiveWeights,
      componentScores: scores,
      componentContributions: contributions,
      finalScore: Number(Math.min(Math.max(rawScore, 0), 100).toFixed(2)),
    };
  }

  private components(offer: CanonicalOffer): Record<string, number | null> {
    const discount = offer.pricing.discountBps;
    const sales = offer.metrics.marketplaceSalesCount;
    const rating = offer.metrics.rating;
    const reviews = offer.metrics.reviewsCount;
    const seller = offer.seller;
    const ranking = offer.discovery?.rankingPosition;
    const reputation = seller.reputationLevel;
    const completed = seller.completedTransactions;
    const canceled = seller.canceledTransactions;

    const trustValues = [
      seller.isOfficial == null ? null : seller.isOfficial ? 100 : 50,
      rating == null ? null : (rating / 5) * 100,
      reviews == null ? null : Math.min(Math.sqrt(reviews / 1000) * 100, 100),
    ].filter((value): value is number => value != null);

    const reputationScore = this.reputationScore(
      reputation,
      completed,
      canceled,
    );
    const completenessValues = [
      offer.externalOfferId,
      offer.product.title,
      offer.canonicalUrl,
      offer.currency,
      offer.product.images.length ? true : null,
      offer.pricing.currentPriceCents >= 0 ? true : null,
      offer.seller.externalId,
    ];

    return {
      dealQuality:
        discount == null
          ? null
          : Math.min(Math.sqrt(discount / 10000) * 100, 100),
      demand:
        sales == null ? null : Math.min(Math.sqrt(sales / 5000) * 100, 100),
      trust: trustValues.length
        ? trustValues.reduce((sum, value) => sum + value, 0) /
          trustValues.length
        : null,
      sellerReputation: reputationScore,
      ranking: ranking == null ? null : Math.max(0, 100 - (ranking - 1) * 5),
      completeness:
        (completenessValues.filter((value) => value != null).length /
          completenessValues.length) *
        100,
    };
  }

  private reputationScore(
    level: string | null | undefined,
    completed: number | null | undefined,
    canceled: number | null | undefined,
  ): number | null {
    const levelScores: Record<string, number> = {
      "5_green": 100,
      "4_light_green": 90,
      "3_yellow": 65,
      "2_orange": 40,
      "1_red": 20,
    };
    const values: number[] = [];
    if (level && levelScores[level] != null) values.push(levelScores[level]);
    if (completed != null || canceled != null) {
      const total = (completed ?? 0) + (canceled ?? 0);
      values.push(total ? ((completed ?? 0) / total) * 100 : 0);
    }
    return values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
  }
}
