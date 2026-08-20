import { CanonicalOffer } from "../models/CanonicalOffer";

export interface DeduplicationConfig {
  priceDropBpsThreshold: number; // e.g., 500 = 5%
}

export class DeduplicationRule {
  constructor(private config: DeduplicationConfig) {}

  /**
   * Evaluates if a newly discovered offer should be rejected as a duplicate.
   * @param currentOffer The newly discovered CanonicalOffer
   * @param lastKnownPriceCents The price we have currently consolidated in the DB
   * @returns true if it's a duplicate and should be rejected, false if it's a new event (e.g. price drop)
   */
  isDuplicate(
    currentOffer: CanonicalOffer,
    lastKnownPriceCents: number | null,
  ): boolean {
    if (lastKnownPriceCents == null) {
      // Never seen this product, not a duplicate
      return false;
    }

    const currentPrice = currentOffer.pricing.currentPriceCents;

    // If current price is higher or equal, it's not a price drop, so it's a duplicate
    if (currentPrice >= lastKnownPriceCents) {
      return true;
    }

    // Calculate percentage drop
    const dropBps =
      ((lastKnownPriceCents - currentPrice) / lastKnownPriceCents) * 10000;

    if (dropBps >= this.config.priceDropBpsThreshold) {
      // It's a significant price drop, let it pass (not a duplicate)
      return false;
    }

    // Drop wasn't big enough, treat as duplicate
    return true;
  }
}
