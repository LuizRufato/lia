CREATE TYPE "AutopilotCatalogMode" AS ENUM ('OPEN', 'SELECTED_CATEGORIES');

CREATE TABLE "AutopilotCatalogPolicy" (
    "id" TEXT NOT NULL,
    "autopilotConfigId" TEXT NOT NULL,
    "mode" "AutopilotCatalogMode" NOT NULL DEFAULT 'OPEN',
    "allowedCategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "blockedCategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "blockedKeywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "minSalesCount" INTEGER,
    "minRating" DOUBLE PRECISION,
    "productCooldownHours" INTEGER,
    "maxPerCategoryPerDay" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotCatalogPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutopilotCatalogPolicy_autopilotConfigId_key"
    ON "AutopilotCatalogPolicy"("autopilotConfigId");

ALTER TABLE "AutopilotCatalogPolicy"
    ADD CONSTRAINT "AutopilotCatalogPolicy_autopilotConfigId_fkey"
    FOREIGN KEY ("autopilotConfigId") REFERENCES "AutopilotConfig"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TYPE "AutopilotDecisionReason" ADD VALUE 'REJECTED_CATEGORY';
ALTER TYPE "AutopilotDecisionReason" ADD VALUE 'REJECTED_BLOCKED_CATEGORY';
ALTER TYPE "AutopilotDecisionReason" ADD VALUE 'REJECTED_BLOCKED_KEYWORD';
ALTER TYPE "AutopilotDecisionReason" ADD VALUE 'REJECTED_MIN_SALES';
ALTER TYPE "AutopilotDecisionReason" ADD VALUE 'REJECTED_MIN_RATING';
ALTER TYPE "AutopilotDecisionReason" ADD VALUE 'REJECTED_PRODUCT_COOLDOWN';
ALTER TYPE "AutopilotDecisionReason" ADD VALUE 'REJECTED_CATEGORY_DAILY_LIMIT';
