# Histórico de Decisões Arquiteturais

## DEC-001: Monólito Modular
- **Decisão:** Iniciar o projeto como um monólito modular utilizando monorepo (apps e packages separados), ao invés de microsserviços totalmente isolados por rede desde o dia zero.
- **Motivo:** Evita complexidade prematura (como tracking distribuído complexo e deployment orchestration), mantendo separação de responsabilidades. O Tracker (`apps/tracker`) foi mantido isolado para poder ser deployado em Edge/serverless no futuro, mas compartilha código (`packages/shared`).

### Phase 2: Core Engine V1
- **CanonicalOffer**: Estrutura unificada e tipada onde dados desconhecidos utilizam estritamente `null` e não `0`, diferenciando explicitamente "ausência de dado" de "valor zero".
- **Database Persistence Before Queue**: Para evitar perda de observações em caso de falha do Redis, a entidade `OfferObservation` é salva no PostgreSQL ANTES do processamento nos workers. Jobs trafegam apenas UUIDs (correlationId, observationId).
- **LiaScoreV1**: Utilização da biblioteca `Decimal.js` ao invés de cálculos normais de ponto flutuante no motor de Score para precisão matemática, gerando pontuações não-lineares compostas por fatores como desconto, confiabilidade da fonte e completude do dado (`dataCoverage`).
- **Prisma V7 Driver Adapters**: Devido a problemas de inicialização do PrismaClient no NestJS sob testes E2E, adotamos o `@prisma/adapter-pg` com o pool `pg` nativo. O `url` foi removido do `schema.prisma`.

## DEC-002: PostgreSQL Fonte da Verdade
- **Decisão:** PostgreSQL manterá os registros vitais (vendas, comissões, configurações, cliques analisados). Redis será apenas para transient data (rate limit, bullmq queues, cache efêmero).
- **Motivo:** Garantir a persistência e não perder dinheiro (relatórios de comissão) em caso de restart do cluster Redis.

## DEC-003: Uso Direto de Links do Mercado Livre (Sem Redirect 302)
- **Decisão:** Diferente da Shopee, onde utilizamos o encurtador próprio (LIA Tracker) com redirecionamento 302, a LIA publicará DIRETAMENTE os links gerados pela Central de Afiliados do Mercado Livre, utilizando as Etiquetas nativas da plataforma para rastrear Channel/Tenant.
- **Motivo:** Compliance com a Diretriz de Afiliados do ML, que proíbe o redirecionamento automático de domínios terceiros para o mercadolivre.com.br.
