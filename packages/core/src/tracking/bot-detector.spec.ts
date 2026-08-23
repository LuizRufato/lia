import { classifyClick, intelligenceClassFor, isPreviewCrawler } from "./bot-detector";

describe("Bot Detection", () => {
  it("identifies human", () => {
    const { classification } = classifyClick(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    );
    expect(classification).toEqual("VALID");
  });

  it("preview bot não entra em Valid Clicks", () => {
    const res = classifyClick("TelegramBot (like TwitterBot)");
    expect(res.classification).toEqual("PREVIEW_BOT");
  });

  it("identifies suspected bot", () => {
    const res = classifyClick(
      "Googlebot/2.1 (+http://www.google.com/bot.html)",
    );
    expect(res.classification).toEqual("SUSPECTED_BOT");
  });

  it("identifies common preview crawlers without treating them as human clicks", () => {
    expect(isPreviewCrawler("WhatsApp/2.23 LinkPreview")).toBe(true);
    expect(classifyClick("WhatsApp/2.23 LinkPreview").classification).toEqual(
      "PREVIEW_BOT",
    );
    expect(intelligenceClassFor("PREVIEW_BOT")).toEqual("PREVIEW_CRAWLER");
  });

  it("maps a normal browser to the explicit HUMAN intelligence class", () => {
    expect(isPreviewCrawler("Mozilla/5.0 Chrome/126.0 Safari/537.36")).toBe(false);
    expect(intelligenceClassFor("VALID")).toEqual("HUMAN");
  });
});
