-- Keep the database enum aligned with @lia/core's decision contract.
ALTER TYPE "AutopilotDecisionReason" ADD VALUE IF NOT EXISTS 'REJECTED_MINIMUM_COMMISSION';
