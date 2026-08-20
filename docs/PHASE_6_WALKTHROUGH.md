# Walkthrough Fase 6: Piloto Automático

A Fase 6 introduziu a automação completa do processo de avaliação, agendamento e publicação, conhecida como Piloto Automático da LIA.

## O que foi implementado

1. **Contexto de Tenant (`TenantMembership`)**
   - Agora, a vinculação entre administradores e tenants é feita de forma segura no servidor, não dependendo de parâmetros do lado do cliente.

2. **Core de Avaliação (`AutopilotBrain`)**
   - Desenvolvido no pacote `@lia/core`, atua de forma determinística e independente dos bancos de dados, avaliando `CanonicalOffer` usando `AutopilotConfigSnapshot` e `AutopilotRuntimeContext`.

3. **Duplo Kill Switch**
   - O agendador (`AutopilotSchedulerService`) não seleciona ofertas se a configuração estiver `OFF` ou `MANUAL`.
   - O publicador (`PublisherProcessor`) revalida o estado no banco *imediatamente* antes de disparar o webhook do Telegram, evitando que jobs parados ou atrasados na fila publiquem após um botão de emergência.

4. **Tratamento de Monetização (`MonetizationRecord`)**
   - Ofertas agora dependem explicitamente de uma verificação de link de afiliado (`VERIFIED`) para rodarem em modo `AUTO`.
   - O modo `DRY_RUN` alerta e simula a publicação de links `UNVERIFIED`.

5. **Interface de Dashboard**
   - Criada a página do Piloto Automático `/admin/autopilot` no painel administrativo Next.js, conectada via API segura do NestJS.
   - Status claro e botão de emergência (Kill Switch).

6. **Bloqueios e Tolerância a Falhas (Lock)**
   - Lock otimista no Redis usando Lua script de "compare-and-delete" para impedir execução dupla do Scheduler no mesmo minuto.

## Validação

- `AutopilotBrain.spec.ts` cobre todos os cenários principais, como restrições de horários atravessando meia-noite, modos DRY_RUN vs AUTO, e fadiga de posts.
- Os requests administrativos de dashboard utilizam AuthGuard e resolvem explicitamente o Tenant pelo banco.
