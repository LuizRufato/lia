import { LiaScoreV1 } from "./LiaScoreV1";
import { CanonicalOffer } from "../models/CanonicalOffer";

describe("LiaScoreV1", () => {
  let scorer: LiaScoreV1;

  beforeEach(() => {
    scorer = new LiaScoreV1();
  });

  const baseOffer: CanonicalOffer = {
    marketplace: "SHOPEE",
    externalOfferId: "123",
    canonicalUrl: "http://test.com",
    sourceUrl: "http://test.com",
    currency: "BRL",
    product: {
      title: "Test",
      images: [],
    },
    pricing: {
      currentPriceCents: 10000,
      discountBps: 1000, // 10%
    },
    shipping: {
      isFree: true,
    },
    commission: {
      estimatedAmountCents: 1000, // R$ 10
      rateBps: 1000, // 10%
      source: "CALCULATED",
    },
    metrics: {
      rating: 4.8,
      reviewsCount: 500,
      marketplaceSalesCount: 1000,
    },
    seller: {
      isOfficial: true,
    },
    discoveredAt: new Date(),
  };

  it("should evaluate a fully populated offer to 1.0 coverage and predictable score", () => {
    const result = scorer.evaluate(baseOffer);
    expect(result.dataCoverage).toBe(1.0);
    expect(result.absentComponents.length).toBe(0);
    expect(result.finalScore).toBeGreaterThan(0);
    expect(result.finalScore).toBeLessThanOrEqual(100);
  });

  it("should handle absent metrics by redistributing weights", () => {
    const incompleteOffer = {
      ...baseOffer,
      metrics: {
        rating: null,
        reviewsCount: null,
        marketplaceSalesCount: null,
      },
      seller: {
        isOfficial: null,
      },
    };
    const result = scorer.evaluate(incompleteOffer);

    // Trust and Demand will be null since metrics/seller data is null
    expect(result.absentComponents).toContain("trust");
    expect(result.absentComponents).toContain("demand");
    expect(result.dataCoverage).toBe(0.75); // 3 out of 5 components, weighted by their raw weights (35 + 25 + 15 = 75%)

    // Original weights: 35 + 25 + 15(Trust) + 15 + 10(Demand)
    // Remaining weights: 35, 25, 15 => sum = 75
    // New effective weights: (35/75)*100, (25/75)*100, (15/75)*100
  });

  it("should produce identical scores for identical inputs (deterministic)", () => {
    const result1 = scorer.evaluate(baseOffer);
    const result2 = scorer.evaluate(baseOffer);
    expect(result1.finalScore).toEqual(result2.finalScore);
  });

  it("should score an offer with high absolute commission appropriately without blowing up", () => {
    const richOffer = {
      ...baseOffer,
      commission: {
        estimatedAmountCents: 500000, // R$ 5000 (over the cap of R$ 150)
        rateBps: 2000,
        source: "CALCULATED" as const,
      },
    };
    const result = scorer.evaluate(richOffer);
    // It should hit the cap
    expect(result.componentScores.financialValue).toBe(100);
    expect(result.finalScore).toBeLessThanOrEqual(100);
  });
});
