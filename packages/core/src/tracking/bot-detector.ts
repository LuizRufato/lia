import { ClickClassification } from "@prisma/client";

export function classifyClick(userAgent: string | undefined): {
  classification: ClickClassification;
  reason?: string;
} {
  const ua = (userAgent || "").toLowerCase();

  if (!ua || ua.length < 10) {
    return {
      classification: "SUSPECTED_BOT",
      reason: "Empty or very short User-Agent",
    };
  }

  // Preview Bots (we want to specifically distinguish these from malicious/crawlers)
  if (
    ua.includes("telegrambot") ||
    ua.includes("whatsapp") ||
    ua.includes("twitterbot") ||
    ua.includes("facebookexternalhit") ||
    ua.includes("linkedinbot") ||
    ua.includes("discordbot") ||
    ua.includes("skypeuripreview") ||
    ua.includes("pinterestbot") ||
    ua.includes("slackbot") ||
    ua.includes("embedly")
  ) {
    const previewName = ua.includes("telegrambot")
      ? "TelegramBot"
      : ua.includes("whatsapp")
        ? "WhatsApp"
        : ua.includes("twitterbot")
          ? "Twitter"
          : ua.includes("facebookexternalhit")
            ? "Facebook"
            : "Link preview";
    return {
      classification: "PREVIEW_BOT",
      reason: `${previewName} preview crawler`,
    };
  }

  // Common Crawlers and Suspected Bots
  if (
    ua.includes("bot") ||
    ua.includes("crawler") ||
    ua.includes("spider") ||
    ua.includes("googlebot") ||
    ua.includes("bingbot") ||
    ua.includes("yandex") ||
    ua.includes("baiduspider")
  ) {
    return {
      classification: "SUSPECTED_BOT",
      reason: "Known crawler User-Agent",
    };
  }

  if (ua.includes("headlesschrome") || ua.includes("puppeteer")) {
    return {
      classification: "SUSPECTED_BOT",
      reason: "Headless browser detected",
    };
  }

  return { classification: "VALID" };
}

export type ClickIntelligenceClass =
  | "HUMAN"
  | "BOT"
  | "PREVIEW_CRAWLER"
  | "SUSPECTED_AUTOMATION";

export function intelligenceClassFor(
  classification: ClickClassification,
): ClickIntelligenceClass {
  if (classification === "VALID") return "HUMAN";
  if (classification === "PREVIEW_BOT") return "PREVIEW_CRAWLER";
  return "SUSPECTED_AUTOMATION";
}

/**
 * Preview crawlers receive Open Graph HTML and never create ClickEvents.
 * The detector intentionally uses a family of signals rather than one UA.
 */
export function isPreviewCrawler(userAgent: string | undefined): boolean {
  return classifyClick(userAgent).classification !== "VALID";
}
