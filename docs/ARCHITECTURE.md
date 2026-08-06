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

### 5. `packages/` (Bibliotecas Compartilhadas)
- `database`: Conexão com Postgres e esquemas do Prisma.
- `integrations`: Conectores isolados (Shopee, Mercado Livre, WhatsApp, Telegram).
- `shared`: Tipos, utilitários, constantes.
- `config`: Validações de variáveis de ambiente.

## Infraestrutura Local
- PostgreSQL (Fonte da Verdade)
- Redis (Filas, Cache de alta performance)
- Docker (Orquestração local)
