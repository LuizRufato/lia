import { ShopeeAdapter } from "./shopee.adapter";
import { ShopeeProductOfferItemV2 } from "./shopee.types";

describe("ShopeeAdapter", () => {
  it("should convert priceDiscountRate to discountBps (10 -> 1000)", () => {
    const item = {
      itemId: 123,
      productName: "Test",
      priceDiscountRate: 10,
    } as ShopeeProductOfferItemV2;

    const offer = ShopeeAdapter.toCanonicalOffer(item);
    expect(offer.pricing.discountBps).toBe(1000);
  });

  it('should convert commissionRate to commissionRateBps ("0.25" -> 2500, "0.0123" -> 123)', () => {
    const item1 = {
      itemId: 1,
      productName: "Test",
      commissionRate: "0.25",
    } as ShopeeProductOfferItemV2;
    const item2 = {
      itemId: 2,
      productName: "Test",
      commissionRate: "0.0123",
    } as ShopeeProductOfferItemV2;

    const offer1 = ShopeeAdapter.toCanonicalOffer(item1);
    expect(offer1.commission.rateBps).toBe(2500);

    const offer2 = ShopeeAdapter.toCanonicalOffer(item2);
    expect(offer2.commission.rateBps).toBe(123);
  });

  it("should parse shopType array correctly to isOfficial flag", () => {
    const cases = [
      { shopType: [], expected: false },
      { shopType: [2], expected: false },
      { shopType: [1], expected: true },
      { shopType: [1, 4], expected: true },
    ];

    for (const c of cases) {
      const item = {
        itemId: 1,
        productName: "Test",
        shopType: c.shopType,
      } as ShopeeProductOfferItemV2;
      const offer = ShopeeAdapter.toCanonicalOffer(item);
      expect(offer.seller?.isOfficial).toBe(c.expected);
    }
  });

  it("should convert money strings to cents using Decimal (BRL -> Cents)", () => {
    const item = {
      itemId: 1,
      productName: "Test",
      priceMin: "55.99",
      priceMax: "27000",
      commission: "45.99",
    } as ShopeeProductOfferItemV2;

    const offer = ShopeeAdapter.toCanonicalOffer(item);
    expect(offer.pricing.currentPriceCents).toBe(5599);
    expect(offer.rawObservation?.priceMax).toBe(2700000);
    expect(offer.commission.estimatedAmountCents).toBe(4599);
  });

  it("should preserve nulls correctly", () => {
    const item = {
      itemId: 1,
      productName: "Test",
    } as ShopeeProductOfferItemV2;

    const offer = ShopeeAdapter.toCanonicalOffer(item);
    expect(offer.pricing.originalPriceCents).toBeNull();
    expect(offer.pricing.currentPriceCents).toBe(0);
    expect(offer.commission.estimatedAmountCents).toBe(0);
  });

  it("maps real Shopee rating and sales metrics without inventing fields", () => {
    const offer = ShopeeAdapter.toCanonicalOffer({
      itemId: 1,
      productName: "Test",
      ratingStar: 4.8,
      sales: 1500,
    } as ShopeeProductOfferItemV2);

    expect(offer.metrics.rating).toBe(4.8);
    expect(offer.metrics.marketplaceSalesCount).toBe(1500);
    expect(offer.metrics.reviewsCount).toBeUndefined();
    expect(offer.shipping.isFree).toBeUndefined();
  });

  it("does not persist invalid rating or sales as score metrics", () => {
    const offer = ShopeeAdapter.toCanonicalOffer({
      itemId: 1,
      productName: "Test",
      ratingStar: 6,
      sales: -1,
    } as ShopeeProductOfferItemV2);

    expect(offer.metrics.rating).toBeUndefined();
    expect(offer.metrics.marketplaceSalesCount).toBeUndefined();
  });

  it("preserves the real Shopee image URL in the canonical offer", () => {
    const offer = ShopeeAdapter.toCanonicalOffer({
      itemId: 1,
      productName: "Test",
      imageUrl: "https://cf.shopee.com.br/file/real-image.jpg",
    } as ShopeeProductOfferItemV2);

    expect(offer.product.images).toEqual([
      "https://cf.shopee.com.br/file/real-image.jpg",
    ]);
  });
});
