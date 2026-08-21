-- Add the marketplace conversion aggregate used by Analytics and the Shopee worker.
-- This migration is additive and preserves all existing data.
CREATE TYPE "AttributionStatus" AS ENUM ('ATTRIBUTED', 'UNATTRIBUTED');

CREATE TYPE "ConversionOrderStatus" AS ENUM ('UNPAID', 'PENDING', 'COMPLETED', 'CANCELLED');

CREATE TABLE "MarketplaceConversion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "MarketplaceType" NOT NULL,
    "externalConversionId" TEXT NOT NULL,
    "purchaseTime" TIMESTAMP(3) NOT NULL,
    "clickTime" TIMESTAMP(3),
    "utmContent" TEXT,
    "attributionKey" TEXT,
    "attributionStatus" "AttributionStatus" NOT NULL DEFAULT 'UNATTRIBUTED',
    "affiliateLinkId" TEXT,
    "offerId" TEXT,
    "buyerType" TEXT,
    "device" TEXT,
    "campaignType" TEXT,
    "shopeeCommissionCappedCents" INTEGER,
    "sellerCommissionCents" INTEGER,
    "totalCommissionCents" INTEGER,
    "netCommissionCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceConversion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketplaceConversionOrder" (
    "id" TEXT NOT NULL,
    "conversionId" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "orderStatus" "ConversionOrderStatus" NOT NULL,
    "shopType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceConversionOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketplaceConversionItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "externalItemId" TEXT NOT NULL,
    "externalLineKey" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "itemPriceCents" INTEGER NOT NULL,
    "actualAmountCents" INTEGER NOT NULL,
    "itemTotalCommissionCents" INTEGER,
    "itemSellerCommissionCents" INTEGER,
    "itemSellerCommissionRateBps" INTEGER,
    "itemShopeeCommissionCappedCents" INTEGER,
    "itemShopeeCommissionRateBps" INTEGER,
    "displayItemStatus" TEXT,
    "fraudStatus" TEXT,
    "globalCategoryLv1Name" TEXT,
    "globalCategoryLv2Name" TEXT,
    "globalCategoryLv3Name" TEXT,
    "modelId" TEXT,
    "promotionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceConversionItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketplaceConversion_tenantId_attributionStatus_purchaseTi_idx"
    ON "MarketplaceConversion"("tenantId", "attributionStatus", "purchaseTime");

CREATE UNIQUE INDEX "MarketplaceConversion_tenantId_provider_externalConversionI_key"
    ON "MarketplaceConversion"("tenantId", "provider", "externalConversionId");

CREATE UNIQUE INDEX "MarketplaceConversionOrder_conversionId_externalOrderId_key"
    ON "MarketplaceConversionOrder"("conversionId", "externalOrderId");

CREATE UNIQUE INDEX "MarketplaceConversionItem_orderId_externalLineKey_key"
    ON "MarketplaceConversionItem"("orderId", "externalLineKey");

ALTER TABLE "MarketplaceConversion"
    ADD CONSTRAINT "MarketplaceConversion_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MarketplaceConversion"
    ADD CONSTRAINT "MarketplaceConversion_affiliateLinkId_fkey"
    FOREIGN KEY ("affiliateLinkId") REFERENCES "AffiliateLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MarketplaceConversion"
    ADD CONSTRAINT "MarketplaceConversion_offerId_fkey"
    FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MarketplaceConversionOrder"
    ADD CONSTRAINT "MarketplaceConversionOrder_conversionId_fkey"
    FOREIGN KEY ("conversionId") REFERENCES "MarketplaceConversion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketplaceConversionItem"
    ADD CONSTRAINT "MarketplaceConversionItem_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "MarketplaceConversionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
