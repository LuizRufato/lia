# Integrações LIA

Este arquivo documenta as APIs externas consumidas e regras específicas de cada uma.

## Shopee
- **Status:** Não conectada.
- **Tipo de API:** Necessita confirmação da API oficial disponível para a conta de afiliado (não assumir API de seller).
- **Dados Coletados:** Ofertas, Links, Pedidos.

## Mercado Livre
- **Status:** Não conectada.
- **Tipo de API:** Necessita confirmação do programa de afiliados do Mercado Livre. 
- **Regra:** Não utilizar `sold_quantity` público como conversão. Usar relatórios do programa.

## Telegram
- **Status:** Não conectada.
- **Tipo:** Bot API.

## WhatsApp
- **Status:** Não conectada.
- **Tipo:** Meta Cloud API.
- **Regra:** Validação pendente sobre suporte nativo a postagem em grupos. Sem evasion, com filas de rate limit.
