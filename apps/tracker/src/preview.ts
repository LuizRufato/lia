export interface SmartPreviewOffer {
  title: string;
  description?: string | null;
  destinationUrl: string;
  priceCents?: number | null;
  originalPriceCents?: number | null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

export function buildSmartPreviewHtml(slug: string, offer: SmartPreviewOffer): string {
  const title = offer.title.trim() || "Oferta LIA";
  const hasOriginalPrice =
    Number.isInteger(offer.originalPriceCents) &&
    Number.isInteger(offer.priceCents) &&
    (offer.originalPriceCents as number) > (offer.priceCents as number);
  const pricing = hasOriginalPrice
    ? `De ${formatPrice(offer.originalPriceCents as number)} por ${formatPrice(offer.priceCents as number)}`
    : offer.priceCents != null
      ? `Por ${formatPrice(offer.priceCents)}`
      : null;
  const description = [offer.description?.trim(), pricing]
    .filter(Boolean)
    .join(" • ") || "Confira esta oferta selecionada pela LIA.";
  const url = `https://go.botlia.com.br/${encodeURIComponent(slug)}`;
  const meta = [
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta name="twitter:card" content="summary" />`,
  ].join("\n    ");

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    ${meta}
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <p>${escapeHtml(title)}</p>
  </body>
</html>`;
}
