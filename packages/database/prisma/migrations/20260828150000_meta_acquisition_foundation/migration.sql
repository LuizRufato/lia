-- Additive Meta member-acquisition foundation. This migration does not enable
-- Meta writes, create groups, send messages, or modify the legacy Ads domain.

ALTER TYPE "AdminAlertType" ADD VALUE IF NOT EXISTS 'CPA_ABOVE_TARGET';
ALTER TYPE "AdminAlertType" ADD VALUE IF NOT EXISTS 'GROUP_NEAR_CAPACITY';
ALTER TYPE "AdminAlertType" ADD VALUE IF NOT EXISTS 'GROUP_ROUTING_SWITCH_REQUIRED';
ALTER TYPE "AdminAlertType" ADD VALUE IF NOT EXISTS 'GROUP_PROVISION_REQUIRED';

DO $$ BEGIN CREATE TYPE "MetaConnectionStatus" AS ENUM
  ('NOT_CONFIGURED', 'CONNECTED', 'EXPIRED', 'NEEDS_REAUTH', 'ERROR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "AcquisitionCampaignStatus" AS ENUM
  ('DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'EXECUTING', 'ACTIVE', 'PAUSED', 'FAILED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "AcquisitionCampaignObjective" AS ENUM ('MEMBER_ACQUISITION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "AcquisitionCreativeStatus" AS ENUM
  ('DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "AcquisitionCreativeConcept" AS ENUM
  ('AI_VALUE', 'SAVE_MONEY', 'URGENCY', 'EXCLUSIVITY', 'COMMUNITY', 'PRICE_ALERT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "AcquisitionCreativeFormat" AS ENUM
  ('SQUARE', 'PORTRAIT', 'STORY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "AcquisitionAudienceStrategyType" AS ENUM
  ('BROAD', 'INTEREST_BASED', 'RETARGETING', 'LOOKALIKE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "AcquisitionSuggestionStatus" AS ENUM
  ('OPEN', 'APPROVED', 'REJECTED', 'APPLIED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "AcquisitionSuggestionType" AS ENUM
  ('PAUSE_UNDERPERFORMER', 'SHIFT_BUDGET', 'INCREASE_BUDGET', 'TEST_NEW_CREATIVE', 'TEST_NEW_AUDIENCE', 'REFRESH_CREATIVE', 'GROUP_CAPACITY_WARNING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "AcquisitionEventType" AS ENUM
  ('LANDING_VIEW', 'JOIN_CTA_CLICK', 'WHATSAPP_REDIRECT', 'CONFIRMED_GROUP_JOIN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "LiaWhatsAppGroupStatus" AS ENUM
  ('PREPARING', 'ACTIVE', 'NEAR_CAPACITY', 'FULL', 'INACTIVE', 'ERROR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "LiaWhatsAppGroupEventType" AS ENUM
  ('JOIN', 'LEAVE', 'REMOVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "AcquisitionGroupProvisioningMode" AS ENUM ('SHADOW');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "MetaAcquisitionConfig" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "liaAdsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "liaAdsMetaEnabled" BOOLEAN NOT NULL DEFAULT false,
  "liaAdsMetaWriteEnabled" BOOLEAN NOT NULL DEFAULT false,
  "liaAdsGroupRoutingEnabled" BOOLEAN NOT NULL DEFAULT false,
  "liaAdsGroupAutoProvisionEnabled" BOOLEAN NOT NULL DEFAULT false,
  "liaAdsAlertsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "targetCostPerJoinCents" INTEGER NOT NULL DEFAULT 100,
  "minimumSpendBeforeAlertCents" INTEGER NOT NULL DEFAULT 500,
  "minimumJoinIntentsBeforeAlert" INTEGER NOT NULL DEFAULT 10,
  "groupCapacityDefault" INTEGER NOT NULL DEFAULT 1024,
  "groupPrepareThreshold" INTEGER NOT NULL DEFAULT 900,
  "groupRoutingThreshold" INTEGER NOT NULL DEFAULT 1000,
  "groupProvisioningMode" "AcquisitionGroupProvisioningMode" NOT NULL DEFAULT 'SHADOW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MetaAcquisitionConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MetaAcquisitionConfig_tenantId_key" ON "MetaAcquisitionConfig"("tenantId");

CREATE TABLE IF NOT EXISTS "MetaConnection" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "status" "MetaConnectionStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
  "businessId" TEXT,
  "adAccountId" TEXT,
  "pageId" TEXT,
  "instagramAccountId" TEXT,
  "encryptedAccessToken" TEXT,
  "tokenIv" TEXT,
  "tokenAuthTag" TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "permissions" JSONB,
  "lastValidatedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MetaConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MetaConnection_tenantId_key" ON "MetaConnection"("tenantId");

CREATE TABLE IF NOT EXISTS "LiaWhatsAppGroup" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "channelId" TEXT,
  "externalGroupJid" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sequenceNumber" INTEGER NOT NULL,
  "status" "LiaWhatsAppGroupStatus" NOT NULL DEFAULT 'PREPARING',
  "capacity" INTEGER NOT NULL DEFAULT 1024,
  "memberCount" INTEGER NOT NULL DEFAULT 0,
  "externalMemberCount" INTEGER,
  "inviteCodeHash" TEXT,
  "inviteUrl" TEXT,
  "isRoutingActive" BOOLEAN NOT NULL DEFAULT false,
  "isPublicationActive" BOOLEAN NOT NULL DEFAULT false,
  "provisionedAutomatically" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastReconciledAt" TIMESTAMP(3),
  CONSTRAINT "LiaWhatsAppGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LiaWhatsAppGroup_tenantId_externalGroupJid_key" ON "LiaWhatsAppGroup"("tenantId", "externalGroupJid");
CREATE UNIQUE INDEX IF NOT EXISTS "LiaWhatsAppGroup_tenantId_sequenceNumber_key" ON "LiaWhatsAppGroup"("tenantId", "sequenceNumber");
CREATE INDEX IF NOT EXISTS "LiaWhatsAppGroup_tenantId_status_isRoutingActive_idx" ON "LiaWhatsAppGroup"("tenantId", "status", "isRoutingActive");

CREATE TABLE IF NOT EXISTS "LiaWhatsAppGroupMember" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "participantHash" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "joinedAt" TIMESTAMP(3),
  "leftAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LiaWhatsAppGroupMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LiaWhatsAppGroupMember_groupId_participantHash_key" ON "LiaWhatsAppGroupMember"("groupId", "participantHash");
CREATE INDEX IF NOT EXISTS "LiaWhatsAppGroupMember_tenantId_isActive_idx" ON "LiaWhatsAppGroupMember"("tenantId", "isActive");

CREATE TABLE IF NOT EXISTS "LiaWhatsAppGroupEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "type" "LiaWhatsAppGroupEventType" NOT NULL,
  "participantHash" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LiaWhatsAppGroupEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LiaWhatsAppGroupEvent_eventId_key" ON "LiaWhatsAppGroupEvent"("eventId");
CREATE INDEX IF NOT EXISTS "LiaWhatsAppGroupEvent_tenantId_type_occurredAt_idx" ON "LiaWhatsAppGroupEvent"("tenantId", "type", "occurredAt");
CREATE INDEX IF NOT EXISTS "LiaWhatsAppGroupEvent_groupId_occurredAt_idx" ON "LiaWhatsAppGroupEvent"("groupId", "occurredAt");

CREATE TABLE IF NOT EXISTS "AcquisitionCampaign" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "objective" "AcquisitionCampaignObjective" NOT NULL DEFAULT 'MEMBER_ACQUISITION',
  "status" "AcquisitionCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "dailyBudgetCents" INTEGER NOT NULL,
  "totalBudgetCents" INTEGER,
  "targetCostPerJoinCents" INTEGER NOT NULL DEFAULT 100,
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  "country" TEXT NOT NULL DEFAULT 'BR',
  "destinationGroupPool" TEXT NOT NULL DEFAULT 'LIA_ACHOU',
  "metaCampaignId" TEXT,
  "metaAdSetId" TEXT,
  "createdByAdminUserId" TEXT NOT NULL,
  "approvedByAdminUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AcquisitionCampaign_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AcquisitionCampaign_tenantId_status_idx" ON "AcquisitionCampaign"("tenantId", "status");

CREATE TABLE IF NOT EXISTS "AcquisitionAudienceStrategy" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "campaignId" TEXT,
  "type" "AcquisitionAudienceStrategyType" NOT NULL,
  "name" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "parameters" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AcquisitionAudienceStrategy_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AcquisitionAudienceStrategy_tenantId_type_idx" ON "AcquisitionAudienceStrategy"("tenantId", "type");

CREATE TABLE IF NOT EXISTS "AcquisitionCreative" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "campaignId" TEXT,
  "concept" "AcquisitionCreativeConcept" NOT NULL,
  "format" "AcquisitionCreativeFormat" NOT NULL,
  "headline" TEXT NOT NULL,
  "primaryText" TEXT NOT NULL,
  "description" TEXT,
  "cta" TEXT NOT NULL,
  "imagePrompt" TEXT,
  "assetUrl" TEXT,
  "status" "AcquisitionCreativeStatus" NOT NULL DEFAULT 'DRAFT',
  "approvedByAdminUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AcquisitionCreative_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AcquisitionCreative_tenantId_status_idx" ON "AcquisitionCreative"("tenantId", "status");

CREATE TABLE IF NOT EXISTS "AcquisitionTrackingLink" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "campaignId" TEXT,
  "creativeId" TEXT,
  "audienceStrategyId" TEXT,
  "destinationGroupPool" TEXT NOT NULL DEFAULT 'LIA_ACHOU',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AcquisitionTrackingLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AcquisitionTrackingLink_token_key" ON "AcquisitionTrackingLink"("token");
CREATE INDEX IF NOT EXISTS "AcquisitionTrackingLink_tenantId_active_idx" ON "AcquisitionTrackingLink"("tenantId", "active");

CREATE TABLE IF NOT EXISTS "AcquisitionEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "type" "AcquisitionEventType" NOT NULL,
  "trackingLinkId" TEXT,
  "campaignId" TEXT,
  "creativeId" TEXT,
  "groupId" TEXT,
  "visitorHash" TEXT,
  "sessionHash" TEXT,
  "referrer" TEXT,
  "utmSource" TEXT,
  "utmMedium" TEXT,
  "utmCampaign" TEXT,
  "utmContent" TEXT,
  "deviceClass" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AcquisitionEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AcquisitionEvent_eventId_key" ON "AcquisitionEvent"("eventId");
CREATE INDEX IF NOT EXISTS "AcquisitionEvent_tenantId_type_createdAt_idx" ON "AcquisitionEvent"("tenantId", "type", "createdAt");
CREATE INDEX IF NOT EXISTS "AcquisitionEvent_trackingLinkId_type_createdAt_idx" ON "AcquisitionEvent"("trackingLinkId", "type", "createdAt");

CREATE TABLE IF NOT EXISTS "AcquisitionSuggestion" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "campaignId" TEXT,
  "type" "AcquisitionSuggestionType" NOT NULL,
  "title" TEXT NOT NULL,
  "explanation" TEXT NOT NULL,
  "dataUsed" JSONB NOT NULL,
  "confidence" DECIMAL(65,30),
  "expectedImpact" TEXT,
  "actionPayload" JSONB,
  "status" "AcquisitionSuggestionStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AcquisitionSuggestion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AcquisitionSuggestion_tenantId_status_createdAt_idx" ON "AcquisitionSuggestion"("tenantId", "status", "createdAt");

DO $$ BEGIN ALTER TABLE "MetaAcquisitionConfig" ADD CONSTRAINT "MetaAcquisitionConfig_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "MetaConnection" ADD CONSTRAINT "MetaConnection_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "LiaWhatsAppGroup" ADD CONSTRAINT "LiaWhatsAppGroup_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "LiaWhatsAppGroup" ADD CONSTRAINT "LiaWhatsAppGroup_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "LiaWhatsAppGroupMember" ADD CONSTRAINT "LiaWhatsAppGroupMember_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "LiaWhatsAppGroupMember" ADD CONSTRAINT "LiaWhatsAppGroupMember_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "LiaWhatsAppGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "LiaWhatsAppGroupEvent" ADD CONSTRAINT "LiaWhatsAppGroupEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "LiaWhatsAppGroupEvent" ADD CONSTRAINT "LiaWhatsAppGroupEvent_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "LiaWhatsAppGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AcquisitionCampaign" ADD CONSTRAINT "AcquisitionCampaign_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AcquisitionCampaign" ADD CONSTRAINT "AcquisitionCampaign_createdByAdminUserId_fkey"
  FOREIGN KEY ("createdByAdminUserId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AcquisitionCampaign" ADD CONSTRAINT "AcquisitionCampaign_approvedByAdminUserId_fkey"
  FOREIGN KEY ("approvedByAdminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AcquisitionAudienceStrategy" ADD CONSTRAINT "AcquisitionAudienceStrategy_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AcquisitionAudienceStrategy" ADD CONSTRAINT "AcquisitionAudienceStrategy_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "AcquisitionCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AcquisitionCreative" ADD CONSTRAINT "AcquisitionCreative_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AcquisitionCreative" ADD CONSTRAINT "AcquisitionCreative_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "AcquisitionCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AcquisitionCreative" ADD CONSTRAINT "AcquisitionCreative_approvedByAdminUserId_fkey"
  FOREIGN KEY ("approvedByAdminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AcquisitionTrackingLink" ADD CONSTRAINT "AcquisitionTrackingLink_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AcquisitionTrackingLink" ADD CONSTRAINT "AcquisitionTrackingLink_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "AcquisitionCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AcquisitionTrackingLink" ADD CONSTRAINT "AcquisitionTrackingLink_creativeId_fkey"
  FOREIGN KEY ("creativeId") REFERENCES "AcquisitionCreative"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AcquisitionTrackingLink" ADD CONSTRAINT "AcquisitionTrackingLink_audienceStrategyId_fkey"
  FOREIGN KEY ("audienceStrategyId") REFERENCES "AcquisitionAudienceStrategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AcquisitionEvent" ADD CONSTRAINT "AcquisitionEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AcquisitionEvent" ADD CONSTRAINT "AcquisitionEvent_trackingLinkId_fkey"
  FOREIGN KEY ("trackingLinkId") REFERENCES "AcquisitionTrackingLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AcquisitionEvent" ADD CONSTRAINT "AcquisitionEvent_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "AcquisitionCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AcquisitionEvent" ADD CONSTRAINT "AcquisitionEvent_creativeId_fkey"
  FOREIGN KEY ("creativeId") REFERENCES "AcquisitionCreative"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AcquisitionEvent" ADD CONSTRAINT "AcquisitionEvent_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "LiaWhatsAppGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AcquisitionSuggestion" ADD CONSTRAINT "AcquisitionSuggestion_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AcquisitionSuggestion" ADD CONSTRAINT "AcquisitionSuggestion_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "AcquisitionCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
