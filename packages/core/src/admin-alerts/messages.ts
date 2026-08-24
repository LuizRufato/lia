export type AdminAlertMessagePayload = {
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

function appendAmount(lines: string[], label: string, cents?: number | null) {
  const amount = formatCents(cents);
  if (amount) lines.push(`${label}: ${amount}`);
}

function formatCents(cents?: number | null): string | null {
  return typeof cents === "number" && Number.isFinite(cents)
    ? `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`
    : null;
}
