CREATE TABLE "PublicTrackedLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "affiliateLinkId" TEXT,
    "token" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'PUBLIC_SEARCH',
    "destinationUrl" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicTrackedLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicClickEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "classification" "ClickClassification" NOT NULL DEFAULT 'VALID',
    "classificationReason" TEXT,
    "intelligenceClass" "ClickIntelligenceClass",
    "visitorHash" TEXT,
    "userAgentFamily" TEXT,
    "operatingSystem" TEXT,
    "deviceType" TEXT,
    "referrer" TEXT,

    CONSTRAINT "PublicClickEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublicTrackedLink_token_key" ON "PublicTrackedLink"("token");
CREATE INDEX "PublicTrackedLink_tenantId_offerId_idx" ON "PublicTrackedLink"("tenantId", "offerId");
CREATE INDEX "PublicTrackedLink_affiliateLinkId_idx" ON "PublicTrackedLink"("affiliateLinkId");
CREATE UNIQUE INDEX "PublicClickEvent_eventId_key" ON "PublicClickEvent"("eventId");
CREATE INDEX "PublicClickEvent_linkId_clickedAt_idx" ON "PublicClickEvent"("linkId", "clickedAt");
CREATE INDEX "PublicClickEvent_classification_clickedAt_idx" ON "PublicClickEvent"("classification", "clickedAt");

ALTER TABLE "PublicTrackedLink" ADD CONSTRAINT "PublicTrackedLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicTrackedLink" ADD CONSTRAINT "PublicTrackedLink_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicTrackedLink" ADD CONSTRAINT "PublicTrackedLink_affiliateLinkId_fkey" FOREIGN KEY ("affiliateLinkId") REFERENCES "AffiliateLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PublicClickEvent" ADD CONSTRAINT "PublicClickEvent_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "PublicTrackedLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
