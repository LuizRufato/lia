-- Additive Autopilot state and retry metadata. Existing rows keep their status.
ALTER TYPE "PublicationCandidateStatus" ADD VALUE IF NOT EXISTS 'DEFERRED';

ALTER TYPE "AutopilotDecisionReason" ADD VALUE IF NOT EXISTS 'DEFERRED_DAILY_LIMIT';
ALTER TYPE "AutopilotDecisionReason" ADD VALUE IF NOT EXISTS 'DEFERRED_INTERVAL';
ALTER TYPE "AutopilotDecisionReason" ADD VALUE IF NOT EXISTS 'DEFERRED_OUTSIDE_SCHEDULE';
ALTER TYPE "AutopilotDecisionReason" ADD VALUE IF NOT EXISTS 'DEFERRED_INTEGRATION_UNHEALTHY';
ALTER TYPE "AutopilotDecisionReason" ADD VALUE IF NOT EXISTS 'DEFERRED_MONETIZATION';
ALTER TYPE "AutopilotDecisionReason" ADD VALUE IF NOT EXISTS 'SKIPPED_PERMANENT_POLICY';
ALTER TYPE "AutopilotDecisionReason" ADD VALUE IF NOT EXISTS 'DELIVERY_UNKNOWN';

ALTER TABLE "PublicationCandidate"
  ADD COLUMN IF NOT EXISTS "deferredReason" TEXT,
  ADD COLUMN IF NOT EXISTS "retryAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "PublicationCandidate_status_retryAt_idx"
  ON "PublicationCandidate"("status", "retryAt");
