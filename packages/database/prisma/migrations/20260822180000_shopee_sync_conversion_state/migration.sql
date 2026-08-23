-- Track Shopee sync telemetry and the commission lifecycle without changing
-- existing integration, offer, financial, or attribution data.

ALTER TABLE "MarketplaceIntegration"
    ADD COLUMN "lastSyncProcessedCount" INTEGER;

CREATE TYPE "ConversionCommissionStatus" AS ENUM (
    'ESTIMATED',
    'PENDING',
    'CONFIRMED',
    'CANCELLED'
);

ALTER TABLE "MarketplaceConversion"
    ADD COLUMN "commissionStatus" "ConversionCommissionStatus" NOT NULL DEFAULT 'PENDING';

-- Backfill only the derived commission lifecycle for existing rows. No
-- financial or attribution fields are changed.
UPDATE "MarketplaceConversion" AS conversion
SET "commissionStatus" = 'CANCELLED'
WHERE EXISTS (
    SELECT 1
    FROM "MarketplaceConversionOrder" AS order_row
    WHERE order_row."conversionId" = conversion."id"
)
AND NOT EXISTS (
    SELECT 1
    FROM "MarketplaceConversionOrder" AS order_row
    WHERE order_row."conversionId" = conversion."id"
      AND order_row."orderStatus" <> 'CANCELLED'
);

UPDATE "MarketplaceConversion" AS conversion
SET "commissionStatus" = 'CONFIRMED'
WHERE EXISTS (
    SELECT 1
    FROM "MarketplaceConversionOrder" AS order_row
    WHERE order_row."conversionId" = conversion."id"
      AND order_row."orderStatus" = 'COMPLETED'
);
