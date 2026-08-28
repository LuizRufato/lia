import {
  buildAdminAlertMessage,
  buildDailySummaryMessage,
  buildPublicationFailureMessage,
} from "./messages";

describe("admin alert messages", () => {
  it("renders a daily summary with zero sales and zero activity", () => {
    const message = buildDailySummaryMessage({
      publications: 0,
      clicks: 0,
      sales: 0,
      commissionCents: 0,
    });

    expect(message).toContain("Hoje não houve atividade relevante.");
    expect(message).toContain("Vendas: 0");
    expect(message).toContain("Comissão: R$ 0,00");
  });

  it("renders a terminal publication failure without secrets", () => {
    const message = buildPublicationFailureMessage({
      product: "Oferta teste",
      channel: "Teste",
      error: "HTTP 500",
    });

    expect(message).toContain("Falha de publicação");
    expect(message).toContain("Oferta teste");
    expect(message).toContain("HTTP 500");
  });

  it("selects the Shopee disconnected message from the incident type", () => {
    expect(
      buildAdminAlertMessage("CRITICAL_ERROR", {
        incidentType: "SHOPEE_DISCONNECTED",
        state: "ERROR",
      }),
    ).toContain("Integração Shopee desconectada");
  });
});
