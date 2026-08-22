# Estado atual do Projeto LIA

Última atualização: 2026-08-22

## Funcionando (Fase 0 Concluída)
* Estrutura de pastas do monorepo criada.
* Documentação base inicializada e atualizada.
* Git configurado (Branch principal: `main`).
* Repositório remoto configurado: `https://github.com/LuizRufato/lia` (`origin`).
* Push inicial já realizado.
* Docker Desktop configurado com WSL 2 e SVM operacionais.
* Contêineres PostgreSQL e Redis configurados e operantes localmente.
* Serviços limitados a `127.0.0.1` e healthchecks aplicados no `docker-compose.yml`.
* Repositório Git configurado com `.gitignore` devidamente estruturado. Nenhum secret ou `.env` real está rastreado.

## Parcial
* Nenhuma pendência da Fase 0.

## Aguardando credenciais / Ações do Usuário
* Nenhuma ação necessária no momento.

## Não iniciado
* Módulos, Tracker, Shopee, ML, WhatsApp, Telegram, etc.

## Problemas conhecidos
* Build local do Web pode falhar sem acesso à Google Fonts; o código não foi alterado para contornar isso nesta fase.

## Fases do Projeto

- [x] **Fase 0**: Configuração Inicial (Linter, Prettier, Prisma, Docker)
- [x] **Fase 1**: Gateway de Acesso (Login, JWT, Rotas Públicas/Privadas)
- [x] **Fase 2**: Motor Central V1 (Score, Limitações)
- [x] **Fase 3**: Publicador (Telegram Bot)
  - ✅ implementação técnica concluída
  - ⏸ integração Telegram real adiada pelo usuário
  - ⏸ teste E2E real pendente
  - ✅ testes automatizados permanecem aprovados
- [x] **Fase 4**: Integração Shopee
  - ✅ Implementada estruturalmente (Banco, Criptografia, API, UI e BullMQ)
  - ✅ Criptografia extraída para `@lia/integrations`
  - ⏸ E2E externo pendente (Aguardando Open API oficial)
- [x] **Fase 5**: Integração Mercado Livre
  - ✅ Implementada estruturalmente (Banco, OAuth PKCE, API, UI, Worker Refresh Lock)
  - ✅ Separação Categórica (Catalog vs Affiliate)
  - ✅ Políticas de Publicação (MERCADO_LIVRE bloqueia canal PRIVATE)
  - ⏸ E2E externo e liberação da API de Afiliados oficial (Pendente)
- [x] **Fase 6**: Piloto Automático (Autopilot)
  - ✅ Motor Core de decisão e Score (AutopilotBrain puro)
  - ✅ Scheduler via Cron e Publisher com Re-validação (Kill Switch Duplo)
  - ✅ Lock Distribuído por Tenant com Lua
  - ✅ Engine de Copy baseada no TrackedLink final e Currency
  - ✅ Dashboard UI (Status OFF/MANUAL/DRY_RUN/AUTO e Feed de Auditoria)
  - ✅ Segurança multi-tenant com TenantMembership
  - ✅ Estados seguros PENDING/DEFERRED/QUEUED/PUBLISHING/PUBLISHED/SKIPPED/FAILED
  - ✅ DRY_RUN sem mutação de candidato/publicação ou enfileiramento
  - ✅ Janela, intervalo e limite diário calculados em `America/Campo_Grande`/fuso IANA do tenant
  - ✅ Idempotência do Publisher, recuperação stale e política conservadora DELIVERY_UNKNOWN
- [x] **Fase 7A**: Integração WhatsApp
  - ✅ Integração Meta Cloud API homologada (Conexão estrutural, Types, Banco).
- [x] **Fase 7B.1**: Shopee Open API E2E
  - ✅ Conexão oficial GraphQL Shopee (productOfferV2) com HMAC SHA256.
  - ✅ Sincronização em Lote orquestrada via BullMQ (`shopee.processor.ts`).
  - ✅ Apresentação visual da extração na rota `/offers`.

## Próximos Passos
- Fase 7B.2: Geração oficial do ShortLink (Tracking) da Shopee para monetização e habilitar publicação.

## Integrações
Shopee: Conexão estrutural completa e homologada. (Aguardando usuário testar no navegador)
Mercado Livre: Não conectada (E2E pendente)
Telegram: Congelado
WhatsApp: Conexão estrutural completa

## Últimos testes
* `docker compose config` validado.
* Teste de conexão no PostgreSQL e Redis realizados.
* Status dos healthchecks dos contêineres validados (healthy).
