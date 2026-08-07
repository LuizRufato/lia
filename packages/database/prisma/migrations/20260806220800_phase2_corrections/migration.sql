-- DropForeignKey
ALTER TABLE "OfferEvaluation" DROP CONSTRAINT "OfferEvaluation_offerId_fkey";

-- DropIndex
DROP INDEX "OfferEvaluation_offerId_idx";

-- AlterTable
ALTER TABLE "Offer" ALTER COLUMN "commission" DROP NOT NULL;

-- AlterTable
ALTER TABLE "OfferEvaluation" DROP COLUMN "offerId",
ALTER COLUMN "score" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "OfferEvaluation_observationId_scoreVersion_key" ON "OfferEvaluation"("observationId", "scoreVersion");

