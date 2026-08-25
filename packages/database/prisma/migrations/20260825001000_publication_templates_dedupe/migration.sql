-- Remove only exact duplicates, keeping the most usable and oldest record:
-- default first, enabled first, then oldest creation time.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "tenantId", "type", "name", "body"
      ORDER BY "isDefault" DESC, "enabled" DESC, "createdAt" ASC, id ASC
    ) AS duplicate_rank
  FROM "PublicationTemplate"
  WHERE ("type"::text, "name", "body") IN (
    ('ACHADINHO', 'Achadinho seguro', E'🔥 *{titulo}*\n\n{preco_antigo}\n💰 *Por: {preco_atual}*\n{desconto}\n\n👉 {cta}\n{link}'),
    ('OFERTA', 'Oferta', E'🛍️ *{titulo}*\n\n💰 *{preco_atual}*\n{desconto}\n\n👉 {cta}\n{link}'),
    ('PRECO_CAIU', 'Preço caiu', E'📉 *Preço observado em queda*\n\n*{titulo}*\n{preco_antigo}\nAgora: *{preco_atual}*\n{desconto}\n\n👉 {cta}\n{link}'),
    ('MAIS_VENDIDO', 'Mais vendido', E'🔥 *{titulo}*\n\n📦 {sales_count} vendidos\n💰 *{preco_atual}*\n\n👉 {cta}\n{link}'),
    ('GENERIC', 'Genérico seguro', E'*{titulo}*\n\n💰 *{preco_atual}*\n\n👉 {cta}\n{link}')
  )
)
DELETE FROM "PublicationTemplate" AS template
USING ranked
WHERE template.id = ranked.id
  AND ranked.duplicate_rank > 1;

-- Repair any pre-existing tenant with more than one default before adding
-- the database-level one-default invariant.
WITH ranked_defaults AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "tenantId"
      ORDER BY "enabled" DESC, "createdAt" ASC, id ASC
    ) AS default_rank
  FROM "PublicationTemplate"
  WHERE "isDefault" = true
)
UPDATE "PublicationTemplate" AS template
SET "isDefault" = false
FROM ranked_defaults
WHERE template.id = ranked_defaults.id
  AND ranked_defaults.default_rank > 1;

-- Defaults are a fixed, short set owned by the application. Partial indexes
-- keep the exact tenant + type + name + body invariant without indexing an
-- arbitrary 4,000-character custom body.
CREATE UNIQUE INDEX "PublicationTemplate_default_achadinho_key"
  ON "PublicationTemplate" ("tenantId")
  WHERE "type" = 'ACHADINHO'
    AND "name" = 'Achadinho seguro'
    AND "body" = E'🔥 *{titulo}*\n\n{preco_antigo}\n💰 *Por: {preco_atual}*\n{desconto}\n\n👉 {cta}\n{link}';

CREATE UNIQUE INDEX "PublicationTemplate_default_oferta_key"
  ON "PublicationTemplate" ("tenantId")
  WHERE "type" = 'OFERTA'
    AND "name" = 'Oferta'
    AND "body" = E'🛍️ *{titulo}*\n\n💰 *{preco_atual}*\n{desconto}\n\n👉 {cta}\n{link}';

CREATE UNIQUE INDEX "PublicationTemplate_default_preco_caiu_key"
  ON "PublicationTemplate" ("tenantId")
  WHERE "type" = 'PRECO_CAIU'
    AND "name" = 'Preço caiu'
    AND "body" = E'📉 *Preço observado em queda*\n\n*{titulo}*\n{preco_antigo}\nAgora: *{preco_atual}*\n{desconto}\n\n👉 {cta}\n{link}';

CREATE UNIQUE INDEX "PublicationTemplate_default_mais_vendido_key"
  ON "PublicationTemplate" ("tenantId")
  WHERE "type" = 'MAIS_VENDIDO'
    AND "name" = 'Mais vendido'
    AND "body" = E'🔥 *{titulo}*\n\n📦 {sales_count} vendidos\n💰 *{preco_atual}*\n\n👉 {cta}\n{link}';

CREATE UNIQUE INDEX "PublicationTemplate_default_generico_key"
  ON "PublicationTemplate" ("tenantId")
  WHERE "type" = 'GENERIC'
    AND "name" = 'Genérico seguro'
    AND "body" = E'*{titulo}*\n\n💰 *{preco_atual}*\n\n👉 {cta}\n{link}';

-- Prisma cannot express a tenant-scoped partial unique index. Keep the
-- one-default-per-tenant invariant at the database boundary as well.
CREATE UNIQUE INDEX "PublicationTemplate_one_default_per_tenant_idx"
  ON "PublicationTemplate" ("tenantId")
  WHERE "isDefault" = true;
