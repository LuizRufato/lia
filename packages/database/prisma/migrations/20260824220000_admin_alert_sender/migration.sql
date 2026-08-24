-- Additive sender selection for private administrator alerts.

ALTER TABLE "AdminAlertConfig"
  ADD COLUMN IF NOT EXISTS "adminWhatsappIntegrationId" TEXT;

CREATE INDEX IF NOT EXISTS "AdminAlertConfig_adminWhatsappIntegrationId_idx"
  ON "AdminAlertConfig"("adminWhatsappIntegrationId");

DO $$ BEGIN
  ALTER TABLE "AdminAlertConfig"
    ADD CONSTRAINT "AdminAlertConfig_adminWhatsappIntegrationId_fkey"
    FOREIGN KEY ("adminWhatsappIntegrationId") REFERENCES "ChannelIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
