# Modelagem de Dados Base (Esboço)

Este documento evoluirá na Fase 1. O Postgres será a Fonte da Verdade.

## Entidades Previstas
1. **Products:** Informações imutáveis/base do produto.
2. **Offers:** Snapshot atual do preço/comissão/disponibilidade.
3. **Price History:** Snapshot histórico para analytics de preço.
4. **Tracked Links:** URLs geradas para o redirecionador (slug -> target_url).
5. **Clicks:** Eventos brutos vs validados de cliques recebidos no Tracker.
6. **Conversions/Commissions:** Vendas reportadas pelas integrações. Histórico de status será preservado, sem hard/soft deletes levianos.
7. **Campaigns/Sends:** Registro de qual mensagem foi enviada para qual grupo/canal.

## Deleção
Utilização de soft delete apenas em configurações e entidades que não devem quebrar relatórios antigos. Conversões terão status (pending, approved, rejected) e imutabilidade de histórico de alterações, priorizando auditoria.
