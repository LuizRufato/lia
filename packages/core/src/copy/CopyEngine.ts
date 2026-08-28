export type PublicationTemplateType =
  "ACHADINHO" | "OFERTA" | "PRECO_CAIU" | "MAIS_VENDIDO" | "GENERIC";

export type PublicationTemplateCtaMode = "AUTO" | "CUSTOM";

export interface CopyFactSheet {
  title: string;
  priceCents: number;
  originalPriceCents: number | null;
  currency: string;
  locale: string;
  discountPercentage: number | null;
  couponCode: string | null;
  freeShipping: boolean | null;
  finalLink: string;
}

export interface CopyPriceObservation {
  priceCents: number;
  observedAt: Date | string;
  originalPriceCents?: number | null;
}

export interface PublicationCopyContext {
  title: string;
  priceCents: number;
  currentOriginalPriceCents?: number | null;
  currentObservedAt?: Date | string | null;
  previousPrices?: CopyPriceObservation[];
  discountBps?: number | null;
  salesCount?: number | null;
  rating?: number | null;
  marketplace?: string | null;
  category?: string | null;
  finalLink: string;
  locale?: string;
  currency?: string;
}

export interface PublicationTemplateRecord {
  id?: string;
  name: string;
  type: PublicationTemplateType | string;
  enabled: boolean;
  isDefault: boolean;
  body: string;
  ctaMode: PublicationTemplateCtaMode | string;
  customCta?: string | null;
  priority?: number;
}

export interface RenderedPublicationCopy {
  text: string;
  templateType: PublicationTemplateType;
  templateName: string;
  previousPriceCents: number | null;
  discountPercentage: number | null;
  warnings: string[];
}

export const PUBLICATION_TEMPLATE_VARIABLES = [
  "titulo",
  "preco_atual",
  "preco_antigo",
  "desconto",
  "cta",
  "link",
  "marketplace",
  "sales_count",
  "rating",
] as const;

const DEFAULT_CTA = "Ver oferta";
const MAX_HISTORY_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_SALES_FOR_HIGHLIGHT = 100;

export const DEFAULT_PUBLICATION_TEMPLATES: PublicationTemplateRecord[] = [
  {
    name: "Achadinho seguro",
    type: "ACHADINHO",
    enabled: true,
    isDefault: true,
    priority: 10,
    ctaMode: "AUTO",
    customCta: null,
    body: "🔥 *{titulo}*\n\n{preco_antigo}\n💰 *Por: {preco_atual}*\n{desconto}\n\n👉 {cta}\n{link}",
  },
  {
    name: "Oferta",
    type: "OFERTA",
    enabled: true,
    isDefault: false,
    priority: 5,
    ctaMode: "AUTO",
    customCta: null,
    body: "🛍️ *{titulo}*\n\n💰 *{preco_atual}*\n{desconto}\n\n👉 {cta}\n{link}",
  },
  {
    name: "Preço caiu",
    type: "PRECO_CAIU",
    enabled: true,
    isDefault: false,
    priority: 20,
    ctaMode: "AUTO",
    customCta: null,
    body: "📉 *Preço observado em queda*\n\n*{titulo}*\n{preco_antigo}\nAgora: *{preco_atual}*\n{desconto}\n\n👉 {cta}\n{link}",
  },
  {
    name: "Mais vendido",
    type: "MAIS_VENDIDO",
    enabled: true,
    isDefault: false,
    priority: 15,
    ctaMode: "AUTO",
    customCta: null,
    body: "🔥 *{titulo}*\n\n📦 {sales_count} vendidos\n💰 *{preco_atual}*\n\n👉 {cta}\n{link}",
  },
  {
    name: "Genérico seguro",
    type: "GENERIC",
    enabled: true,
    isDefault: false,
    priority: 0,
    ctaMode: "AUTO",
    customCta: null,
    body: "*{titulo}*\n\n💰 *{preco_atual}*\n\n👉 {cta}\n{link}",
  },
];

function formatMoney(cents: number, locale = "pt-BR", currency = "BRL") {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    cents / 100,
  );
}

function asDate(value: Date | string | undefined | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeCta(
  context: PublicationCopyContext,
  template: PublicationTemplateRecord,
) {
  if (template.ctaMode === "CUSTOM") {
    const custom = (template.customCta || "")
      .replace(/[\r\n]+/g, " ")
      .replace(/[<>]/g, "")
      .trim()
      .slice(0, 120);
    if (custom) return custom;
  }
  const category = `${context.category || ""} ${context.title}`.toLowerCase();
  if (/casa|cozinha|organiza|decora/.test(category)) return "Conferir oferta";
  if (/eletr|celular|fone|comput|gamer/.test(category)) return "Ver detalhes";
  return DEFAULT_CTA;
}

function resolvePreviousPrice(context: PublicationCopyContext) {
  const current = context.priceCents;
  if (
    Number.isInteger(context.currentOriginalPriceCents) &&
    (context.currentOriginalPriceCents as number) > current
  ) {
    return {
      cents: context.currentOriginalPriceCents as number,
      source: "CURRENT" as const,
    };
  }

  const observedAt = asDate(context.currentObservedAt);
  const now = Date.now();
  const previous = (context.previousPrices || [])
    .filter((item) => {
      const date = asDate(item.observedAt);
      return (
        date &&
        Number.isInteger(item.priceCents) &&
        item.priceCents > current &&
        (!observedAt || date.getTime() < observedAt.getTime()) &&
        now - date.getTime() <= MAX_HISTORY_AGE_MS
      );
    })
    .sort(
      (a, b) =>
        new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime(),
    );
  return previous[0]
    ? { cents: previous[0].priceCents, source: "HISTORY" as const }
    : { cents: null, source: null };
}

function resolveDiscount(
  current: number,
  previous: number | null,
  reportedBps: number | null | undefined,
) {
  const validReportedBps =
    typeof reportedBps === "number" &&
    Number.isInteger(reportedBps) &&
    reportedBps > 0 &&
    reportedBps <= 10_000
      ? reportedBps
      : null;

  if (previous != null && previous > current) {
    const calculatedBps = Math.round(
      ((previous - current) / previous) * 10_000,
    );
    return {
      percentage: Math.max(1, Math.round(calculatedBps / 100)),
      mismatch:
        validReportedBps != null &&
        Math.abs(validReportedBps - calculatedBps) > 100,
    };
  }

  return {
    percentage:
      validReportedBps != null
        ? Math.max(1, Math.round(validReportedBps / 100))
        : null,
    mismatch: false,
  };
}

const OPTIONAL_VARIABLES = new Set([
  "preco_antigo",
  "desconto",
  "marketplace",
  "sales_count",
  "rating",
]);

function renderTemplateBody(body: string, values: Record<string, string>) {
  return body
    .split(/\r?\n/)
    .map((line) => {
      const keys = Array.from(line.matchAll(/\{([a-zA-Z0-9_]+)\}/g)).map(
        (match) => match[1],
      );
      const hasMissingOptional = keys.some(
        (key) => OPTIONAL_VARIABLES.has(key) && !values[key],
      );
      const hasPresentVariable = keys.some((key) => Boolean(values[key]));
      if (hasMissingOptional && !hasPresentVariable) return null;

      return line.replace(
        /\{([a-zA-Z0-9_]+)\}/g,
        (_match, key: string) => values[key] ?? "",
      );
    })
    .filter((line): line is string => line !== null && line.trim() !== "")
    .join("\n")
    .trim();
}

export class CopyEngine {
  static generate(facts: CopyFactSheet): string {
    const formatter = new Intl.NumberFormat(facts.locale, {
      style: "currency",
      currency: facts.currency,
    });
    const priceFormatted = formatter.format(facts.priceCents / 100);
    let copy = `🔥 ${facts.title}\n\n`;
    if (
      facts.originalPriceCents !== null &&
      facts.originalPriceCents > facts.priceCents
    ) {
      const originalFormatted = formatter.format(
        facts.originalPriceCents / 100,
      );
      copy += `De: ~${originalFormatted}~\n`;
    }
    copy += `Por: **${priceFormatted}**\n\n`;
    if (facts.discountPercentage !== null)
      copy += `🎯 Desconto: ${facts.discountPercentage}%\n`;
    if (facts.couponCode !== null) copy += `🎟️ Cupom: ${facts.couponCode}\n`;
    if (facts.freeShipping === true) copy += `🚚 Frete Grátis!\n`;
    return `${copy}\n🛒 Compre aqui: ${facts.finalLink}`;
  }

  static render(
    template: PublicationTemplateRecord,
    context: PublicationCopyContext,
  ): RenderedPublicationCopy {
    const previous = resolvePreviousPrice(context);
    const discount = resolveDiscount(
      context.priceCents,
      previous.cents,
      context.discountBps,
    );
    const values: Record<string, string> = {
      titulo: context.title.trim() || "Oferta",
      preco_atual: formatMoney(
        context.priceCents,
        context.locale,
        context.currency,
      ),
      preco_antigo:
        previous.cents != null
          ? formatMoney(previous.cents, context.locale, context.currency)
          : "",
      desconto: discount.percentage ? `${discount.percentage}%` : "",
      cta: safeCta(context, template),
      link: context.finalLink,
      marketplace: context.marketplace || "",
      sales_count:
        Number.isInteger(context.salesCount) &&
        (context.salesCount as number) >= 0
          ? String(context.salesCount)
          : "",
      rating:
        typeof context.rating === "number" &&
        Number.isFinite(context.rating) &&
        context.rating >= 0 &&
        context.rating <= 5
          ? context.rating.toFixed(1)
          : "",
    };
    const text = renderTemplateBody(template.body, values);
    return {
      text: text || CopyEngine.fallback(context),
      templateType: (template.type as PublicationTemplateType) || "GENERIC",
      templateName: template.name,
      previousPriceCents: previous.cents,
      discountPercentage: discount.percentage,
      warnings: discount.mismatch ? ["DISCOUNT_SOURCE_DIVERGENCE"] : [],
    };
  }

  static fallback(context: PublicationCopyContext) {
    return `*${context.title.trim() || "Oferta"}*\n\n💰 *${formatMoney(context.priceCents, context.locale, context.currency)}*\n\n👉 ${DEFAULT_CTA}\n${context.finalLink}`;
  }

  static selectTemplate(
    templates: PublicationTemplateRecord[],
    context: PublicationCopyContext,
  ): PublicationTemplateRecord {
    const enabled = templates
      .filter((template) => template.enabled && template.body.trim())
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
    const previous = resolvePreviousPrice(context);
    const desired: PublicationTemplateType =
      previous.source === "HISTORY"
        ? "PRECO_CAIU"
        : Number.isInteger(context.salesCount) &&
            (context.salesCount as number) >= MIN_SALES_FOR_HIGHLIGHT
          ? "MAIS_VENDIDO"
          : "ACHADINHO";
    const typed = enabled.find((template) => template.type === desired);
    const generic = enabled.find((template) => template.type === "GENERIC");
    const defaultTemplate = enabled.find((template) => template.isDefault);
    return (
      typed || defaultTemplate || generic || DEFAULT_PUBLICATION_TEMPLATES[4]
    );
  }

  static renderPublication(
    templates: PublicationTemplateRecord[],
    context: PublicationCopyContext,
  ) {
    const template = this.selectTemplate(templates, context);
    try {
      return this.render(template, context);
    } catch {
      return {
        text: this.fallback(context),
        templateType: "GENERIC" as const,
        templateName: "Fallback seguro",
        previousPriceCents: null,
        discountPercentage: null,
        warnings: [],
      };
    }
  }
}
