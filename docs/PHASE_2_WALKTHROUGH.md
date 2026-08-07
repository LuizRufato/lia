# Walkthrough - Fase 2 (Motor Central V1)

A **Fase 2** foi completamente implementada e corrigida de acordo com as restrições arquiteturais exigidas. O Motor Central V1 já está operacional, focado em garantir idempotência, escalabilidade e qualidade de dados antes da publicação.

## Principais Alterações Implementadas

### 1. Separação Definitiva de Testes (E2E Isolados)
- **`lia_test` e `lia-redis-test`**: Foi estabelecido isolamento total dos ambientes de teste E2E. O `setup-env.js` verifica e impede a execução se o banco de dados apontar para `lia_db`.
- **Limpeza**: Foi criada uma rotina que apaga estritamente os dados dos prefixos de teste E2E no Redis para evitar vazamento ou limpeza indesejada de filas.

### 2. IngestionService (Porta de Entrada)
- Todo o tráfego da API e Cron Jobs de ingestão agora passa pelo `IngestionService`.
- A ingestão utiliza **Zod** para assegurar que apenas payloads estritamente válidos de `CanonicalOffer` entrem na esteira.
- Criada a entidade `OfferObservation`, que salva o dado original no PostgreSQL *antes* de tentar qualquer envio de job ao Redis/BullMQ.

### 3. Reconciliação e Resiliência
- Implementado o `ReconcilerService` com cron (ou chamada manual) para varrer `OfferObservation` sem avaliação ou `PublicationCandidate` em estado de PENDING há muito tempo, reencaminhando-os para a fila.

### 4. Avaliação (LiaScoreV1)
- Lógica de pontuação implementada utilizando **Decimal.js** para precisão financeira na comissão.
- Fórmula: `Score = Score Bruto * sqrt(DataCoverage)`, punindo severamente dados incompletos.
- Regras de qualidade de oferta (Deal Quality), fadiga (limite de ofertas por dia/hora) e deduplicação implementadas.

### 5. Correção de Modelagem (`OfferEvaluation`)
- Removido o elo direto `offerId` de `OfferEvaluation`, forçando a linhagem estrita: `OfferEvaluation -> OfferObservation -> Offer`, com a integridade protegida via chave única `@@unique([observationId, scoreVersion])`.
- Resolvido o erro `P3018` ao refatorar as migrations e usar o banco de dados `lia_test` na esteira E2E (limpando o ambiente corrompido que havia sido gerado localmente).

### 6. Manifesto de Limpeza
- Criado o arquivo `manifest.md` na raiz do projeto com o registro exato dos tenants, observations e evaluations forjados durante as execuções de testes vazados na fase 1/início da fase 2.

## Validação e Qualidade
- ✅ Todos os testes E2E (`apps/api` e `apps/worker`) passam isolados de `lia_db`.
- ✅ Tipagem global revisada. Nenhuma falha de compilação em todo o repositório.
- ✅ Inicialização e endpoints `/health` de ambas as instâncias testadas manualmente e funcionais sem erros de ambiente ou conexões.

## Próximos Passos
O Core da aplicação está estável, robusto e matematicamente preciso, pronto para a **Fase 3** (Publicador e Distribuição).
