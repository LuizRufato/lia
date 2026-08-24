import { MercadoLivreScoreProfile } from "./MercadoLivreScore";
import { CanonicalOffer } from "../models/CanonicalOffer";

const offer = (overrides: Partial<CanonicalOffer> = {}): CanonicalOffer => ({
  marketplace: "MERCADO_LIVRE",
  externalOfferId: "MLB-1",
  canonicalUrl: "https://produto.mercadolivre.com.br/MLB-1",
  sourceUrl: "https://produto.mercadolivre.com.br/MLB-1",
  currency: "BRL",
  product: {
    title: "Oferta",
    images: ["https://http2.mlstatic.com/image.jpg"],
    sourceCategory: "MLB1000",
  },
  pricing: {
    currentPriceCents: 1000,
    originalPriceCents: 1500,
    discountBps: 3333,
  },
  shipping: { isFree: true },
  commission: { source: "UNKNOWN" },
  metrics: { marketplaceSalesCount: 100, reviewsCount: 100, rating: 4.5 },
  seller: {
    externalId: "seller-1",
    isOfficial: true,
    reputationLevel: "5_green",
    completedTransactions: 100,
    canceledTransactions: 1,
  },
  discovery: {
    source: "HIGHLIGHTS",
    sourceCategoryId: "MLB1000",
    rankingPosition: 1,
    sourceEntityType: "ITEM",
  },
  discoveredAt: new Date(),
  ...overrides,
});

describe("MercadoLivreScoreProfile", () => {
  it("normalizes real ML signals to 0..100 and excludes commission", () => {
    const breakdown = new MercadoLivreScoreProfile().evaluate(offer());
    expect(breakdown.scoreVersion).toBe("lia-score-ml-v1");
    expect(breakdown.finalScore).toBeGreaterThanOrEqual(0);
    expect(breakdown.finalScore).toBeLessThanOrEqual(100);
    expect(breakdown.availableComponents).not.toContain("commission");
    expect(breakdown.componentScores.dealQuality).toBeGreaterThan(0);
  });

  it("does not fabricate unavailable signals", () => {
    const breakdown = new MercadoLivreScoreProfile().evaluate(
      offer({
        pricing: { currentPriceCents: 1000 },
        metrics: {},
        seller: {},
        discovery: undefined,
      }),
    );
    expect(breakdown.componentScores.dealQuality).toBeNull();
    expect(breakdown.componentScores.demand).toBeNull();
    expect(breakdown.finalScore).toBeGreaterThanOrEqual(0);
  });
});
