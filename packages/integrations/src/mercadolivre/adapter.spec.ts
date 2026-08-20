import { MercadoLivreAdapter } from "./adapter";

describe("MercadoLivreAdapter", () => {
  it("should map /highlights fixture to CanonicalOffer", () => {
    // Fake mock fixture loosely based on Meli API response for items
    const fixture = {
      id: "MLB123456789",
      title: "Smartphone Test",
      price: 1999.99,
      original_price: 2500.0,
      currency_id: "BRL",
      permalink: "https://produto.mercadolivre.com.br/MLB-123456789-smartphone",
      secure_thumbnail: "https://http2.mlstatic.com/D_NQ_NP_123.jpg",
      shipping: {
        free_shipping: true,
      },
      seller_id: 987654321,
      official_store_id: 123,
      sold_quantity: 500,
    };

    const offer = MercadoLivreAdapter.toCanonicalOffer(fixture);

    expect(offer.marketplace).toBe("MERCADO_LIVRE");
    expect(offer.externalOfferId).toBe("MLB123456789");
    expect(offer.pricing.currentPriceCents).toBe(199999);
    expect(offer.pricing.originalPriceCents).toBe(250000);
    // (1 - (1999.99 / 2500)) = 0.200004 -> 2000 bps
    expect(offer.pricing.discountBps).toBeCloseTo(2000, -1);
    expect(offer.shipping.isFree).toBe(true);
    expect(offer.seller.externalId).toBe("987654321");
    expect(offer.seller.isOfficial).toBe(true);
    expect(offer.metrics.marketplaceSalesCount).toBe(500);

    // Crucial rule: commission must be undefined/null if Meli API doesn't provide it
    expect(offer.commission.estimatedAmountCents).toBeUndefined();
    expect(offer.commission.rateBps).toBeUndefined();
  });
});
