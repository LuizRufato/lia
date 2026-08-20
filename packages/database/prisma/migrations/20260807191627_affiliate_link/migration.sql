-- CreateEnum
CREATE TYPE "AffiliateLinkStatus" AS ENUM ('UNVERIFIED', 'VERIFYING', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "PublicationDeliveryStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateTable
CREATE TABLE "ChannelIntegration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "ChannelProvider" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "wabaId" TEXT,
    "phoneNumberId" TEXT,
    "businessDisplayName" TEXT,
    "encryptedAccessToken" TEXT,
    "tokenIv" TEXT,
    "tokenAuthTag" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "attributionKey" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "contextId" TEXT,
    "affiliateUrl" TEXT,
    "status" "AffiliateLinkStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationDeliveryEvent" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "provider" "ChannelProvider" NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "status" "PublicationDeliveryStatus" NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorCode" TEXT,
    "errorMessageSanitized" TEXT,

    CONSTRAINT "PublicationDeliveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelIntegration_tenantId_provider_key" ON "ChannelIntegration"("tenantId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateLink_attributionKey_key" ON "AffiliateLink"("attributionKey");

-- CreateIndex
CREATE INDEX "AffiliateLink_offerId_status_idx" ON "AffiliateLink"("offerId", "status");

-- CreateIndex
CREATE INDEX "AffiliateLink_tenantId_attributionKey_idx" ON "AffiliateLink"("tenantId", "attributionKey");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateLink_offerId_context_contextId_key" ON "AffiliateLink"("offerId", "context", "contextId");

-- CreateIndex
CREATE INDEX "PublicationDeliveryEvent_publicationId_status_idx" ON "PublicationDeliveryEvent"("publicationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationDeliveryEvent_externalMessageId_status_key" ON "PublicationDeliveryEvent"("externalMessageId", "status");

-- AddForeignKey
ALTER TABLE "ChannelIntegration" ADD CONSTRAINT "ChannelIntegration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateLink" ADD CONSTRAINT "AffiliateLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateLink" ADD CONSTRAINT "AffiliateLink_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationDeliveryEvent" ADD CONSTRAINT "PublicationDeliveryEvent_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
