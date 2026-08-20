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
  if (ua.includes("telegrambot")) {
    return {
      classification: "PREVIEW_BOT",
      reason: "TelegramBot preview crawler",
    };
  }
  if (ua.includes("whatsapp")) {
    return {
      classification: "PREVIEW_BOT",
      reason: "WhatsApp preview crawler",
    };
  }
  if (ua.includes("twitterbot")) {
    return { classification: "PREVIEW_BOT", reason: "Twitter preview crawler" };
  }
  if (ua.includes("facebookexternalhit")) {
    return {
      classification: "PREVIEW_BOT",
      reason: "Facebook preview crawler",
    };
  }

  // Common Crawlers and Suspected Bots
  if (
    ua.includes("bot") ||
    ua.includes("crawler") ||
    ua.includes("spider") ||
    ua.includes("googlebot") ||
    ua.includes("bingbot") ||
    ua.includes("slackbot") ||
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
