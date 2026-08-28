const IDENTITY_FIELDS = [
  "brand",
  "model",
  "sku",
  "capacity",
  "size",
  "voltage",
  "variant",
] as const;

const NOISE_PATTERNS = [
  /\b(?:frete\s+gr[aá]tis|frete\s+gratis)\b/giu,
  /\b(?:oferta|promo[cç][aã]o|cupom|desconto|imperd[ií]vel)\b/giu,
  /\br\$\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?\b/giu,
  /\b(?:r\$\s*)?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?\s*(?:off|de\s+desconto)\b/giu,
  /\b\d{1,3}\s*%\s*(?:off|de\s+desconto)\b/giu,
];

function normalizeIdentityText(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";

  let text = String(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/https?:\/\/\S+/giu, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .toLowerCase();

  for (const pattern of NOISE_PATTERNS) {
    text = text.replace(pattern, " ");
  }

  text = text.replace(/[^\p{L}\p{N}]+/gu, " ");

  // Keep numeric variants stable whether written as "256 GB" or "256GB".
  text = text.replace(
    /\b(\d+(?:[.,]\d+)?)\s+(gb|tb|mb|ml|kg|mg|cm|mm|hz|w|v)\b/gu,
    "$1$2",
  );

  return text.replace(/\s+/g, " ").trim();
}

function fallbackIdentity(
  provider: string,
  fallbackExternalId: string | null | undefined,
): string {
  const normalizedProvider = normalizeIdentityText(provider) || "unknown";
  const fallback = normalizeIdentityText(fallbackExternalId) || "unknown";
  return `${normalizedProvider}:external:${fallback}`;
}

/**
 * Build a conservative identity for anti-repetition only.
 *
 * This is exact after normalization: it removes common listing noise, but
 * never uses fuzzy similarity or drops numeric variant markers. Tracking and
 * marketplace identifiers remain untouched elsewhere.
 */
export function getCanonicalProductFingerprint(
  provider: string,
  canonicalPayload: unknown,
  fallbackExternalId: string | null | undefined,
): string {
  const payload = (canonicalPayload || {}) as {
    product?: Record<string, unknown>;
  };
  const product = payload.product || {};
  const title = normalizeIdentityText(product.title);
  const titleTokens = title.split(" ").filter(Boolean);

  if (!title || titleTokens.length < 2) {
    return fallbackIdentity(provider, fallbackExternalId);
  }

  const explicitIdentity = IDENTITY_FIELDS.map((field) =>
    normalizeIdentityText(product[field]),
  ).filter(Boolean);

  return `${normalizeIdentityText(provider) || "unknown"}:canonical:${[
    ...explicitIdentity,
    title,
  ].join("|")}`;
}
