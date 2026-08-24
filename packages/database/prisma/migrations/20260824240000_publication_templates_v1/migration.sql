-- CreateEnum
CREATE TYPE "PublicationTemplateType" AS ENUM ('ACHADINHO', 'OFERTA', 'PRECO_CAIU', 'MAIS_VENDIDO', 'GENERIC');

-- CreateEnum
CREATE TYPE "PublicationTemplateCtaMode" AS ENUM ('AUTO', 'CUSTOM');

-- CreateTable
CREATE TABLE "PublicationTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PublicationTemplateType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "ctaMode" "PublicationTemplateCtaMode" NOT NULL DEFAULT 'AUTO',
    "customCta" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublicationTemplate_tenantId_enabled_idx" ON "PublicationTemplate"("tenantId", "enabled");

-- CreateIndex
CREATE INDEX "PublicationTemplate_tenantId_type_idx" ON "PublicationTemplate"("tenantId", "type");

-- AddForeignKey
ALTER TABLE "PublicationTemplate" ADD CONSTRAINT "PublicationTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
