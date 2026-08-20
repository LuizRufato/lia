# Análise de Risco Operacional - Mercado Livre RPA (Fase 7D.1)

## 1. Decisão do OWNER
O Owner (Luiz) decidiu conscientemente autorizar a construção e operação de um Browser Bot (RPA via Playwright) para automatizar a extração de Links de Afiliado na interface web do Mercado Livre, dada a inexistência de API Pública para o Programa de Afiliados.

## 2. Riscos Assumidos
- **Suspensão da Conta:** O Mercado Livre pode detectar padrões automatizados ou considerar a prática violadora de seus Termos de Serviço de navegação, resultando na suspensão temporária ou banimento permanente da conta do afiliado.
- **Quebra da Integração (DOM Changes):** A Central de Afiliados é uma página web feita para humanos. Qualquer mudança no HTML, IDs de botões, ou estrutura de navegação fará o robô falhar imediatamente.
- **Expiração de Sessão:** A automação depende de uma sessão criptografada capturada após o login humano. Essa sessão expira e exigirá re-autenticação manual constante.

## 3. Limitações Críticas de Segurança Adotadas
Em resposta aos riscos, a LIA adota posturas extremamente conservadoras:
- **Nenhum Bypass de Segurança:** A LIA **NUNCA** tentará resolver CAPTCHAs, interceptar SMS/2FA, ou utilizar "Stealth Plugins" e "Proxy Rotation" para evadir a detecção. Se o ML exibir um desafio de segurança, o RPA entra em estado de `CHALLENGE_REQUIRED` e a operação cessa.
- **Fail-Closed Absoluto:** Se o link oficial de afiliado não puder ser gerado ou raspado com sucesso pela automação, a LIA **NÃO** publicará o produto. Nunca publicaremos uma URL "bruta" do Mercado Livre como fallback.
- **Sessões Criptografadas:** Os cookies/tokens de sessão do navegador (`storageState`) são interceptados apenas após a autenticação humana e guardados sob forte criptografia `AES-256-GCM`. Arquivos plaintext (`.json`) nunca são persistidos em disco.
- **Substituição Futura:** Essa arquitetura RPA Gateway é temporária e modular. O contrato `VerifiedAffiliateLink` permite que toda a camada Playwright seja descartada sem impactos na LIA no exato momento em que o Mercado Livre lançar uma API Oficial para Afiliados.
