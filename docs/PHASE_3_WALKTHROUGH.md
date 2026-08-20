# Walkthrough Fase 3: Tracker & Telegram Publisher (V2 - Strict)

## O que foi construído?

1. **Schema Prisma**
   - Novas tabelas: `Channel`, `Publication`, `ClickEvent`.
   - Modificado `TrackedLink` para ser gerado dinamicamente com suporte a expiração e ser associado à `Publication`.
   - Adicionadas constraints de idempotência para `Publication` e `ClickEvent`.

2. **Core/Shared**
   - Implementado HMAC para hash diário de visitantes (`visitorHash`), eliminando IPs diretos para LGPD.
   - Detecção nativa de Bots, diferenciando crawlers normais de "Preview Bots" (Telegram/WhatsApp).

3. **Tracker App (Fastify)**
   - Serviço ultrarrápido criado puramente em Fastify, sem overhead do NestJS.
   - Retorna HTTP 302 direto para o `destinationUrl` + headers `no-store`.
   - Enfileira no BullMQ os eventos de clique assincronamente com Timeout restrito (não bloqueia o redirecionamento).

4. **Worker (Telegram Publisher & Click Ingestion)**
   - `PublisherProcessor`: Trata `PublicationCandidate` -> gera `TrackedLink` -> publica no Telegram (Bot API nativa via `@nestjs/axios`). Trata rate-limits (429) via `retry_after`.
   - `ClickProcessor`: Consome fila do tracker, salva no PostgreSQL com idempotência, e empurra contadores `Time-Bucketed` para o Redis (`clicks:rt:{tenantId}:{YYYYMMDDHHmm}`) de forma atômica.

5. **API & Dashboard Web**
   - API exporta `/analytics/realtime` fundindo os time-buckets do Redis com contagens precisas do PostgreSQL de cliques válidos hoje.
   - O Frontend agora é um **Client Component** com *polling suave (3s)* que exibe a atividade, ou uma tela "Vazia/Zero" real (sem dados fake).

---

## Preparação Final (Teste Real)

Para o primeiro teste E2E "End-to-End" completo fluir, eu preciso que você configure:

1. **Bot do Telegram:** Crie o Bot (via @BotFather) e adicione em um canal/grupo de testes como Administrador.
2. Acesse o **Token do Bot** e o **Chat ID** (onde as ofertas cairão).
3. Providencie um link de produto **Real**.

*Por favor, **NÃO** me envie o Token por aqui.* Configure o `.env` ou me avise para configurar de maneira segura localmente e inserir no banco.
