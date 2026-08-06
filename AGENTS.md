# Instruções para Agentes IA no Projeto LIA

**Nome:** LIA (Lucro Inteligente Automatizado)

## Regras Críticas para IAs (Codex, ChatGPT, Antigravity)
1. **NUNCA inventar dados ou integrações.** Se não houver dados, mostre "Desconectado" ou similar.
2. **NUNCA commitar secrets.** `.env` nunca vai pro Git.
3. **Antes de declarar concluído, verificar.** Execute testes e linter.
4. **Preservar decisões existentes.** Leia `docs/DECISIONS.md` antes de mudar arquitetura.
5. **Ler sempre `docs/PROJECT_STATE.md`** para saber onde estamos no desenvolvimento.

## Arquitetura Resumida
Monorepo modular. Postgres como banco principal. Redis para cache e filas. Node.js backend, React/Next.js frontend. Redirecionador (Tracker) leve e desacoplado.

## Comandos Principais
(Serão preenchidos à medida que configuramos o package.json raiz).
