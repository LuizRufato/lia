-- Preserve temporal snapshots for every processed observation without
-- changing or deleting any existing history rows.
ALTER TABLE "PriceHistory"
  ADD COLUMN "observationId" TEXT,
  ADD COLUMN "originalPriceCents" INTEGER,
  ADD COLUMN "commissionCents" INTEGER,
  ADD COLUMN "salesCount" INTEGER,
  ADD COLUMN "rating" DOUBLE PRECISION,
  ADD COLUMN "observedAt" TIMESTAMP(3);

UPDATE "PriceHistory"
SET "observedAt" = "createdAt"
WHERE "observedAt" IS NULL;

ALTER TABLE "PriceHistory"
  ALTER COLUMN "observedAt" SET NOT NULL,
  ALTER COLUMN "observedAt" SET DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "PriceHistory_observationId_key"
  ON "PriceHistory"("observationId");

CREATE INDEX "PriceHistory_offerId_observedAt_idx"
  ON "PriceHistory"("offerId", "observedAt");

ALTER TABLE "PriceHistory"
  ADD CONSTRAINT "PriceHistory_observationId_fkey"
  FOREIGN KEY ("observationId") REFERENCES "OfferObservation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
