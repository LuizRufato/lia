import { classifyClick } from "./bot-detector";

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
});
