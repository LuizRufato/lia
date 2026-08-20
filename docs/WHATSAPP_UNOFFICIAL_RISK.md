# Risco Oficial: Integração Não Oficial do WhatsApp (Web/Baileys)

## Contexto
O cliente (OWNER/Luiz) solicitou explicitamente e decidiu conscientemente pela utilização de uma integração **não oficial** de WhatsApp (via Evolution API / Baileys) para a Fase 7C da LIA. O objetivo dessa decisão é viabilizar o envio automático de ofertas em grupos convencionais do WhatsApp, capacidade que é estritamente proibida e limitada (máximo de 8 participantes) na WhatsApp Cloud API Oficial.

## Riscos Assumidos pelo Proprietário

1. **Banimento do Número**: A Meta possui heurísticas rigorosas contra bots em contas comuns do WhatsApp. O número dedicado da LIA poderá sofrer banimentos e bloqueios aleatórios por violar os Termos de Serviço do WhatsApp para usuários finais.
2. **Quedas de Conexão**: A infraestrutura não oficial depende de QR Codes e engenharia reversa do WhatsApp Web (Baileys). Desconexões forçadas e sessões deslogadas podem acontecer a qualquer momento, exigindo que o owner refaça o scan do QR Code manualmente.
3. **Falta de Suporte Oficial**: Não há garantias de estabilidade. Quando a Meta atualizar o protocolo Web, o serviço da Evolution API poderá ficar inoperante até que a comunidade atualize a biblioteca subjacente.
4. **Isolamento e Segurança**: Para reduzir riscos, a LIA tratará a API Gateway como uma caixa preta. Nenhuma conversa de grupo, além do necessário para roteamento, será lida ou processada pela LIA (Privacy by Design).

## Boas Práticas Adotadas

*   **Infraestrutura Isolada**: O Core da LIA (Worker) nunca importará o Baileys/Puppeteer diretamente. Toda a comunicação ocorrerá via REST/Webhooks para uma API de Gateway dedicada e externa (Evolution API).
*   **Segurança de Sessão**: QR Codes, auth states ou tokens locais gerados pelo gateway **jamais** serão cacheados ou expostos de maneira insegura pela infraestrutura da LIA. 
*   **Número Dedicado**: É mandatório utilizar um número de celular isolado, exclusivo para a operação da LIA, sem uso pessoal atrelado, visando minimizar o impacto de potenciais bloqueios.
*   **Circuit Breaker**: Mecanismos de salvaguarda internos na LIA estão encarregados de pausar enfileiramentos (KILL SWITCH) mediante queda do gateway, não perdendo publicações aprovadas.
