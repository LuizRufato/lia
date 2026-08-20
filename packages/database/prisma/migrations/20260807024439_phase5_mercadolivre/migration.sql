-- CreateEnum
CREATE TYPE "ChannelVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- AlterEnum
ALTER TYPE "IntegrationStatus" ADD VALUE 'NEEDS_REAUTH';

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "visibility" "ChannelVisibility" NOT NULL DEFAULT 'PRIVATE';

-- AlterTable
ALTER TABLE "MarketplaceIntegration" ADD COLUMN     "encryptedRefreshToken" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "refreshAuthTag" TEXT,
ADD COLUMN     "refreshIv" TEXT;
