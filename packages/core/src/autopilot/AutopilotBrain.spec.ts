import {
  AutopilotBrain,
  AutopilotMode,
  MonetizationStatus,
  IntegrationStatus,
  ScoredOffer,
  AutopilotConfigSnapshot,
  MonetizationContext,
  AutopilotRuntimeContext,
  Clock,
  AutopilotDecisionReason,
} from "./AutopilotBrain";

describe("AutopilotBrain", () => {
  const dummyClock: Clock = {
    now: () => new Date("2026-08-07T12:00:00Z"),
    getMinutesSinceMidnight: () => 720, // 12:00
  };

  const defaultOffer: ScoredOffer = {
    id: "offer-1",
    marketplaceId: "shopee-1",
    marketplaceType: "SHOPEE",
    score: 80,
  };

  const defaultConfig: AutopilotConfigSnapshot = {
    mode: AutopilotMode.AUTO,
    allowedStartMinute: 540,
    allowedEndMinute: 1200,
    timezone: "America/Campo_Grande",
    minScore: 70,
    minimumCommissionCents: 500,
    maxDailyPosts: 30,
    intervalMinutes: 30,
    enabledChannelIds: ["channel-1"],
    enabledMarketplaceIds: ["shopee-1"],
  };

  const defaultMonetization: MonetizationContext = {
    status: MonetizationStatus.VERIFIED,
    destinationUrl: "https://shopee.com/affiliate-link",
    estimatedCommissionCents: 800,
  };

  const defaultContext: AutopilotRuntimeContext = {
    postsToday: 5,
    lastPublicationAt: new Date("2026-08-07T11:00:00Z"), // 60 mins ago
    channelStatus: { "channel-1": { enabled: true, visibility: "PRIVATE" } },
    integrationHealth: { SHOPEE: IntegrationStatus.CONNECTED },
  };

  it("should approve when all conditions are met", () => {
    const decision = AutopilotBrain.evaluate(
      defaultOffer,
      defaultConfig,
      defaultMonetization,
      defaultContext,
      dummyClock,
    );
    expect(decision.approved).toBe(true);
    expect(decision.reason).toBe(AutopilotDecisionReason.APPROVED);
    expect(decision.channelId).toBe("channel-1");
  });

  it("OFF nunca publica", () => {
    const config = { ...defaultConfig, mode: AutopilotMode.OFF };
    const decision = AutopilotBrain.evaluate(
      defaultOffer,
      config,
      defaultMonetization,
      defaultContext,
      dummyClock,
    );
    expect(decision.approved).toBe(false);
    expect(decision.reason).toBe(AutopilotDecisionReason.REJECTED_KILL_SWITCH);
  });

  it("MANUAL nunca publica sozinho", () => {
    const config = { ...defaultConfig, mode: AutopilotMode.MANUAL };
    const decision = AutopilotBrain.evaluate(
      defaultOffer,
      config,
      defaultMonetization,
      defaultContext,
      dummyClock,
    );
    expect(decision.approved).toBe(false);
    expect(decision.reason).toBe(AutopilotDecisionReason.REJECTED_KILL_SWITCH);
  });

  it("DRY_RUN nunca chega ao Publisher externo", () => {
    const config = { ...defaultConfig, mode: AutopilotMode.DRY_RUN };
    const decision = AutopilotBrain.evaluate(
      defaultOffer,
      config,
      defaultMonetization,
      defaultContext,
      dummyClock,
    );
    expect(decision.approved).toBe(true);
    expect(decision.reason).toBe(AutopilotDecisionReason.DRY_RUN_APPROVED);
    expect(decision.details).toBe("Simulação aprovada.");
  });

  it("AUTO somente VERIFIED", () => {
    const monetization = {
      ...defaultMonetization,
      status: MonetizationStatus.UNVERIFIED,
    };
    const decision = AutopilotBrain.evaluate(
      defaultOffer,
      defaultConfig,
      monetization,
      defaultContext,
      dummyClock,
    );
    expect(decision.approved).toBe(false);
    expect(decision.reason).toBe(AutopilotDecisionReason.REJECTED_MONETIZATION);
  });

  it("returns every selected channel that is compatible and enabled", () => {
    const decision = AutopilotBrain.evaluate(
      defaultOffer,
      { ...defaultConfig, enabledChannelIds: ["channel-1", "channel-2"] },
      defaultMonetization,
      {
        ...defaultContext,
        channelStatus: {
          "channel-1": { enabled: true, visibility: "PRIVATE" },
          "channel-2": { enabled: true, visibility: "PRIVATE" },
        },
      },
      dummyClock,
    );
    expect(decision).toMatchObject({
      approved: true,
      channelId: "channel-1",
      channelIds: ["channel-1", "channel-2"],
    });
  });

  it("rejeita comissão abaixo do mínimo", () => {
    const decision = AutopilotBrain.evaluate(
      defaultOffer,
      defaultConfig,
      { ...defaultMonetization, estimatedCommissionCents: 499 },
      defaultContext,
      dummyClock,
    );
    expect(decision.approved).toBe(false);
    expect(decision.reason).toBe(
      AutopilotDecisionReason.REJECTED_MINIMUM_COMMISSION,
    );
  });

  it("rejeita comissão não informada", () => {
    const decision = AutopilotBrain.evaluate(
      defaultOffer,
      defaultConfig,
      { ...defaultMonetization, estimatedCommissionCents: null },
      defaultContext,
      dummyClock,
    );
    expect(decision.approved).toBe(false);
    expect(decision.reason).toBe(
      AutopilotDecisionReason.REJECTED_MINIMUM_COMMISSION,
    );
  });

  it("intervalo mínimo", () => {
    const context = {
      ...defaultContext,
      lastPublicationAt: new Date("2026-08-07T11:45:00Z"),
    }; // 15 mins ago, interval is 30
    const decision = AutopilotBrain.evaluate(
      defaultOffer,
      defaultConfig,
      defaultMonetization,
      context,
      dummyClock,
    );
    expect(decision.approved).toBe(false);
    expect(decision.reason).toBe(AutopilotDecisionReason.REJECTED_INTERVAL);
  });

  it("limite diário", () => {
    const context = { ...defaultContext, postsToday: 30 }; // max is 30
    const decision = AutopilotBrain.evaluate(
      defaultOffer,
      defaultConfig,
      defaultMonetization,
      context,
      dummyClock,
    );
    expect(decision.approved).toBe(false);
    expect(decision.reason).toBe(AutopilotDecisionReason.REJECTED_DAILY_LIMIT);
  });

  it("janela atravessando meia-noite", () => {
    const config = {
      ...defaultConfig,
      allowedStartMinute: 1320,
      allowedEndMinute: 120,
    }; // 22:00 to 02:00

    // 23:00 (1380 mins) -> should approve
    const clock23: Clock = {
      now: dummyClock.now,
      getMinutesSinceMidnight: () => 1380,
    };
    let decision = AutopilotBrain.evaluate(
      defaultOffer,
      config,
      defaultMonetization,
      defaultContext,
      clock23,
    );
    expect(decision.approved).toBe(true);

    // 01:00 (60 mins) -> should approve
    const clock01: Clock = {
      now: dummyClock.now,
      getMinutesSinceMidnight: () => 60,
    };
    decision = AutopilotBrain.evaluate(
      defaultOffer,
      config,
      defaultMonetization,
      defaultContext,
      clock01,
    );
    expect(decision.approved).toBe(true);

    // 03:00 (180 mins) -> should reject
    const clock03: Clock = {
      now: dummyClock.now,
      getMinutesSinceMidnight: () => 180,
    };
    decision = AutopilotBrain.evaluate(
      defaultOffer,
      config,
      defaultMonetization,
      defaultContext,
      clock03,
    );
    expect(decision.approved).toBe(false);
    expect(decision.reason).toBe(
      AutopilotDecisionReason.REJECTED_OUTSIDE_SCHEDULE,
    );
  });

  it("null facts na Copy - via DRY_RUN verification for unverified links", () => {
    const monetization = {
      ...defaultMonetization,
      status: MonetizationStatus.UNVERIFIED,
    };
    const config = { ...defaultConfig, mode: AutopilotMode.DRY_RUN };
    const decision = AutopilotBrain.evaluate(
      defaultOffer,
      config,
      monetization,
      defaultContext,
      dummyClock,
    );
    expect(decision.approved).toBe(true);
    expect(decision.reason).toBe(AutopilotDecisionReason.DRY_RUN_APPROVED);
    expect(decision.details).toBe(
      "Não seria publicada: link afiliado não verificado.",
    );
  });
});
