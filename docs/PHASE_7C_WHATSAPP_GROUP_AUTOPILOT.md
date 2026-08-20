# Fase 7C: WhatsApp Group Autopilot via Gateway Não Oficial

## Objetivo
Ativar e parametrizar as publicações da LIA dentro de grupos padrões do WhatsApp, de forma 100% autônoma (End-to-End, desde a captação na Shopee até o post e cliques), via integração não-oficial Web (Evolution API).

## Metodologia & Arquitetura
1. **Isolamento de Domínio**: O `LIA Worker` operará via requisições HTTP seguras com o gateway (`WhatsAppEvolutionProvider`), abstraindo se é Baileys ou WPPConnect por trás. Se o gateway colapsar, todo o pipeline de Shopee, Tracking e Inteligência (Score) da LIA permanecerá intocável e funcionando sem perdas.
2. **Modelo Híbrido Reversível**: A implementação da fase atual *estende*, sem remover, o suporte do código já feito para a `WhatsApp Cloud API` na Fase 7A. Ambas as tecnologias coexistirão no modelo de Channels (por meio da coluna diferenciadora `transport`).
3. **Idempotência Reforçada**: Uma publicação é uma transação restrita: `[candidateId, channelId]`. Uma oferta jamais poderá ser repostada incorretamente em um grupo (salvo em timeout ambíguo lidado com restrições de estado - `DELIVERY_UNKNOWN`).

## Regras de Segurança e Privacidade
*   O segredo da sessão (State/QR) fica protegido exclusivamente no nó do gateway Evolution e nunca transita abertamente pelo projeto da LIA ou no repositório.
*   Mensagens textuais recebidas da comunidade nos grupos NÃO são persistidas nem processadas.
*   Kill Switch do Autopilot pode intervir antes de despachos enfileirados.

## Fluxo Estrito de Conversões e URLs (Regra de Ouro)
Nenhum envio sairá da LIA sob hipótese de `monetizationStatus` não verificado ou falho (`REJECTED_MONETIZATION`).
A mensagem aterrissará em um Grupo do WhatsApp **contendo exclusivamente um Tracker LIA (`s.lia.com/xxx`)**. Somente ao contabilizar o evento de Clique a LIA fará o Redirect HTTP (302) para a verdadeira e testada URL Oficial de afiliado da Shopee (que gera a comissão real).
