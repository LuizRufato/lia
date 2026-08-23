import { CanonicalOffer } from "@lia/core";
import { ShopeeProductOfferItemV2 } from "./shopee.types";
import Decimal from "decimal.js";

export class ShopeeAdapter {
  public static toCanonicalOffer(
    item: ShopeeProductOfferItemV2,
  ): CanonicalOffer {
    // Price conversion (BRL string -> cents)
    // E.g. "55.99" -> 5599
    const currentPriceCents = new Decimal(item.priceMin || "0")
      .mul(100)
      .toNumber();
    const priceMaxCents = new Decimal(item.priceMax || "0").mul(100).toNumber();

    // Commission amount (BRL string -> cents)
    const estimatedAmountCents = Math.round(
      new Decimal(item.commission || "0").mul(100).toNumber(),
    );

    // Discount rate (Number -> bps)
    // E.g. 10 -> 1000 bps
    const discountBps = Math.round((item.priceDiscountRate || 0) * 100);

    // Commission rate (String -> bps)
    // E.g. "0.25" -> 25% -> 2500 bps
    // E.g. "0.0123" -> 1.23% -> 123 bps
    const commissionRateBps = new Decimal(item.commissionRate || "0")
      .mul(10000)
      .toNumber();

    // These are real signals returned by Shopee's product-offer API.  Keep
    // invalid or missing values absent instead of manufacturing a fallback:
    // the score engine will then apply its normal data-coverage rules.
    const rating =
      Number.isFinite(item.ratingStar) && item.ratingStar >= 0 && item.ratingStar <= 5
        ? item.ratingStar
        : undefined;
    const marketplaceSalesCount =
      Number.isFinite(item.sales) && Number.isInteger(item.sales) && item.sales >= 0
        ? item.sales
        : undefined;

    return {
      externalOfferId: item.itemId.toString(),
      externalProductId: item.itemId.toString(),
      marketplace: "SHOPEE",
      currency: "BRL",
      sourceUrl: item.productLink,
      product: {
        title: item.productName,
        images: [item.imageUrl],
        sourceCategory:
          item.productCatIds?.length > 0
            ? item.productCatIds.join(",")
            : undefined,
      },
      pricing: {
        currentPriceCents,
        originalPriceCents: null, // "Não inventar originalPrice"
        discountBps,
      },
      commission: {
        estimatedAmountCents,
        rateBps: commissionRateBps,
        source: "API",
      },
      seller: {
        externalId: item.shopId?.toString(),
        name: item.shopName,
        isOfficial: item.shopType?.includes(1) || false,
      },
      canonicalUrl: item.productLink,
      shipping: {},
      metrics: {
        ...(rating === undefined ? {} : { rating }),
        ...(marketplaceSalesCount === undefined ? {} : { marketplaceSalesCount }),
      },
      discoveredAt: new Date(),
      rawObservation: {
        priceMax: priceMaxCents,
        offerLink: item.offerLink,
        sales: item.sales,
        ratingStar: item.ratingStar,
        periodStartTime: item.periodStartTime,
        periodEndTime: item.periodEndTime,
      },
    };
  }
}
