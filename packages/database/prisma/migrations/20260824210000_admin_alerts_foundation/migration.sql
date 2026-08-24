-- Additive foundation for persisted administrator alerts.

DO $$ BEGIN
  CREATE TYPE "AdminAlertType" AS ENUM (
    'NEW_SHOPEE_SALE',
    'COMMISSION_CONFIRMED',
    'SALE_CANCELLED',
    'HIGH_VALUE_SALE',
    'CRITICAL_ERROR',
    'DAILY_SUMMARY'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdminAlertDeliveryStatus" AS ENUM (
    'NOT_REQUESTED',
    'PENDING',
    'SENT',
    'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AdminAlert" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "type" "AdminAlertType" NOT NULL,
  "provider" "MarketplaceType",
  "externalEventId" TEXT,
  "marketplaceConversionId" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "deliveryStatus" "AdminAlertDeliveryStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  "lastDeliveryError" TEXT,
  "sentAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdminAlert_dedupeKey_key"
  ON "AdminAlert"("dedupeKey");

CREATE INDEX IF NOT EXISTS "AdminAlert_tenantId_createdAt_idx"
  ON "AdminAlert"("tenantId", "createdAt");

CREATE INDEX IF NOT EXISTS "AdminAlert_tenantId_type_createdAt_idx"
  ON "AdminAlert"("tenantId", "type", "createdAt");

DO $$ BEGIN
  ALTER TABLE "AdminAlert"
    ADD CONSTRAINT "AdminAlert_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AdminAlert"
    ADD CONSTRAINT "AdminAlert_marketplaceConversionId_fkey"
    FOREIGN KEY ("marketplaceConversionId") REFERENCES "MarketplaceConversion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AdminAlertConfig" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "encryptedRecipient" TEXT,
  "recipientIv" TEXT,
  "recipientAuthTag" TEXT,
  "keyVersion" INTEGER NOT NULL DEFAULT 1,
  "newShopeeSaleEnabled" BOOLEAN NOT NULL DEFAULT true,
  "commissionConfirmedEnabled" BOOLEAN NOT NULL DEFAULT false,
  "saleCancelledEnabled" BOOLEAN NOT NULL DEFAULT false,
  "highValueSaleEnabled" BOOLEAN NOT NULL DEFAULT false,
  "criticalErrorEnabled" BOOLEAN NOT NULL DEFAULT false,
  "dailySummaryEnabled" BOOLEAN NOT NULL DEFAULT false,
  "enabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminAlertConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdminAlertConfig_tenantId_key"
  ON "AdminAlertConfig"("tenantId");

DO $$ BEGIN
  ALTER TABLE "AdminAlertConfig"
    ADD CONSTRAINT "AdminAlertConfig_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
