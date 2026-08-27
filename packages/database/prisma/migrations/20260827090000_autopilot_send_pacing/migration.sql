ALTER TABLE "AutopilotConfig"
  ADD COLUMN "minSendIntervalMinutes" INTEGER,
  ADD COLUMN "maxSendIntervalMinutes" INTEGER,
  ADD COLUMN "nextEligibleSendAt" TIMESTAMP(3),
  ADD COLUMN "sendLeaseUntil" TIMESTAMP(3);
