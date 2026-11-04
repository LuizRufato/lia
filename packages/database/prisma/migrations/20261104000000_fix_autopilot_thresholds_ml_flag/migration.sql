-- Alinhar mínimos do funil de autopilot ao ScoreConfig (40) e baixa comissão
-- de catálogo Shopee de ticket baixo; flag tenant-level para ML.
ALTER TABLE "AutopilotConfig" ALTER COLUMN "minScore" SET DEFAULT 40;
ALTER TABLE "AutopilotConfig" ALTER COLUMN "minimumCommissionCents" SET DEFAULT 50;

ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "allowMercadoLivrePublish" BOOLEAN NOT NULL DEFAULT false;
