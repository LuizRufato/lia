# Walkthrough da Fase 4: Integração Shopee

Este documento detalha o que foi construído na Fase 4, onde preparamos a estrutura (frontend, backend e infraestrutura de integração) para conectar a LIA ao Shopee Affiliate Program, pendente da liberação da Open API da conta oficial.

## O que foi construído

1. **Banco de Dados (MarketplaceIntegration)**
   - Adicionada a tabela `MarketplaceIntegration` no PostgreSQL para armazenar os dados de qualquer integração de Marketplace por Tenant.
   - O campo `encryptedSecret` guarda o App Secret criptografado nativamente.
   - Foram preservadas as colunas `Offer.externalOfferId` e `Offer.externalProductId`, conforme requisitado.

2. **Criptografia Segura (AES-256-GCM)**
   - Criado `packages/core/src/security/encryption.ts` com funções `encryptSecret` e `decryptSecret`.
   - Utiliza a variável global `INTEGRATION_ENCRYPTION_KEY` definida no `.env`.
   - Foram adicionados testes rigorosos para garantir a impossibilidade de recuperação do secret com chave errada e para atestar o funcionamento correto do algoritmo GCM.

3. **Pacote de Integrações (`@lia/integrations`)**
   - Criado novo pacote focado puramente nos marketplaces, permitindo manter o `@lia/core` limpo.
   - `shopee.types.ts`: Mock de tipagens esperadas da Shopee.
   - `shopee.adapter.ts`: Converte um item da Shopee (mock) no formato `CanonicalOffer`. Respeitando a regra de que *null != 0*.
   - `shopee.client.ts`: Stub do Client HTTP. Inclui o gerador de assinatura HMAC-SHA256 padrão da Shopee, pronto para apontar para a URL real assim que a documentação oficial for provida.

4. **Worker Processor (`ShopeeProcessor`)**
   - Criada a fila `shopee-api-queue` no BullMQ.
   - O Processor descriptografa o secret de forma on-the-fly usando a chave mestra do `.env`, consome a Shopee API via `ShopeeClient`, e realiza o fluxo (atualmente bloqueado por exceção controlada indicando falta de acesso oficial à Open API).
   - Inclui proteção contra concorrência e tratamentos robustos de falha (salvando erros de forma legível no banco sem expor o secret).

5. **Dashboard UI (`apps/web`)**
   - Criada a tela real de Integração da Shopee em `/integrations/shopee`.
   - Permite Conectar informando App ID e App Secret.
   - Exibe status: Não Conectado, Conectado, Erro na Conexão.
   - Permite acionar a Sincronização via BullMQ.
   - As credenciais não são devolvidas para o frontend pela API (apenas mascaradas visualmente).

## Status Atual
**IMPLEMENTADA ESTRUTURALMENTE / E2E EXTERNO PENDENTE**
Aguardamos o recebimento e validação oficial da documentação Open API da Shopee Affiliate para habilitar o Crawler real.
