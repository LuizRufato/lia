import { CanonicalOffer } from "@lia/core";

export class MercadoLivreAdapter {
  static toCanonicalOffer(item: any): CanonicalOffer {
    const isFreeShipping = item.shipping?.free_shipping;

    // Meli returns prices in decimal (e.g. 19.99)
    const currentPriceCents =
      item.price != null ? Math.round(item.price * 100) : undefined;
    const originalPriceCents =
      item.original_price != null
        ? Math.round(item.original_price * 100)
        : undefined;

    let discountBps: number | undefined;
    if (
      currentPriceCents != null &&
      originalPriceCents != null &&
      originalPriceCents > 0 &&
      originalPriceCents > currentPriceCents
    ) {
      discountBps = Math.round(
        (1 - currentPriceCents / originalPriceCents) * 10000,
      );
    }

    return {
      marketplace: "MERCADO_LIVRE",
      externalOfferId: item.id,
      canonicalUrl: item.permalink || "",
      sourceUrl: item.permalink || "",
      currency: item.currency_id || "BRL",
      product: {
        title: item.title || "",
        images:
          item.pictures?.map((p: any) => p.secure_url) ||
          [item.secure_thumbnail].filter(Boolean),
      },
      pricing: {
        currentPriceCents: currentPriceCents ?? 0,
        originalPriceCents,
        discountBps,
      },
      shipping: {
        isFree: isFreeShipping != null ? isFreeShipping : undefined,
      },
      commission: {
        // Commission is NULL because Meli doesn't expose it on the standard Catalog API
        source: "UNKNOWN",
        estimatedAmountCents: undefined,
        rateBps: undefined,
      },
      metrics: {
        // To be fetched from /users/{userId} if needed, or /reviews
        rating: undefined,
        reviewsCount: undefined,
        marketplaceSalesCount:
          item.sold_quantity != null ? item.sold_quantity : undefined,
      },
      seller: {
        externalId: item.seller_id ? String(item.seller_id) : undefined,
        isOfficial: item.official_store_id != null ? true : undefined,
      },
      discoveredAt: new Date(),
    };
  }
}
