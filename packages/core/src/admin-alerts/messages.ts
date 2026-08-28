export type AdminAlertMessagePayload = {
  message?: string;
  incidentType?: string;
  product?: string | null;
  channel?: string | null;
  error?: string | null;
  state?: string | null;
  integration?: string | null;
  period?: string | null;
  publications?: number;
  clicks?: number;
  sales?: number;
  commissionCents?: number | null;
  topProduct?: string | null;
  failures?: number;
  purchaseTime?: string;
  commissionStatus?: string;
  totalCommissionCents?: number | null;
  orders?: Array<{
    orderId?: string;
    status?: string;
    items?: Array<{
      itemName?: string | null;
      qty?: number | null;
      itemPriceCents?: number | null;
      actualAmountCents?: number | null;
    }>;
  }>;
};

export type AdminAlertType =
  | "NEW_SHOPEE_SALE"
  | "COMMISSION_CONFIRMED"
  | "SALE_CANCELLED"
  | "HIGH_VALUE_SALE"
  | "CRITICAL_ERROR"
  | "DAILY_SUMMARY";

export function buildNewShopeeSaleMessage(
  payload: AdminAlertMessagePayload,
): string {
  const items = (payload.orders || []).flatMap((order) => order.items || []);
  const lines = ["🟢 NOVA VENDA SHOPEE", ""];

  if (items.length === 1) {
    const item = items[0];
    lines.push(`Produto: ${item.itemName || "Produto não informado"}`);
    lines.push(`Quantidade: ${item.qty ?? "não informada"}`);
    appendAmount(lines, "Valor", item.actualAmountCents);
  } else if (items.length > 1) {
    lines.push(`Pedido com ${items.length} itens:`, "");
    for (const item of items) {
      const amount = formatCents(item.actualAmountCents);
      lines.push(
        `• ${item.itemName || "Produto não informado"} — ${item.qty ?? "?"}x${amount ? ` — ${amount}` : ""}`,
      );
    }
    const amounts = items.map((item) => item.actualAmountCents);
    if (amounts.every((amount) => typeof amount === "number")) {
      appendAmount(
        lines,
        "Valor do pedido",
        amounts.reduce((total, amount) => total + (amount || 0), 0),
      );
    }
  }

  appendAmount(lines, "Comissão estimada", payload.totalCommissionCents);
  if (payload.commissionStatus)
    lines.push(`Status: ${payload.commissionStatus}`);
  if (payload.purchaseTime) {
    const date = new Date(payload.purchaseTime);
    if (!Number.isNaN(date.getTime())) {
      lines.push(
        `Horário: ${new Intl.DateTimeFormat("pt-BR", {
          timeZone: "America/Campo_Grande",
          dateStyle: "short",
          timeStyle: "short",
        }).format(date)}`,
      );
    }
  }
  lines.push("LIA");
  return lines.join("\n");
}

export function buildSimulatedNewShopeeSaleMessage(
  purchaseTime = new Date().toISOString(),
): string {
  return `🧪 SIMULAÇÃO\n\n${buildNewShopeeSaleMessage({
    purchaseTime,
    commissionStatus: "PENDING",
    totalCommissionCents: 879,
    orders: [
      {
        orderId: "simulation-order",
        status: "PENDING",
        items: [
          {
            itemName: "Fone Bluetooth Pro",
            qty: 1,
            actualAmountCents: 7990,
          },
        ],
      },
    ],
  })}`;
}

export function buildDailySummaryMessage(
  payload: AdminAlertMessagePayload,
): string {
  const publications = payload.publications ?? 0;
  const clicks = payload.clicks ?? 0;
  const sales = payload.sales ?? 0;
  const commission = formatCents(payload.commissionCents) || "R$ 0,00";
  const lines = ["📊 Resumo diário da LIA", ""];

  if (!publications && !clicks && !sales && !(payload.failures ?? 0)) {
    lines.push("Hoje não houve atividade relevante.", "");
  }

  lines.push(
    `Publicações: ${publications}`,
    `Cliques: ${clicks}`,
    `Vendas: ${sales}`,
    `Comissão: ${commission}`,
  );
  if (payload.topProduct) lines.push(`Produto destaque: ${payload.topProduct}`);
  if (payload.failures) lines.push(`Falhas relevantes: ${payload.failures}`);
  lines.push("LIA");
  return lines.join("\n");
}

export function buildPublicationFailureMessage(
  payload: AdminAlertMessagePayload,
): string {
  return [
    "⚠️ Falha de publicação",
    "",
    payload.product ? `Produto: ${payload.product}` : null,
    payload.channel ? `Canal: ${payload.channel}` : null,
    payload.error ? `Erro: ${payload.error}` : null,
    "LIA",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function buildEvolutionOfflineMessage(
  payload: AdminAlertMessagePayload,
): string {
  return [
    "🔴 WhatsApp/Evolution desconectado",
    "",
    payload.integration ? `Integração: ${payload.integration}` : null,
    payload.state ? `Estado: ${payload.state}` : null,
    payload.error ? `Erro: ${payload.error}` : null,
    "LIA",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function buildShopeeDisconnectedMessage(
  payload: AdminAlertMessagePayload,
): string {
  return [
    "🔴 Integração Shopee desconectada",
    "",
    payload.state ? `Estado: ${payload.state}` : null,
    payload.error ? `Erro: ${payload.error}` : null,
    "LIA",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function buildAdminAlertMessage(
  type: AdminAlertType,
  payload: AdminAlertMessagePayload,
): string {
  switch (type) {
    case "DAILY_SUMMARY":
      return buildDailySummaryMessage(payload);
    case "CRITICAL_ERROR":
      if (payload.message) return payload.message;
      if (payload.incidentType === "SHOPEE_DISCONNECTED")
        return buildShopeeDisconnectedMessage(payload);
      if (payload.integration && payload.state)
        return buildEvolutionOfflineMessage(payload);
      return buildPublicationFailureMessage(payload);
    case "NEW_SHOPEE_SALE":
      return buildNewShopeeSaleMessage(payload);
    default:
      return payload.message || "⚠️ Alerta administrativo da LIA";
  }
}

function appendAmount(lines: string[], label: string, cents?: number | null) {
  const amount = formatCents(cents);
  if (amount) lines.push(`${label}: ${amount}`);
}

function formatCents(cents?: number | null): string | null {
  return typeof cents === "number" && Number.isFinite(cents)
    ? `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`
    : null;
}
