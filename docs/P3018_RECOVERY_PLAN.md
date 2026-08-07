# P3018 - Migration Recovery Plan

## Análise Atual (Somente Leitura)
- A migration `20260806220800_phase2_corrections` consta como **FAILED** (finished_at = null) na tabela `_prisma_migrations` em `lia_db`.
- O banco de dados `lia_db` **sofreu alterações estruturais parciais** (o que comprova que `prisma db push` foi executado indevidamente no passado para tentar contornar a falha):
  - A coluna `offerId` foi **removida** de `OfferEvaluation`.
  - A coluna `score` de `OfferEvaluation` está como **nullable**.
- No entanto, a instrução crucial da migration (`CREATE UNIQUE INDEX`) **não foi aplicada**, porque a existência dos registros duplicados forjados pelos testes quebrou a criação do índice único.
- Consequentemente, o banco está em um estado estruturalmente fragmentado: sem a coluna antiga e sem a proteção do índice novo.

## Plano de Recuperação

**DEPOIS** que a Limpeza dos dados contaminados for autorizada e executada, o seguinte fluxo deverá ser realizado para restaurar a integridade do banco sem perda de dados legítimos:

1. **Garantir a limpeza**: O script SQL de deleção apagará as `OfferEvaluation` duplicadas.
2. **Aplicar Índice Manualmente**: Como o `db push` anterior mutou a tabela, mas falhou no índice, devemos executar o SQL faltante de forma idempotente para corrigir o esquema real:
   ```sql
   CREATE UNIQUE INDEX "OfferEvaluation_observationId_scoreVersion_key" ON "OfferEvaluation"("observationId", "scoreVersion");
   ```
3. **Resolver Migration Antiga**: Como a estrutura de banco agora reflete exatamente o que a migration faria, podemos informar ao Prisma que a migration falha foi "resolvida":
   ```bash
   npx prisma migrate resolve --applied 20260806220800_phase2_corrections
   ```
4. **Deploy de Nova Migration**: Como adicionamos a coluna `category` no `schema.prisma` nesta auditoria cirúrgica para resolver a Queue Diversity, aplicaremos a nova migration de forma limpa:
   ```bash
   npx prisma migrate deploy
   ```
5. **Verificação**: `npx prisma migrate status` reportará sincronia total e sucesso.
