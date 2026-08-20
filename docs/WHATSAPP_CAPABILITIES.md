# WhatsApp Cloud API - Capacidades Oficiais (Meta Graph API)

**Última verificação na Documentação Oficial:** 07 de Agosto de 2026  
**Fonte Principal:** [WhatsApp Business Platform - Graph API (developers.facebook.com)](https://developers.facebook.com/docs/whatsapp/cloud-api)

A LIA opera exclusivamente sobre a infraestrutura **OFICIAL** da Meta (Cloud API), exigindo adesão restrita às políticas e capacidades comprovadamente suportadas para Contas do WhatsApp Business (WABA). Abaixo encontra-se o mapeamento de capacidades arquiteturais para envio de ofertas.

---

### 1. Mensagem Individual (1-a-1)
- **Suporte Oficial Confirmado:** Sim
- **Status:** `AVAILABLE`
- **Detalhes:** O endpoint padrão `POST /{Phone-Number-ID}/messages` possui o parâmetro mandatório `recipient_type="individual"`. Pode-se enviar texto livre (se houver janela de 24h aberta pelo usuário) ou *Templates* aprovados fora dessa janela.
- **Referência:** [Messages Endpoint](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages)

### 2. Marketing Templates
- **Suporte Oficial Confirmado:** Sim
- **Status:** `AVAILABLE`
- **Detalhes:** O formato aprovado pela Meta para enviar notificações ou anúncios para bases de clientes (opt-in). Suporta texto, imagens, botões de Call To Action (CTAs) e formatação. Custam por conversa/template.
- **Aplicabilidade para LIA:** A LIA utilizará Templates de Marketing com botões para link rastreado.

### 3. Grupo Convencional do WhatsApp
- **Suporte Oficial Confirmado:** Não
- **Status:** `UNAVAILABLE`
- **Detalhes:** A WhatsApp Cloud API **não suporta** gerenciar ou enviar mensagens para grupos convencionais do WhatsApp por contas WABA padrão. O endpoint é explicitamente projetado para interações 1-a-1.
- **Limitações na LIA:** **BLOCKED_BY_META_CAPABILITY.** A meta do usuário de enviar ofertas para grupos convencionais NÃO pode ser alcançada nativamente pela Cloud API oficial. Uma estratégia de contorno arquitetural aprovada pelo usuário será necessária (ex: trocar a estratégia de grupo para listas de transmissão individuais).

### 4. Groups API Oficial (Beta/Partners)
- **Suporte Oficial Confirmado:** Parcial/Restrito
- **Status:** `REQUIRES_ELIGIBILITY`
- **Detalhes:** A Meta já testou suporte a grupos para parceiros e casos muito específicos (ex: companhias aéreas), mas não existe disponibilidade geral na Cloud API pública de mensagens em grupo para SMB/ferramentas SaaS convencionais abertas.

### 5. Lista / Broadcast
- **Suporte Oficial Confirmado:** Sim (Via Envio Paralelo/Template)
- **Status:** `AVAILABLE`
- **Detalhes:** Embora não exista um endpoint único tipo `POST /broadcast` passando um array gigantesco de números (como era comum em APIs antigas), a distribuição tipo *Broadcast* é **100% suportada** e projetada pela Meta enviando requisições paralelas individuais para a API, limitadas pela Tabela de Tier da WABA (Tier 1 = 1k, Tier 2 = 10k, Tier 3 = 100k, Tier 4 = Ilimitado mensagems iniciadas pela empresa / 24h).
- **Aplicabilidade LIA:** O modelo arquitetural viável dentro das regras oficias se torna construir "Listas de Distribuição" virtuais na LIA e disparar ofertas 1-a-1.

### 6. WhatsApp Channels (Canais)
- **Suporte Oficial Confirmado:** Não (Para WABAs Normais)
- **Status:** `UNAVAILABLE`
- **Detalhes:** O WhatsApp Channels não dispõe de uma API Graph pública para postagens automatizadas externas, sendo o recurso mantido por clientes nativos e parceiros exclusivos selecionados.

---

## Conclusão de Arquitetura (Atenção do Negócio)

Para respeitar as diretrizes de código:
> *"Não usar Baileys, WhatsApp Web, Puppeteer, Evolution API ou técnicas para contornar restrições da Meta."*

A infraestrutura **Cloud API da LIA foi construída assumindo envio individual usando Templates de Marketing.** Como o objetivo do usuário ("WhatsApp como canal principal") idealizava originalmente postar em grupos convencionais, essa frente está bloqueada pelo fornecedor. 

O código prosseguirá implementando o envio padrão, mas a estratégia comercial deverá ser adaptada (Lista de Transmissão individual massiva em vez de Grupo).
