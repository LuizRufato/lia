# LIA Ads V1 — aquisição de membros

Este domínio é separado da fundação legada de Sponsored Ads. A migração é
aditiva e todos os efeitos externos permanecem desligados por padrão.

## Meta

`MetaConnection` guarda somente o material criptografado no servidor. A UI
recebe status, ativos mascarados e permissões, nunca tokens. O fluxo OAuth usa
state de uso único com expiração curta. O provider desta fase expõe somente a
interface de descoberta de ativos; operações de campanha são rejeitadas.

O primeiro escopo implementado é `ads_read`, o mínimo para a etapa de leitura.
`ads_management` e permissões de negócio/ativos só devem ser adicionadas após
confirmar a necessidade exata da próxima etapa e os requisitos de App Review na
documentação oficial da Meta:

- https://developers.facebook.com/docs/marketing-api/
- https://developers.facebook.com/docs/marketing-api/get-started/authorization/

## Grupos e privacidade

`LiaWhatsAppGroup` é o registro oficial. Contagens de crescimento excluem o
grupo `Teste` e eventos guardam somente HMAC do participante. A camada de
ingestão aceita JOIN, LEAVE e REMOVE idempotentemente; a integração de eventos
da Evolution permanece uma próxima etapa, sem alterar a versão ou a sessão
existente.

O roteador só retorna convite HTTPS de grupo oficial, ativo, publicável e
abaixo do limite. Sem grupo elegível, a landing mostra indisponibilidade e não
redireciona para URL inválida.

## Flags

- `liaAdsEnabled`: habilita apenas a casca do produto;
- `liaAdsMetaEnabled`: conexão Meta;
- `liaAdsMetaWriteEnabled`: escrita Meta;
- `liaAdsGroupRoutingEnabled`: roteamento dinâmico;
- `liaAdsGroupAutoProvisionEnabled`: criação automática;
- `liaAdsAlertsEnabled`: alertas de aquisição.

Somente a primeira flag tem default `true`; todas as ações externas têm
default `false`. O modo de provisionamento é `SHADOW` e nunca chama criação de
grupo.
