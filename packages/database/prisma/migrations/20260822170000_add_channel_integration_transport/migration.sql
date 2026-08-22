-- Align ChannelIntegration with the Prisma model introduced in 64f24ef.
-- This migration is additive and preserves all existing rows.

CREATE TYPE "WhatsAppTransport" AS ENUM ('CLOUD_OFFICIAL', 'WEB_UNOFFICIAL');

ALTER TABLE "ChannelIntegration"
    ADD COLUMN "transport" "WhatsAppTransport" NOT NULL DEFAULT 'CLOUD_OFFICIAL',
    ADD COLUMN "externalInstanceName" TEXT;
