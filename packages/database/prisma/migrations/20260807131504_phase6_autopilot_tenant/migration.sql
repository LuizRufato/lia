-- CreateEnum
CREATE TYPE "TenantRole" AS ENUM ('OWNER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AutopilotMode" AS ENUM ('OFF', 'MANUAL', 'DRY_RUN', 'AUTO');

-- CreateEnum
CREATE TYPE "AutopilotDecisionReason" AS ENUM ('APPROVED', 'REJECTED_LOW_SCORE', 'REJECTED_DAILY_LIMIT', 'REJECTED_INTERVAL', 'REJECTED_OUTSIDE_SCHEDULE', 'REJECTED_FATIGUE', 'REJECTED_DUPLICATE', 'REJECTED_MONETIZATION', 'REJECTED_CHANNEL_POLICY', 'REJECTED_KILL_SWITCH', 'REJECTED_INTEGRATION_UNHEALTHY', 'DRY_RUN_APPROVED');

-- CreateEnum
CREATE TYPE "MonetizationStatus" AS ENUM ('UNAVAILABLE', 'UNVERIFIED', 'VERIFIED');

-- CreateTable
CREATE TABLE "TenantMembership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "role" "TenantRole" NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopilotConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mode" "AutopilotMode" NOT NULL DEFAULT 'OFF',
    "allowedStartMinute" INTEGER NOT NULL DEFAULT 540,
    "allowedEndMinute" INTEGER NOT NULL DEFAULT 1200,
    "timezone" TEXT NOT NULL DEFAULT 'America/Campo_Grande',
    "minScore" DECIMAL(65,30) NOT NULL DEFAULT 70,
    "maxDailyPosts" INTEGER NOT NULL DEFAULT 30,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopilotChannelConfig" (
    "id" TEXT NOT NULL,
    "autopilotConfigId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,

    CONSTRAINT "AutopilotChannelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopilotMarketplaceConfig" (
    "id" TEXT NOT NULL,
    "autopilotConfigId" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,

    CONSTRAINT "AutopilotMarketplaceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopilotAudit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "channelId" TEXT,
    "decision" "AutopilotDecisionReason" NOT NULL,
    "liaScore" DECIMAL(65,30) NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutopilotAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonetizationRecord" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "status" "MonetizationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "provider" TEXT NOT NULL,
    "destinationUrl" TEXT,
    "commissionAmountCents" INTEGER,
    "commissionRateBps" INTEGER,
    "source" TEXT NOT NULL,
    "integrationId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonetizationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantMembership_tenantId_adminUserId_key" ON "TenantMembership"("tenantId", "adminUserId");

-- CreateIndex
CREATE UNIQUE INDEX "AutopilotConfig_tenantId_key" ON "AutopilotConfig"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AutopilotChannelConfig_autopilotConfigId_channelId_key" ON "AutopilotChannelConfig"("autopilotConfigId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "AutopilotMarketplaceConfig_autopilotConfigId_marketplaceId_key" ON "AutopilotMarketplaceConfig"("autopilotConfigId", "marketplaceId");

-- CreateIndex
CREATE INDEX "AutopilotAudit_tenantId_createdAt_idx" ON "AutopilotAudit"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MonetizationRecord_offerId_key" ON "MonetizationRecord"("offerId");

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopilotConfig" ADD CONSTRAINT "AutopilotConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopilotChannelConfig" ADD CONSTRAINT "AutopilotChannelConfig_autopilotConfigId_fkey" FOREIGN KEY ("autopilotConfigId") REFERENCES "AutopilotConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopilotChannelConfig" ADD CONSTRAINT "AutopilotChannelConfig_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopilotMarketplaceConfig" ADD CONSTRAINT "AutopilotMarketplaceConfig_autopilotConfigId_fkey" FOREIGN KEY ("autopilotConfigId") REFERENCES "AutopilotConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopilotMarketplaceConfig" ADD CONSTRAINT "AutopilotMarketplaceConfig_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "Marketplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopilotAudit" ADD CONSTRAINT "AutopilotAudit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopilotAudit" ADD CONSTRAINT "AutopilotAudit_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "PublicationCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopilotAudit" ADD CONSTRAINT "AutopilotAudit_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "OfferEvaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopilotAudit" ADD CONSTRAINT "AutopilotAudit_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonetizationRecord" ADD CONSTRAINT "MonetizationRecord_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
