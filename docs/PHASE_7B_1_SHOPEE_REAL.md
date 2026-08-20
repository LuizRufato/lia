# Phase 7B.1 - Shopee Real E2E Connection

## Status Técnico
**Aprovado e Implementado:** Sincronização 1-way (read-only) via GraphQL.

## O que foi feito
1. **ShopeeAffiliateClient**: Implementação do cálculo exigido de assinatura `SHA256(AppId + Timestamp + Payload + Secret)` injetando as variáveis seguras sem intermediários de parse.
2. **ShopeeAdapter**: Mapeamento completo dos tipos GraphQL, resolvendo a diferença de escala de `bps` entre `priceDiscountRate` (10%) e `commissionRate` ("0.25") utilizando `Decimal.js` para arredondamentos precisos que evitam perda de cêntimos em conversão financeira BRL->Cents.
3. **UI / Modal**: Construído `ShopeeConfigModal` idêntico ao modelo WhatsApp, permitindo input `write-only` (password mode) para o App Secret e disparo do endpoint `Testar Conexão`.
4. **Offers UI**: Tabela da página `/offers` conectada via requisição GET autenticada e _tenant-scoped_ à tabela de Ofertas consolidada do BD (usando `fetchAuth`). Exibição de LIA Score, Comissão (BRL) real e Thumbnails.

## Regras de Negócio e Segurança Preservadas
- **Rate Limit Conservador:** O sync BullMQ tem rate limit estrito de max 2 requisições por segundo.
- **Isolamento de Tenant:** Consultas na API (incluindo o GET `/offers` e POST `/shopee/sync`) usam o token JWT do usuário ativo, impossibilitando cross-tenant leakage.
- **Idempotência:** Disparos acidentais múltiplos do Botão de Sync usam correlação baseada no ID original da oferta da Shopee, o que garante 0% de chance de duplicação.

## Próximos Passos
- **Fase 7B.2 (ShortLink)**: A LIA ainda NÃO publica o produto de forma automática. O campo `Monetization` ainda figura como 'Aguardando Link'. Na próxima etapa, implementaremos o endpoint GraphQL oficial capaz de gerar a URL curta de afiliado (ShortLink/subId).
