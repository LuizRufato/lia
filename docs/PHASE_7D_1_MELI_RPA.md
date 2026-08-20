# Documentação da Fase 7D.1 (Meli RPA Gateway)

## Visão Geral
Esta fase introduziu o microsserviço `apps/meli-rpa`, responsável unicamente pela automação da interface da Central de Afiliados do Mercado Livre via Playwright, convertendo Links Brutos (Product URLs) em Links de Afiliados Oficialmente Rastreados e Validados (`VERIFIED`).

## Princípios de Isolamento Adotados
1. **Isolamento de Processo:** A automação RPA consome memória e CPU do Chromium. Manter esse serviço fora do `apps/api` e `apps/worker` protege a estabilidade do Core (Shopee, Autopilot, Webhooks).
2. **Sessões Isoladas e Criptografadas:** Os cookies/session storage (`MarketplaceBrowserSession`) do Mercado Livre são guardados com encriptação forte `AES-256-GCM` na base de dados (`lia_db`), utilizando uma `MELI_RPA_SESSION_ENCRYPTION_KEY` dedicada e independente das chaves de integração comuns.
3. **Isolamento de DOM (Driver):** O sistema buscará usar um `MeliAffiliatePageDriver` no futuro. A alteração de DOM deve retornar `FAILED` para a Oferta, abortando a conversão do link de forma determinística (Fail-Closed Absoluto).
4. **Isolamento de Recurso Oficial:** A RPA Gateway foca APENAS no programa de Afiliados. A importação de catálogos e discovery (produtos, preço, estoque, vendedor) continua acontecendo através da API Pública Rest do Mercado Livre (Developers API).

## Distribuição de Links em Grupos de WhatsApp
A LIA implementa as restrições da Diretriz de Afiliados do ML na lógica de Negócios:
- **`MarketplacePublicationPolicy`**: Configurada para permitir envio de campanhas originadas no ML somente para `Channel.visibility === PUBLIC`.
- Grupos Fechados ou 1-a-1 de spam não poderão ser utilizados como destino do Autopilot para o ML.

## Testes e Infraestrutura (Mocks Atuais)
Conforme restrito nesta etapa:
- Nenhum script tentou logar, contornar CAPTCHA ou visitar `mercadolivre.com`.
- Todos os testes unitários do `meli-rpa` (Prisma Session DB e BullMQ Worker Processors) validam a coerência do sistema com mock DOMs.
- Concurrency está rigorosamente travada em 1 por processo, preservando as heurísticas anti-spam da conta Mercado Livre e garantindo que apenas uma navegação robótica aconteça simultaneamente.
