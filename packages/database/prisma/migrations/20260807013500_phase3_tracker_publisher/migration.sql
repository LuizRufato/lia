-- CreateEnum
CREATE TYPE "ChannelProvider" AS ENUM ('TELEGRAM', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'RETRYABLE', 'DELIVERY_UNKNOWN', 'FAILED');

-- CreateEnum
CREATE TYPE "ClickClassification" AS ENUM ('VALID', 'PREVIEW_BOT', 'SUSPECTED_BOT');

-- AlterTable
ALTER TABLE "TrackedLink" DROP COLUMN "status",
DROP COLUMN "targetUrl",
ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "destinationUrl" TEXT NOT NULL,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "publicationId" TEXT NOT NULL;

-- DropEnum
DROP TYPE "LinkStatus";

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "ChannelProvider" NOT NULL,
    "externalChatId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'PENDING',
    "externalMessageId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "errorReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClickEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "classification" "ClickClassification" NOT NULL DEFAULT 'VALID',
    "classificationReason" TEXT,
    "visitorHash" TEXT,
    "userAgentFamily" TEXT,
    "deviceType" TEXT,

    CONSTRAINT "ClickEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Channel_tenantId_provider_externalChatId_key" ON "Channel"("tenantId", "provider", "externalChatId");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_candidateId_channelId_key" ON "Publication"("candidateId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "ClickEvent_eventId_key" ON "ClickEvent"("eventId");

-- CreateIndex
CREATE INDEX "ClickEvent_linkId_clickedAt_idx" ON "ClickEvent"("linkId", "clickedAt");

-- CreateIndex
CREATE INDEX "ClickEvent_classification_clickedAt_idx" ON "ClickEvent"("classification", "clickedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedLink_publicationId_key" ON "TrackedLink"("publicationId");

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "PublicationCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedLink" ADD CONSTRAINT "TrackedLink_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClickEvent" ADD CONSTRAINT "ClickEvent_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "TrackedLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

