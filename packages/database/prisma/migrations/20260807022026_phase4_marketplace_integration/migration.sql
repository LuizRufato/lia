-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('NOT_CONNECTED', 'CONNECTING', 'CONNECTED', 'ERROR');

-- CreateTable
CREATE TABLE "MarketplaceIntegration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "MarketplaceType" NOT NULL,
    "publicIdentifier" TEXT,
    "encryptedSecret" TEXT,
    "iv" TEXT,
    "authTag" TEXT,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceIntegration_tenantId_provider_key" ON "MarketplaceIntegration"("tenantId", "provider");

-- AddForeignKey
ALTER TABLE "MarketplaceIntegration" ADD CONSTRAINT "MarketplaceIntegration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
