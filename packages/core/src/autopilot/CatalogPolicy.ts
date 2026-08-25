export type CatalogPolicyMode = "OPEN" | "SELECTED_CATEGORIES";

export interface CatalogPolicyConfig {
  mode: CatalogPolicyMode;
  allowedCategories: string[];
  blockedCategories: string[];
  blockedKeywords: string[];
  minSalesCount: number | null;
  minRating: number | null;
}

export interface CatalogOfferSignals {
  title: string;
  category: string | null;
  salesCount: number | null;
  rating: number | null;
}

export type CatalogPolicyDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "REJECTED_CATEGORY"
        | "REJECTED_BLOCKED_CATEGORY"
        | "REJECTED_BLOCKED_KEYWORD"
        | "REJECTED_MIN_SALES"
        | "REJECTED_MIN_RATING";
      details: string;
    };

export function normalizeCatalogText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCatalogList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map(normalizeCatalogText)
        .filter(Boolean),
    ),
  ];
}

export function evaluateCatalogPolicy(
  policy: CatalogPolicyConfig,
  offer: CatalogOfferSignals,
): CatalogPolicyDecision {
  const category = offer.category ? normalizeCatalogText(offer.category) : null;
  const allowed = normalizeCatalogList(policy.allowedCategories);
  const blocked = normalizeCatalogList(policy.blockedCategories);
  const keywords = normalizeCatalogList(policy.blockedKeywords);

  if (category && blocked.includes(category)) {
    return {
      allowed: false,
      reason: "REJECTED_BLOCKED_CATEGORY",
      details: `Categoria bloqueada: ${offer.category}`,
    };
  }

  if (
    policy.mode === "SELECTED_CATEGORIES" &&
    (!category || !allowed.includes(category))
  ) {
    return {
      allowed: false,
      reason: "REJECTED_CATEGORY",
      details: category
        ? `Categoria não permitida: ${offer.category}`
        : "Categoria não identificada; selecione uma categoria permitida.",
    };
  }

  const searchable = normalizeCatalogText(
    `${offer.title} ${offer.category || ""}`,
  );
  const blockedKeyword = keywords.find((keyword) =>
    searchable.includes(keyword),
  );
  if (blockedKeyword) {
    return {
      allowed: false,
      reason: "REJECTED_BLOCKED_KEYWORD",
      details: `Palavra bloqueada: ${blockedKeyword}`,
    };
  }

  if (
    policy.minSalesCount != null &&
    offer.salesCount != null &&
    offer.salesCount < policy.minSalesCount
  ) {
    return {
      allowed: false,
      reason: "REJECTED_MIN_SALES",
      details: `Vendas abaixo do mínimo configurado: ${offer.salesCount} < ${policy.minSalesCount}.`,
    };
  }

  if (
    policy.minRating != null &&
    offer.rating != null &&
    offer.rating < policy.minRating
  ) {
    return {
      allowed: false,
      reason: "REJECTED_MIN_RATING",
      details: `Avaliação abaixo do mínimo: ${offer.rating.toFixed(1)} < ${policy.minRating.toFixed(1)}.`,
    };
  }

  return { allowed: true };
}
