import { CanonicalOffer } from '../models/CanonicalOffer';

export interface FatigueConfig {
  maxCategoryPublicationsPerWindow: number;
}

export class FatigueRule {
  constructor(private config: FatigueConfig) {}

  /**
   * Evaluates if a newly discovered offer should be rejected due to category fatigue.
   * @param currentOffer The CanonicalOffer being evaluated
   * @param categoryPublicationsInWindow The number of times this category was queued/published recently
   * @returns true if it should be rejected due to fatigue, false otherwise
   */
  isFatigued(currentOffer: CanonicalOffer, categoryPublicationsInWindow: number): boolean {
    if (categoryPublicationsInWindow >= this.config.maxCategoryPublicationsPerWindow) {
      return true;
    }

    return false;
  }
}
