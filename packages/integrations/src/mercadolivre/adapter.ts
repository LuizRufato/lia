import { CanonicalOffer } from "@lia/core";

export interface MercadoLivreAdapterOverrides {
  currentPriceCents?: number;
  originalPriceCents?: number;
  rating?: number;
  reviewsCount?: number;
  seller?: {
    reputationLevel?: string;
    completedTransactions?: number;
    canceledTransactions?: number;
  };
  discovery?: {
    source: "HIGHLIGHTS" | "TRENDS";
    sourceCategoryId?: string;
    rankingPosition?: number;
    sourceEntityType: "ITEM" | "PRODUCT" | "USER_PRODUCT";
  };
}

export class MercadoLivreAdapter {
  static toCanonicalOffer(
    item: any,
    overrides: MercadoLivreAdapterOverrides = {},
  ): CanonicalOffer {
    if (
      typeof item?.id !== "string" ||
      typeof item?.title !== "string" ||
      !item.title.trim() ||
      typeof item?.permalink !== "string" ||
      !item.permalink.trim() ||
      typeof item?.price !== "number" ||
      typeof item?.currency_id !== "string"
    ) {
      throw new Error("Mercado Livre item lacks required canonical fields.");
    }

    const currentPriceCents =
      overrides.currentPriceCents ?? Math.round(item.price * 100);
    const originalPriceCents =
      overrides.originalPriceCents ??
      (typeof item.original_price === "number"
        ? Math.round(item.original_price * 100)
        : undefined);
    const discountBps =
      currentPriceCents != null &&
      originalPriceCents != null &&
      originalPriceCents > currentPriceCents
        ? Math.round((1 - currentPriceCents / originalPriceCents) * 10000)
        : undefined;
    const isFreeShipping = item.shipping?.free_shipping;

    return {
      marketplace: "MERCADO_LIVRE",
      externalOfferId: item.id,
      canonicalUrl: item.permalink,
      sourceUrl: item.permalink,
      currency: item.currency_id,
      product: {
        title: item.title,
        images: [
          ...(Array.isArray(item.pictures)
            ? item.pictures
                .map((p: any) => p?.secure_url)
                .filter(
                  (url: unknown): url is string =>
                    typeof url === "string" && url.startsWith("https://"),
                )
            : []),
          ...(typeof item.secure_thumbnail === "string" &&
          item.secure_thumbnail.startsWith("https://")
            ? [item.secure_thumbnail]
            : []),
        ],
        sourceCategory:
          typeof item.category_id === "string" ? item.category_id : null,
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
        source: "UNKNOWN",
        estimatedAmountCents: undefined,
        rateBps: undefined,
      },
      metrics: {
        rating: overrides.rating,
        reviewsCount: overrides.reviewsCount,
        marketplaceSalesCount:
          item.sold_quantity != null ? item.sold_quantity : undefined,
      },
      seller: {
        externalId: item.seller_id ? String(item.seller_id) : undefined,
        isOfficial: item.official_store_id != null ? true : undefined,
        ...overrides.seller,
      },
      discovery: overrides.discovery,
      discoveredAt: new Date(),
    };
  }
}
