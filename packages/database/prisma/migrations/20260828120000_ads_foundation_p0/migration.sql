-- Additive LIA Ads foundation. Delivery and billing-by-click remain disabled by
-- default; these tables only provide the administrative domain and ledger.

DO $$ BEGIN
  CREATE TYPE "AdsAdvertiserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdCampaignStatus" AS ENUM (
    'DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'ENDED', 'REJECTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdMarketplace" AS ENUM ('SHOPEE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdPlacement" AS ENUM ('PUBLIC_SEARCH');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdPricingModel" AS ENUM ('CPC');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdBillingEventType" AS ENUM (
    'CREDIT', 'CHARGE', 'RESERVE', 'RELEASE', 'REFUND', 'REVERSAL', 'ADJUSTMENT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdBillingDirection" AS ENUM ('POSITIVE', 'NEGATIVE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdAuditAction" AS ENUM (
    'ADVERTISER_CREATED', 'ADVERTISER_UPDATED', 'ADVERTISER_SUSPENDED',
    'CAMPAIGN_CREATED', 'CAMPAIGN_UPDATED', 'CAMPAIGN_SUBMITTED',
    'CAMPAIGN_APPROVED', 'CAMPAIGN_REJECTED', 'CAMPAIGN_PAUSED',
    'CAMPAIGN_RESUMED', 'CREDIT_ADDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdClickStatus" AS ENUM (
    'RAW', 'VALIDATED', 'BILLABLE', 'NON_BILLABLE', 'REVERSED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AdsConfig" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "adsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "adsPublicSearchEnabled" BOOLEAN NOT NULL DEFAULT false,
  "adsBillingEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdsConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdsConfig_tenantId_key" ON "AdsConfig"("tenantId");

CREATE TABLE IF NOT EXISTS "Advertiser" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "companyName" TEXT,
  "contactName" TEXT,
  "contactEmail" TEXT,
  "contactPhone" TEXT,
  "status" "AdsAdvertiserStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Advertiser_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Advertiser_tenantId_status_idx" ON "Advertiser"("tenantId", "status");

CREATE TABLE IF NOT EXISTS "AdCampaign" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "advertiserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "AdCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "marketplace" "AdMarketplace" NOT NULL DEFAULT 'SHOPEE',
  "placement" "AdPlacement" NOT NULL DEFAULT 'PUBLIC_SEARCH',
  "offerId" TEXT NOT NULL,
  "pricingModel" "AdPricingModel" NOT NULL DEFAULT 'CPC',
  "bidCpcCents" INTEGER NOT NULL,
  "totalBudgetCents" INTEGER NOT NULL,
  "dailyBudgetCents" INTEGER NOT NULL,
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "approvedByAdminUserId" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectedByAdminUserId" TEXT,
  "rejectionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdCampaign_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AdCampaign_tenantId_status_idx" ON "AdCampaign"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "AdCampaign_advertiserId_status_idx" ON "AdCampaign"("advertiserId", "status");
CREATE INDEX IF NOT EXISTS "AdCampaign_offerId_idx" ON "AdCampaign"("offerId");

CREATE TABLE IF NOT EXISTS "AdDelivery" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "placement" "AdPlacement" NOT NULL DEFAULT 'PUBLIC_SEARCH',
  "publicTrackedLinkId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdDelivery_idempotencyKey_key" ON "AdDelivery"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "AdDelivery_tenantId_campaignId_createdAt_idx" ON "AdDelivery"("tenantId", "campaignId", "createdAt");

CREATE TABLE IF NOT EXISTS "AdClick" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "deliveryId" TEXT,
  "publicClickEventId" TEXT,
  "eventId" TEXT NOT NULL,
  "status" "AdClickStatus" NOT NULL DEFAULT 'RAW',
  "reason" TEXT,
  "visitorKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validatedAt" TIMESTAMP(3),
  "billableAt" TIMESTAMP(3),
  CONSTRAINT "AdClick_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdClick_publicClickEventId_key" ON "AdClick"("publicClickEventId");
CREATE UNIQUE INDEX IF NOT EXISTS "AdClick_eventId_key" ON "AdClick"("eventId");
CREATE INDEX IF NOT EXISTS "AdClick_tenantId_campaignId_createdAt_idx" ON "AdClick"("tenantId", "campaignId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdClick_status_createdAt_idx" ON "AdClick"("status", "createdAt");

CREATE TABLE IF NOT EXISTS "AdBillingEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "advertiserId" TEXT NOT NULL,
  "campaignId" TEXT,
  "adClickId" TEXT,
  "type" "AdBillingEventType" NOT NULL,
  "direction" "AdBillingDirection",
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BRL',
  "idempotencyKey" TEXT NOT NULL,
  "adminUserId" TEXT,
  "reason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdBillingEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdBillingEvent_idempotencyKey_key" ON "AdBillingEvent"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "AdBillingEvent_tenantId_createdAt_idx" ON "AdBillingEvent"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdBillingEvent_advertiserId_createdAt_idx" ON "AdBillingEvent"("advertiserId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdBillingEvent_campaignId_createdAt_idx" ON "AdBillingEvent"("campaignId", "createdAt");

CREATE TABLE IF NOT EXISTS "AdvertiserBalance" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "advertiserId" TEXT NOT NULL,
  "availableCents" INTEGER NOT NULL DEFAULT 0,
  "reservedCents" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdvertiserBalance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdvertiserBalance_advertiserId_key" ON "AdvertiserBalance"("advertiserId");
CREATE INDEX IF NOT EXISTS "AdvertiserBalance_tenantId_idx" ON "AdvertiserBalance"("tenantId");

CREATE TABLE IF NOT EXISTS "AdAuditEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "advertiserId" TEXT,
  "campaignId" TEXT,
  "adminUserId" TEXT NOT NULL,
  "action" "AdAuditAction" NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "previousState" JSONB,
  "newState" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdAuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AdAuditEvent_tenantId_createdAt_idx" ON "AdAuditEvent"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdAuditEvent_entityType_entityId_createdAt_idx" ON "AdAuditEvent"("entityType", "entityId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "AdsConfig" ADD CONSTRAINT "AdsConfig_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Advertiser" ADD CONSTRAINT "Advertiser_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_advertiserId_fkey"
    FOREIGN KEY ("advertiserId") REFERENCES "Advertiser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_offerId_fkey"
    FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_approvedByAdminUserId_fkey"
    FOREIGN KEY ("approvedByAdminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_rejectedByAdminUserId_fkey"
    FOREIGN KEY ("rejectedByAdminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AdDelivery" ADD CONSTRAINT "AdDelivery_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "AdCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AdDelivery" ADD CONSTRAINT "AdDelivery_offerId_fkey"
    FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AdClick" ADD CONSTRAINT "AdClick_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "AdCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AdClick" ADD CONSTRAINT "AdClick_deliveryId_fkey"
    FOREIGN KEY ("deliveryId") REFERENCES "AdDelivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AdBillingEvent" ADD CONSTRAINT "AdBillingEvent_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AdBillingEvent" ADD CONSTRAINT "AdBillingEvent_advertiserId_fkey"
    FOREIGN KEY ("advertiserId") REFERENCES "Advertiser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AdBillingEvent" ADD CONSTRAINT "AdBillingEvent_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "AdCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AdBillingEvent" ADD CONSTRAINT "AdBillingEvent_adClickId_fkey"
    FOREIGN KEY ("adClickId") REFERENCES "AdClick"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AdBillingEvent" ADD CONSTRAINT "AdBillingEvent_adminUserId_fkey"
    FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AdvertiserBalance" ADD CONSTRAINT "AdvertiserBalance_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AdvertiserBalance" ADD CONSTRAINT "AdvertiserBalance_advertiserId_fkey"
    FOREIGN KEY ("advertiserId") REFERENCES "Advertiser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AdAuditEvent" ADD CONSTRAINT "AdAuditEvent_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AdAuditEvent" ADD CONSTRAINT "AdAuditEvent_advertiserId_fkey"
    FOREIGN KEY ("advertiserId") REFERENCES "Advertiser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AdAuditEvent" ADD CONSTRAINT "AdAuditEvent_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "AdCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AdAuditEvent" ADD CONSTRAINT "AdAuditEvent_adminUserId_fkey"
    FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
