# Mercado Livre - Capacidades de Automação (2026)

Este documento reflete a investigação técnica oficial das capacidades da API do Mercado Livre (tanto Developer quanto Afiliados) para integração no ecossistema da LIA (Lucro Inteligente Automatizado).

## 1. Auditoria do Código Atual (@lia/integrations)

- **MercadoLivreClient**: MOCK/STUB. Não implementa requisições reais.
- **MercadoLivreAdapter**: IMPLEMENTADO parcialmente. Converte respostas básicas (price, original_price), mas define `commission: NULL`.
- **MeliCatalogProvider**: STUB. Os métodos retornam arrays vazios `[]`.
- **MeliAffiliateLinkProvider**: UNAVAILABLE. Lança exceção `pending official API documentation`.
- **MeliAffiliateMetricsProvider**: UNAVAILABLE. Lança exceção `pending official API documentation`.
- **OAuth PKCE/State**: IMPLEMENTADO e funcional, porém restrito à **Mercado Livre Developer API**.

## 2. Discovery Oficial (Mercado Livre Developers API)

A documentação oficial para desenvolvedores permite a ingestão e leitura de dados de produtos.

- **Categorias e Busca**: `GET /sites/MLB/search?category={category_id}`
- **Highlights/Mais Vendidos**: Apesar da documentação antiga mencionar `/highlights`, hoje recomenda-se utilizar a busca com filtros de "tendências" ou consultar as APIs de catálogo.
- **Detalhes do Produto (`GET /items/{item_id}`)**:
  - `price` (Preço atual).
  - `original_price` (Preço original, permitindo cálculo do desconto).
  - `sold_quantity` (Vendas/Popularidade).
  - `shipping.free_shipping` (Frete).
  - Imagens, Vendedor e Reputação estão disponíveis.

**Conclusão do Discovery**: Mapeamento de `Catalog -> CanonicalOffer` é **TOTALMENTE SUPORTADO**.

## 3. Programa de Afiliados (API Inexistente)

Diferente da Shopee (que possui a *Shopee Affiliate Open API*), o **Mercado Livre NÃO POSSUI API oficial pública para Afiliados**.

| Capacidade | Status | Link/Evidência |
| :--- | :--- | :--- |
| **A)** API Pública p/ gerar link | UNAVAILABLE | Inexistente na documentação de Developers. Somente Gerador manual na Central. |
| **B)** Endpoint `generateShortLink` | UNAVAILABLE | - |
| **C)** Consulta de % Comissão | UNAVAILABLE | Sem endpoint de consulta por SKU/Categoria. |
| **D)** Ganhos Extras API | UNAVAILABLE | Restrito à UI da Central. |
| **E)** Métricas do Afiliado API | UNAVAILABLE | Restrito à UI da Central. |
| **F)** Vendas/Conversões API | UNAVAILABLE | - |
| **G)** Receita Validada API | UNAVAILABLE | - |
| **H)** Etiquetas via API | UNAVAILABLE | A criação de "Etiquetas" para rastrear origem é feita manualmente na UI. |
| **I)** SubIDs Dinâmicos | UNAVAILABLE | Não é possível anexar um `subId` arbitrário na URL. É preciso parear com uma "Etiqueta" pré-cadastrada. |
| **J)** Webhook de Conversão | UNAVAILABLE | O Webhook de orders do DevCenter só funciona para o próprio *Seller*, não para o Afiliado. |

## 4. O Isolamento do OAuth

O OAuth (criado na Fase 5) concede um `access_token` para a **Developer API**. Ele **não serve** para autenticar requisições no painel de afiliados. Portanto, o OAuth é válido para varrer o catálogo de produtos, mas inútil para o fluxo de monetização/links.

## 5. Mapeamento para Canonical Offer (ML)

Ao transformar um item do ML, a LIA deve aceitar:

```json
{
  "marketplace": "MERCADO_LIVRE",
  "externalOfferId": "MLB123456789",
  "price": 19990,
  "originalPrice": 29990,
  "discountBps": 3334,
  "commission": null, // CRÍTICO: Sempre NULL
  "monetizationStatus": "UNVERIFIED"
}
```
*Nenhuma comissão deve ser inferida/inventada.*

## 6. LIA Score Cross-Marketplace

A fórmula de LIA Score atual baseada em `Lucro Estimado = Preço * Taxa de Comissão` **irá quebrar e desfavorecer o Mercado Livre**, pois a `commission` será `null`.
Será necessário refatorar o LIA Score para utilizar "Categorias" ou "Comissão Média Presumida" caso a comparação mista seja ativada, ou isolar os rankings por marketplace.

## 7. Regras de Afiliado e WhatsApp

O Mercado Livre permite divulgação em grupos de WhatsApp e Telegram, **desde que sejam abertos/públicos**.
- **Proibido**: Spam individual (1-a-1 não solicitado), grupos fechados (onde só admins postam ou privados) e tráfego pago (Ads direto para o link).
O risco da Evolution/Meta (banimento do número) é separado da regra de comissão do ML. O ML valida a origem, se detectar tráfego invisível ou spam agressivo, cancela a conta de afiliado.

---

## 8. Matriz de Capacidades

| CAPABILITY | SHOPEE | MERCADO LIVRE | EVIDÊNCIA |
| :--- | :--- | :--- | :--- |
| Discovery | SUPPORTED | SUPPORTED | `api.mercadolibre.com/sites/MLB/search` |
| Best Sellers | SUPPORTED | SUPPORTED | Filtros e navegação via categorias |
| Product Details | SUPPORTED | SUPPORTED | `GET /items/{item_id}` |
| Discount | SUPPORTED | SUPPORTED | Propriedade `original_price` |
| Commission Rate | SUPPORTED | **UNAVAILABLE** | Sem API. UI apenas. |
| Commission Amount | SUPPORTED | **UNAVAILABLE** | Sem API. UI apenas. |
| Affiliate Link Generation| SUPPORTED | **UNAVAILABLE** | Sem API. Apenas RPA (Playwright/n8n) ou Central. |
| Attribution/SubID | SUPPORTED | **UNAVAILABLE** | Requer Etiquetas manuais. |
| Clicks | SUPPORTED | **UNAVAILABLE** | Sem API. |
| Conversions | SUPPORTED | **UNAVAILABLE** | Sem API. |
| Estimated Commission | SUPPORTED | **UNAVAILABLE** | Sem API. |
| Validated Commission | SUPPORTED | **UNAVAILABLE** | Sem API. |

---

## 9. Respostas Finais

1. **Conseguimos automatizar Discovery ML?** SIM (Via Developer API).
2. **Conseguimos calcular comissão antes de publicar?** NÃO (Falta API).
3. **Conseguimos gerar AffiliateLink automaticamente?** NÃO (Sem usar RPA / Web Scraping, não é possível).
4. **Conseguimos atribuir venda a Channel?** NÃO DINAMICAMENTE (apenas por cadastro manual de Etiquetas prévias).
5. **Conseguimos importar vendas?** NÃO.
6. **Conseguimos importar comissão?** NÃO.
7. **Qual parte impede hoje o fluxo 100% autônomo do ML?** A total ausência de uma API de Afiliados (necessidade de logar num navegador real, contornar reCAPTCHA e converter links na interface web).
