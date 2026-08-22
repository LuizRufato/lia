import { CanonicalOffer } from "../models/CanonicalOffer";
import { DeduplicationRule } from "./DeduplicationRule";

const offerAt = (price: number): CanonicalOffer => ({
  marketplace: "SHOPEE",
  externalOfferId: "offer-1",
  canonicalUrl: "https://example.com/offer-1",
  sourceUrl: "https://example.com/offer-1",
  currency: "BRL",
  product: { title: "Produto", images: [], normalizedCategory: "smartphones" },
  pricing: { currentPriceCents: price },
  shipping: { isFree: null },
  commission: { estimatedAmountCents: null, source: "UNKNOWN" },
  metrics: { rating: null, reviewsCount: null, marketplaceSalesCount: null },
  seller: { isOfficial: null },
  discoveredAt: new Date(),
});

describe("DeduplicationRule", () => {
  const rule = new DeduplicationRule({ priceDropBpsThreshold: 500 });

  it("accepts the first observation and rejects an unchanged offer", () => {
    expect(rule.isDuplicate(offerAt(1000), null)).toBe(false);
    expect(rule.isDuplicate(offerAt(1000), 1000)).toBe(true);
  });

  it("rejects a small drop but accepts a significant drop", () => {
    expect(rule.isDuplicate(offerAt(990), 1000)).toBe(true);
    expect(rule.isDuplicate(offerAt(800), 990)).toBe(false);
  });

  it("allows a previously rejected offer after a meaningful later drop", () => {
    const history = [1000, 990, 800];
    expect(rule.isDuplicate(offerAt(history[0]), null)).toBe(false);
    expect(rule.isDuplicate(offerAt(history[1]), history[0])).toBe(true);
    expect(rule.isDuplicate(offerAt(history[2]), history[1])).toBe(false);
  });
});
