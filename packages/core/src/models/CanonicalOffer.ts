import { z } from "zod";

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
  }),

  rawObservation: z.record(z.any()).optional(),

  discoveredAt: z.coerce.date(),
});

export type CanonicalOffer = z.infer<typeof CanonicalOfferSchema>;

export function validateCanonicalOffer(data: unknown): CanonicalOffer {
  return CanonicalOfferSchema.parse(data);
}
