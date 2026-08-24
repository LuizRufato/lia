CREATE TABLE IF NOT EXISTS "AdminAlertRecipient" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "encryptedRecipient" TEXT NOT NULL,
  "recipientIv" TEXT NOT NULL,
  "recipientAuthTag" TEXT NOT NULL,
  "recipientHash" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminAlertRecipient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminAlertDelivery" (
  "id" TEXT NOT NULL,
  "alertId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "status" "AdminAlertDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "sentAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminAlertDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdminAlertRecipient_configId_recipientHash_key"
  ON "AdminAlertRecipient"("configId", "recipientHash");
CREATE INDEX IF NOT EXISTS "AdminAlertRecipient_tenantId_enabled_idx"
  ON "AdminAlertRecipient"("tenantId", "enabled");
CREATE UNIQUE INDEX IF NOT EXISTS "AdminAlertDelivery_alertId_recipientId_key"
  ON "AdminAlertDelivery"("alertId", "recipientId");
CREATE INDEX IF NOT EXISTS "AdminAlertDelivery_recipientId_status_idx"
  ON "AdminAlertDelivery"("recipientId", "status");

DO $$ BEGIN
  ALTER TABLE "AdminAlertRecipient"
    ADD CONSTRAINT "AdminAlertRecipient_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AdminAlertRecipient"
    ADD CONSTRAINT "AdminAlertRecipient_configId_fkey"
    FOREIGN KEY ("configId") REFERENCES "AdminAlertConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AdminAlertDelivery"
    ADD CONSTRAINT "AdminAlertDelivery_alertId_fkey"
    FOREIGN KEY ("alertId") REFERENCES "AdminAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AdminAlertDelivery"
    ADD CONSTRAINT "AdminAlertDelivery_recipientId_fkey"
    FOREIGN KEY ("recipientId") REFERENCES "AdminAlertRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
