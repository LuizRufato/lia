import { z } from "zod";
import { isIP } from "node:net";

export const CanonicalOfferSchema = z.object({
  marketplace: z.string().min(1),
  externalOfferId: z.string().min(1),
  externalProductId: z.string().nullable().optional(),
  canonicalUrl: z.string().url(),
  sourceUrl: z.string().url(),
  currency: z.string().min(3).max(3),

  product: z.object({
    title: z.string().min(1),
    brand: z.string().nullable().optional(),
    sku: z.string().nullable().optional(),
    sourceCategory: z.string().nullable().optional(),
    normalizedCategory: z.string().nullable().optional(),
    images: z.array(z.string().url()),
  }),

  pricing: z.object({
    currentPriceCents: z.number().int().min(0),
    originalPriceCents: z.number().int().min(0).nullable().optional(),
    discountBps: z.number().int().min(0).max(10000).nullable().optional(),
  }),

  shipping: z.object({
    isFree: z.boolean().nullable().optional(),
    costCents: z.number().int().min(0).nullable().optional(),
  }),

  commission: z.object({
    estimatedAmountCents: z.number().int().min(0).nullable().optional(),
    rateBps: z.number().int().min(0).max(10000).nullable().optional(),
    source: z.enum(["API", "CALCULATED", "UNKNOWN"]),
  }),

  metrics: z.object({
    rating: z.number().min(0).max(5).nullable().optional(),
    reviewsCount: z.number().int().min(0).nullable().optional(),
    marketplaceSalesCount: z.number().int().min(0).nullable().optional(),
  }),

  seller: z.object({
    externalId: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    isOfficial: z.boolean().nullable().optional(),
    rating: z.number().min(0).max(5).nullable().optional(),
    reputationLevel: z.string().nullable().optional(),
    completedTransactions: z.number().int().min(0).nullable().optional(),
    canceledTransactions: z.number().int().min(0).nullable().optional(),
  }),

  discovery: z
    .object({
      source: z.string().min(1),
      sourceCategoryId: z.string().nullable().optional(),
      rankingPosition: z.number().int().min(1).nullable().optional(),
      sourceEntityType: z
        .enum(["ITEM", "PRODUCT", "USER_PRODUCT"])
        .nullable()
        .optional(),
    })
    .optional(),

  rawObservation: z.record(z.any()).optional(),

  discoveredAt: z.coerce.date(),
});

export type CanonicalOffer = z.infer<typeof CanonicalOfferSchema>;

/** Return the first real HTTPS image URL, or null when the source is absent or unsafe. */
export function firstHttpsImageUrl(images: unknown): string | null {
  if (!Array.isArray(images)) return null;

  for (const candidate of images) {
    if (typeof candidate !== "string") continue;
    try {
      const parsed = new URL(candidate);
      const hostname = parsed.hostname.toLowerCase();
      const ipVersion = isIP(hostname);
      const privateIpv4 =
        ipVersion === 4 &&
        (/^(10|127)\./.test(hostname) ||
          /^192\.168\./.test(hostname) ||
          /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
          /^169\.254\./.test(hostname) ||
          /^0\./.test(hostname));
      const privateIpv6 =
        ipVersion === 6 &&
        (hostname === "::1" ||
          hostname.startsWith("fc") ||
          hostname.startsWith("fd") ||
          hostname.startsWith("fe80:"));
      if (
        parsed.protocol === "https:" &&
        !parsed.username &&
        !parsed.password &&
        hostname !== "localhost" &&
        !hostname.endsWith(".local") &&
        !privateIpv4 &&
        !privateIpv6
      )
        return parsed.toString();
    } catch {
      // Invalid image URLs are treated as absent data.
    }
  }

  return null;
}

export function validateCanonicalOffer(data: unknown): CanonicalOffer {
  return CanonicalOfferSchema.parse(data);
}
