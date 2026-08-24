ALTER TABLE "MarketplaceIntegration"
  ADD COLUMN "lastDiscoveryAt" TIMESTAMP(3),
  ADD COLUMN "lastDiscoveryCategoryCount" INTEGER,
  ADD COLUMN "lastDiscoveryFoundCount" INTEGER,
  ADD COLUMN "lastDiscoveryCreatedCount" INTEGER,
  ADD COLUMN "lastDiscoveryIgnoredCount" INTEGER,
  ADD COLUMN "lastDiscoveryError" TEXT;

ALTER TABLE "OfferObservation"
  ADD COLUMN "discoverySource" TEXT,
  ADD COLUMN "sourceCategoryId" TEXT,
  ADD COLUMN "rankingPosition" INTEGER,
  ADD COLUMN "sourceEntityType" TEXT;
