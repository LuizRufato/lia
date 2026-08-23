-- Additive tracker intelligence fields. Existing events remain intact and
-- receive null until their original classification is known at write time.
CREATE TYPE "ClickIntelligenceClass" AS ENUM ('HUMAN', 'BOT', 'PREVIEW_CRAWLER', 'SUSPECTED_AUTOMATION');

ALTER TABLE "ClickEvent"
  ADD COLUMN "intelligenceClass" "ClickIntelligenceClass",
  ADD COLUMN "operatingSystem" TEXT,
  ADD COLUMN "referrer" TEXT;

CREATE INDEX "ClickEvent_intelligenceClass_clickedAt_idx"
  ON "ClickEvent"("intelligenceClass", "clickedAt");
