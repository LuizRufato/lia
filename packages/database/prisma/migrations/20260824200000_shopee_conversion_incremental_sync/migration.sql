-- Keep conversion polling incremental without changing existing conversion data.
ALTER TABLE "MarketplaceIntegration"
  ADD COLUMN "lastConversionSyncAt" TIMESTAMP(3),
  ADD COLUMN "lastConversionError" TEXT;
