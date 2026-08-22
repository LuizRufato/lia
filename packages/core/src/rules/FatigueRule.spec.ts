import { CanonicalOffer } from "../models/CanonicalOffer";
import { FatigueRule } from "./FatigueRule";

const offer: CanonicalOffer = {
  marketplace: "SHOPEE",
  externalOfferId: "offer-1",
  canonicalUrl: "https://example.com/offer-1",
  sourceUrl: "https://example.com/offer-1",
  currency: "BRL",
  product: {
    title: "Smartphone",
    images: [],
    normalizedCategory: "smartphones",
  },
  pricing: { currentPriceCents: 80000 },
  shipping: { isFree: null },
  commission: { estimatedAmountCents: null, source: "UNKNOWN" },
  metrics: { rating: null, reviewsCount: null, marketplaceSalesCount: null },
  seller: { isOfficial: null },
  discoveredAt: new Date(),
};

describe("FatigueRule", () => {
  const rule = new FatigueRule({ maxCategoryPublicationsPerWindow: 3 });

  it("fatigues at the configured limit and remains fatigued above it", () => {
    expect(rule.isFatigued(offer, 2)).toBe(false);
    expect(rule.isFatigued(offer, 3)).toBe(true);
    expect(rule.isFatigued(offer, 4)).toBe(true);
  });
});
