# Arquitetura da LIA

## Padrão
Monólito Modular utilizando estrutura de Monorepo.

## Componentes

### 1. `apps/web` (Dashboard)
Painel Administrativo para o operador (único usuário na V1). Interface premium com Next.js, consumindo a API.

### 2. `apps/api` (Core API)
Cérebro do sistema, provendo endpoints para o Dashboard e orquestrando as regras de negócio. Usa banco de dados principal.

### 3. `apps/worker` (Processamento Assíncrono)
Gerencia filas (BullMQ no Redis) para tarefas pesadas, agendamentos, requisições lentas para APIs externas, e sincronização de dados. 

### 4. `apps/tracker` (Redirecionador)
Serviço ultra-rápido, desacoplado (pode rodar no Edge no futuro), focado em capturar cliques, prevenir bots de preview e redirecionar para a URL de afiliado.

- `api`: Backend principal NestJS (Port 3000).
- `web`: Frontend Next.js 15 (Port 3001) atuando como painel administrativo.
- `worker`: Aplicativo NestJS isolado focando estritamente em Background Jobs consumindo BullMQ.
- `tracker`: (Futuro) Redirecionador leve e de alta performance.

## 4. Pacotes Compartilhados (`packages/`)
- `database`: Prisma ORM gerado de forma isolada (`schema.prisma` e migrations).
- `core`: Lógicas de domínio puro TypeScript. Contém o `CanonicalOffer`, validações Zod/Class-validator e motores de pontuação estáticos (`LiaScoreV1`), e regras puras (`DeduplicationRule`, `FatigueRule`).

## 5. Fluxo de Dados (Fase 2)
1. Observações brutas são ingeridas e tipadas no formato `CanonicalOffer`.
2. Salvas no banco via `OfferObservation`.
3. Worker de filas processa e avalia via Score System.
4. Gera uma `OfferEvaluation` (ELIGIBLE, REJECTED_*).
5. Candidatos aprovados geram um registro em `PublicationCandidate` (PENDING) aguardando o cron `ReconcilerService` ou ação direta para publicação nos canais.

- `integrations`: Conectores isolados (Shopee, Mercado Livre, WhatsApp, Telegram).
- `shared`: Tipos, utilitários, constantes.
- `config`: Validações de variáveis de ambiente.

## Infraestrutura Local
- PostgreSQL (Fonte da Verdade)
- Redis (Filas, Cache de alta performance)
- Docker (Orquestração local)
