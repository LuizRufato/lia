import { CanonicalOffer } from '../models/CanonicalOffer';
import { LIA_SCORE_V1_CONFIG, ScoreConfig } from './ScoreConfig';

export interface ScoreBreakdown {
  scoreVersion: string;
  dataCoverage: number;
  availableComponents: string[];
  absentComponents: string[];
  originalWeights: Record<string, number>;
  effectiveWeights: Record<string, number>;
  componentScores: Record<string, number>;
  componentContributions: Record<string, number>;
  finalScore: number;
}

export class LiaScoreV1 {
  constructor(private config: ScoreConfig = LIA_SCORE_V1_CONFIG) {}

  evaluate(offer: CanonicalOffer): ScoreBreakdown {
    const scores = this.calculateComponentScores(offer);
    const availableComponents: string[] = [];
    const absentComponents: string[] = [];

    // Identify which components have data
    for (const [key, score] of Object.entries(scores)) {
      if (score !== null) {
        availableComponents.push(key);
      } else {
        absentComponents.push(key);
      }
    }

    const dataCoverage = availableComponents.length / Object.keys(this.config.weights).length;

    // Redistribute weights
    const effectiveWeights: Record<string, number> = {};
    let sumAvailableOriginalWeights = 0;

    for (const comp of availableComponents) {
      sumAvailableOriginalWeights += this.config.weights[comp as keyof typeof this.config.weights];
    }

    for (const comp of availableComponents) {
      const original = this.config.weights[comp as keyof typeof this.config.weights];
      effectiveWeights[comp] = (original / sumAvailableOriginalWeights) * 100;
    }
    
    for (const comp of absentComponents) {
      effectiveWeights[comp] = 0;
    }

    // Calculate final score
    let finalScore = 0;
    const componentContributions: Record<string, number> = {};

    for (const comp of availableComponents) {
      const score = scores[comp as keyof typeof scores] as number;
      const weight = effectiveWeights[comp];
      const contribution = (score * weight) / 100;
      componentContributions[comp] = contribution;
      finalScore += contribution;
    }

    return {
      scoreVersion: this.config.version,
      dataCoverage,
      availableComponents,
      absentComponents,
      originalWeights: this.config.weights,
      effectiveWeights,
      componentScores: scores as any, // Nulls mapped to 0 effectively or kept null in report
      componentContributions,
      finalScore: parseFloat(finalScore.toFixed(2)),
    };
  }

  private calculateComponentScores(offer: CanonicalOffer): Record<keyof ScoreConfig['weights'], number | null> {
    return {
      financialValue: this.calcFinancialValue(offer),
      dealQuality: this.calcDealQuality(offer),
      trust: this.calcTrust(offer),
      fulfillment: this.calcFulfillment(offer),
      demand: this.calcDemand(offer),
    };
  }

  private calcFinancialValue(offer: CanonicalOffer): number | null {
    const absComCents = offer.commission.estimatedAmountCents;
    const rateBps = offer.commission.rateBps;
    
    if (absComCents == null && rateBps == null) {
      return null;
    }

    let score = 0;
    // Logarithmic/capped absolute commission score (Max 50 points)
    if (absComCents != null) {
      const ratio = Math.min(absComCents / this.config.caps.maxCommissionCents, 1);
      // Non-linear: easy to get first points, hard to max out.
      const absScore = Math.pow(ratio, 0.5) * 50; 
      score += absScore;
    } else {
      score += 25; // fallback mid-score for absolute if only rate is known
    }

    // Capped percentage score (Max 50 points)
    if (rateBps != null) {
      const ratio = Math.min(rateBps / this.config.caps.maxCommissionBps, 1);
      const rateScore = ratio * 50; // Linear up to cap
      score += rateScore;
    } else {
      score += 25; 
    }

    return Math.min(Math.max(score, 0), 100);
  }

  private calcDealQuality(offer: CanonicalOffer): number | null {
    const discountBps = offer.pricing.discountBps;
    
    if (discountBps == null) {
      return null; // No history and no announced discount
    }

    // Suppose 10000 bps (100% discount) is max 100 points
    // A 40% discount (4000 bps) gives 63 points via sqrt non-linear
    const ratio = Math.min(discountBps / 10000, 1);
    const score = Math.pow(ratio, 0.5) * 100;
    
    return Math.min(Math.max(score, 0), 100);
  }

  private calcTrust(offer: CanonicalOffer): number | null {
    const { rating, reviewsCount } = offer.metrics;
    const { isOfficial } = offer.seller;

    if (rating == null && reviewsCount == null && isOfficial == null) {
      return null;
    }

    let score = 0;

    // isOfficial gives flat 30 points
    if (isOfficial === true) {
      score += 30;
    }

    // Rating gives up to 50 points
    if (rating != null) {
      score += (rating / 5) * 50;
    } else {
      // If we only know it's official, or only have reviewsCount, assume average 4.0
      score += 40; 
    }

    // Reviews count gives up to 20 points (cap at 1000 reviews)
    if (reviewsCount != null) {
      const ratio = Math.min(reviewsCount / 1000, 1);
      score += ratio * 20;
    } else {
      score += 10;
    }

    return Math.min(Math.max(score, 0), 100);
  }

  private calcFulfillment(offer: CanonicalOffer): number | null {
    const { isFree, costCents } = offer.shipping;

    if (isFree == null && costCents == null) {
      return null;
    }

    if (isFree === true || costCents === 0) {
      return 100;
    }

    if (costCents != null) {
      // High cost penalizes. e.g. R$ 50 (5000 cents) = 0 points
      const maxCost = 5000;
      const ratio = Math.max(0, 1 - (costCents / maxCost));
      return ratio * 100;
    }

    // Default if only know it's not free but don't know the cost
    return 30;
  }

  private calcDemand(offer: CanonicalOffer): number | null {
    const sales = offer.metrics.marketplaceSalesCount;
    if (sales == null) {
      return null;
    }

    // Cap at 5000 sales
    const ratio = Math.min(sales / 5000, 1);
    const score = Math.pow(ratio, 0.5) * 100;
    
    return Math.min(Math.max(score, 0), 100);
  }
}
