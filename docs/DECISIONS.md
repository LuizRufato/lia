# Histórico de Decisões Arquiteturais

## DEC-001: Monólito Modular
- **Decisão:** Iniciar o projeto como um monólito modular utilizando monorepo (apps e packages separados), ao invés de microsserviços totalmente isolados por rede desde o dia zero.
- **Motivo:** Evita complexidade prematura (como tracking distribuído complexo e deployment orchestration), mantendo separação de responsabilidades. O Tracker (`apps/tracker`) foi mantido isolado para poder ser deployado em Edge/serverless no futuro, mas compartilha código (`packages/shared`).

## DEC-002: PostgreSQL Fonte da Verdade
- **Decisão:** PostgreSQL manterá os registros vitais (vendas, comissões, configurações, cliques analisados). Redis será apenas para transient data (rate limit, bullmq queues, cache efêmero).
- **Motivo:** Garantir a persistência e não perder dinheiro (relatórios de comissão) em caso de restart do cluster Redis.
