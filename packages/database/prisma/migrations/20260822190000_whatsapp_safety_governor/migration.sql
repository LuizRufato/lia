-- Additive WhatsApp lifecycle and governor configuration.
-- Existing channels remain enabled and retain their current behavior.

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "safetyMaxPerHour" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "safetyMaxPerDay" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "safetyMinIntervalSeconds" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "safetyWindowStartMinute" INTEGER,
  ADD COLUMN IF NOT EXISTS "safetyWindowEndMinute" INTEGER,
  ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "staleAt" TIMESTAMP(3);

DO $$ BEGIN
  CREATE TYPE "WhatsAppCircuitState" AS ENUM ('CLOSED', 'OPEN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "WhatsAppSafetyConfig" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "killSwitch" BOOLEAN NOT NULL DEFAULT false,
  "minIntervalSeconds" INTEGER NOT NULL DEFAULT 60,
  "maxPerHour" INTEGER NOT NULL DEFAULT 20,
  "maxPerDay" INTEGER NOT NULL DEFAULT 100,
  "quietStartMinute" INTEGER,
  "quietEndMinute" INTEGER,
  "reconnectionCooldownSeconds" INTEGER NOT NULL DEFAULT 90,
  "minQualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "maxObservationAgeMinutes" INTEGER NOT NULL DEFAULT 1440,
  "circuitState" "WhatsAppCircuitState" NOT NULL DEFAULT 'CLOSED',
  "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
  "circuitOpenedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppSafetyConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppSafetyConfig_tenantId_key"
  ON "WhatsAppSafetyConfig"("tenantId");

DO $$ BEGIN
  ALTER TABLE "WhatsAppSafetyConfig"
    ADD CONSTRAINT "WhatsAppSafetyConfig_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
