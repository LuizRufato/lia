-- Additive product image persistence for Smart Link Preview.
ALTER TABLE "Offer" ADD COLUMN "imageUrl" TEXT;

-- Backfill only missing values from the latest observed real HTTPS image.
-- Existing valid values are never overwritten and no external URLs are fetched.
WITH latest_image AS (
  SELECT DISTINCT ON (oo."offerId")
    oo."offerId",
    image_value.value AS "imageUrl"
  FROM "OfferObservation" oo
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(oo."canonicalPayload"->'product'->'images') = 'array'
        THEN oo."canonicalPayload"->'product'->'images'
      ELSE '[]'::jsonb
    END
  ) AS image_value(value)
  WHERE image_value.value LIKE 'https://%'
  ORDER BY oo."offerId", oo."observedAt" DESC, oo."createdAt" DESC
)
UPDATE "Offer" AS offer
SET "imageUrl" = latest_image."imageUrl"
FROM latest_image
WHERE offer."id" = latest_image."offerId"
  AND offer."imageUrl" IS NULL;
