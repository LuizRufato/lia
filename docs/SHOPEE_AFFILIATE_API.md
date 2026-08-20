# Shopee Affiliate Open API Brasil

## Overview
A LIA integra nativamente a API oficial da Shopee (Shopee Affiliate Open API) no Brasil para extrair as ofertas com as melhores comissões e, futuramente, gerar Links Rastreáveis (ShortLinks).

## Endpoint e Conexão
- **Endpoint:** `https://open-api.affiliate.shopee.com.br/graphql`
- **Rate Limit Oficial:** 8.000 requisições por hora.
- **Autenticação:** Baseada na regra oficial do `SHA256(AppId + Timestamp + Payload + Secret)` com hexadecimal lowercase de 64 caracteres.

## Fases de Integração
- **Fase 7B.1 (Atual):** Conexão E2E validada. Leitura da listagem `productOfferV2`. Inserção manual ("Sincronizar ofertas agora") em lote de 20 em 20 no pipeline principal.
- **Fase 7B.2 (Futura):** Geração dinâmica do Tracking Link (subId) para o link oficial de afiliação.
- **Fase 7B.3 (Futura):** Leitura de `Conversion Report` para injetar Analytics de vendas.

## Padrões de Segurança LIA
- O **App Secret** da Shopee é salvo encriptado no banco de dados via **AES-256-GCM** na tabela `MarketplaceIntegration`.
- NUNCA trafegamos o Secret via frontend em requisições de Leitura. Ele é Write-Only (exibido como `••••••••`).
- A assinatura GraphQL exige serialização exata do JSON (sem formatação condicional entre o Hashing e o Fetch) enviando o body completo.

## Estrutura do GraphQL
A requisição enviada é uma querie padrão `productOfferV2` parametrizada:
```graphql
query productOfferV2($page: Int!, $limit: Int!, $sortType: Int) {
  productOfferV2(page: $page, limit: $limit, sortType: $sortType) {
    nodes {
      itemId
      commissionRate
      commission
      ...
    }
  }
}
```
A LIA normaliza os dados usando as devidas conversões:
- BRL Money Strings (ex "45.99") -> Cents (4599) via `Decimal.js`
- Percents (ex "0.25") -> BPS (2500) via `Decimal.js`
