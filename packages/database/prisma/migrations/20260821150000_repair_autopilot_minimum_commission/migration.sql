-- Repair deployments that received the autopilot safety code before this
-- required column was recorded in the migration history.
ALTER TABLE "AutopilotConfig"
ADD COLUMN IF NOT EXISTS "minimumCommissionCents" INTEGER NOT NULL DEFAULT 500;
