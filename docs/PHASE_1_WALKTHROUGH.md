# Walkthrough da Fase 1: Arquitetura Inicial

## O que foi implementado e corrigido:

1. **Repositório Git & GitHub:**
   - Commit inicial vinculado à identidade real.
   - Segredos (.env) isolados e ignorados corretamente.

2. **Infraestrutura e Banco de Dados (Prisma & PostgreSQL):**
   - Criação do serviço global `PrismaService` para gerenciar conexões.
   - Migrations do Prisma para tabelas do sistema (`AdminUser`, `Tenant`, `Product`, `Offer`, `Marketplace`, `TrackedLink`).
   - Healthchecks reais no banco e no Redis (ping).

3. **Autenticação (NestJS API):**
   - Implementação de `JwtAuthGuard` global usando `APP_GUARD`.
   - Remoção de fallback de `JWT_SECRET` (fails-fast system).
   - Validação forte do JWT usando Joi.
   - Uso de `@Public()` decorator apenas em rotas seguras (health, login).

4. **CLI Administrativa (NestJS):**
   - Script seguro para criação do primeiro administrador interativamente (`npm run admin:create -- --email...`).
   - Senhas protegidas e ocultas no terminal, usando hashing (bcrypt).
   - Validação forte de senha para novos usuários.

5. **Front-end Web (Next.js):**
   - Setup com Tailwind v4.
   - Sistema de rotas dinâmicas.
   - Implementação de `proxy.ts` (substituto do Next.js Middleware para v16.3) para validar autenticação e redirecionamento.

## Testes Realizados e Aprovados:
- Testes Unitários de API (100% de sucesso).
- Testes E2E (Autenticação Global e Healthcheck).
- Next.js Web Build Production.
- NestJS API Build Production.
