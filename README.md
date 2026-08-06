# LIA - Lucro Inteligente Automatizado

A LIA é uma plataforma inteligente de automação para marketing de afiliados, projetada para encontrar oportunidades com maior lucro esperado e distribuí-las automaticamente.

## Objetivo Central
MAXIMIZAR A COMISSÃO ESPERADA POR DIVULGAÇÃO.

## Sobre o Repositório
Este é um monorepo modular em TypeScript contendo a interface, API, workers e o redirecionador (tracker).

## Estrutura do Projeto
- `apps/web`: Frontend do Dashboard Admin (Next.js).
- `apps/api`: Backend Modular (NestJS).
- `apps/worker`: Processadores de fila (BullMQ).
- `apps/tracker`: Redirecionador rápido (Fastify).
- `packages/`: Bibliotecas compartilhadas (banco, integrações, config).

## Mais Informações
- [Arquitetura](docs/ARCHITECTURE.md)
- [Estado do Projeto](docs/PROJECT_STATE.md)
- [Instruções para Agentes IA](AGENTS.md)
