-- CreateEnum
CREATE TYPE "EvaluationDecision" AS ENUM ('ELIGIBLE', 'REJECTED_LOW_SCORE', 'REJECTED_FATIGUE', 'REJECTED_DUPLICATE', 'REJECTED_INSUFFICIENT_DATA', 'ERROR');

-- CreateEnum
CREATE TYPE "PublicationCandidateStatus" AS ENUM ('PENDING', 'QUEUED', 'PUBLISHING', 'PUBLISHED', 'SKIPPED', 'FAILED');

-- DropForeignKey
ALTER TABLE "Offer" DROP CONSTRAINT "Offer_productId_fkey";

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "tenantId" TEXT NOT NULL,
ADD COLUMN     "title" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "productId" DROP NOT NULL,
ALTER COLUMN "externalId" SET NOT NULL,
ALTER COLUMN "url" SET NOT NULL;

-- CreateTable
CREATE TABLE "OfferObservation" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "canonicalPayload" JSONB NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferEvaluation" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "scoreVersion" TEXT NOT NULL,
    "score" DECIMAL(65,30) NOT NULL,
    "decision" "EvaluationDecision" NOT NULL,
    "decisionReasons" TEXT[],
    "scoreBreakdown" JSONB NOT NULL,
    "inputsSnapshot" JSONB NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationCandidate" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "status" "PublicationCandidateStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicationCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "discountBps" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OfferObservation_correlationId_key" ON "OfferObservation"("correlationId");

-- CreateIndex
CREATE INDEX "OfferEvaluation_offerId_idx" ON "OfferEvaluation"("offerId");

-- CreateIndex
CREATE INDEX "OfferEvaluation_decision_evaluatedAt_idx" ON "OfferEvaluation"("decision", "evaluatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationCandidate_evaluationId_key" ON "PublicationCandidate"("evaluationId");

-- CreateIndex
CREATE INDEX "PublicationCandidate_status_createdAt_idx" ON "PublicationCandidate"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PriceHistory_offerId_createdAt_idx" ON "PriceHistory"("offerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_tenantId_marketplaceId_externalId_key" ON "Offer"("tenantId", "marketplaceId", "externalId");

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferObservation" ADD CONSTRAINT "OfferObservation_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferEvaluation" ADD CONSTRAINT "OfferEvaluation_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferEvaluation" ADD CONSTRAINT "OfferEvaluation_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "OfferObservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationCandidate" ADD CONSTRAINT "PublicationCandidate_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "OfferEvaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
