import {
  MarketplacePublicationPolicy,
  ChannelVisibility,
} from "../policies/MarketplacePublicationPolicy";

export enum AutopilotMode {
  OFF = "OFF",
  MANUAL = "MANUAL",
  DRY_RUN = "DRY_RUN",
  AUTO = "AUTO",
}

export enum MonetizationStatus {
  UNAVAILABLE = "UNAVAILABLE",
  UNVERIFIED = "UNVERIFIED",
  VERIFIED = "VERIFIED",
}

export enum IntegrationStatus {
  NOT_CONNECTED = "NOT_CONNECTED",
  CONNECTING = "CONNECTING",
  CONNECTED = "CONNECTED",
  NEEDS_REAUTH = "NEEDS_REAUTH",
  ERROR = "ERROR",
}

export interface AutopilotConfigSnapshot {
  mode: AutopilotMode;
  allowedStartMinute: number;
  allowedEndMinute: number;
  timezone: string;
  minScore: number;
  minimumCommissionCents: number;
  maxDailyPosts: number;
  intervalMinutes: number;
  enabledChannelIds: string[];
  enabledMarketplaceIds: string[];
}

export interface MonetizationContext {
  status: MonetizationStatus;
  destinationUrl?: string | null;
  estimatedCommissionCents?: number | null;
}

export interface ScoredOffer {
  id: string;
  marketplaceId: string;
  marketplaceType: string;
  score: number;
}

export interface AutopilotRuntimeContext {
  postsToday: number;
  lastPublicationAt?: Date | null;
  categoryCount?: Record<string, number>;
  channelStatus: Record<
    string,
    { enabled: boolean; visibility: ChannelVisibility }
  >;
  integrationHealth: Record<string, IntegrationStatus>;
}

export interface Clock {
  now(): Date;
  getMinutesSinceMidnight(timezone: string): number;
}

export enum AutopilotDecisionReason {
  APPROVED = "APPROVED",
  REJECTED_LOW_SCORE = "REJECTED_LOW_SCORE",
  REJECTED_DAILY_LIMIT = "REJECTED_DAILY_LIMIT",
  REJECTED_INTERVAL = "REJECTED_INTERVAL",
  REJECTED_OUTSIDE_SCHEDULE = "REJECTED_OUTSIDE_SCHEDULE",
  REJECTED_FATIGUE = "REJECTED_FATIGUE",
  REJECTED_DUPLICATE = "REJECTED_DUPLICATE",
  REJECTED_MONETIZATION = "REJECTED_MONETIZATION",
  REJECTED_MINIMUM_COMMISSION = "REJECTED_MINIMUM_COMMISSION",
  REJECTED_CHANNEL_POLICY = "REJECTED_CHANNEL_POLICY",
  REJECTED_KILL_SWITCH = "REJECTED_KILL_SWITCH",
  REJECTED_INTEGRATION_UNHEALTHY = "REJECTED_INTEGRATION_UNHEALTHY",
  REJECTED_CATEGORY = "REJECTED_CATEGORY",
  REJECTED_BLOCKED_CATEGORY = "REJECTED_BLOCKED_CATEGORY",
  REJECTED_BLOCKED_KEYWORD = "REJECTED_BLOCKED_KEYWORD",
  REJECTED_MIN_SALES = "REJECTED_MIN_SALES",
  REJECTED_MIN_RATING = "REJECTED_MIN_RATING",
  REJECTED_PRODUCT_COOLDOWN = "REJECTED_PRODUCT_COOLDOWN",
  REJECTED_CATEGORY_DAILY_LIMIT = "REJECTED_CATEGORY_DAILY_LIMIT",
  DRY_RUN_APPROVED = "DRY_RUN_APPROVED",
}

export interface AutopilotDecision {
  reason: AutopilotDecisionReason;
  approved: boolean;
  channelId?: string;
  channelIds?: string[];
  details?: string;
}

export class AutopilotBrain {
  static evaluate(
    offer: ScoredOffer,
    config: AutopilotConfigSnapshot,
    monetization: MonetizationContext,
    context: AutopilotRuntimeContext,
    clock: Clock,
  ): AutopilotDecision {
    if (
      config.mode === AutopilotMode.OFF ||
      config.mode === AutopilotMode.MANUAL
    ) {
      return {
        reason: AutopilotDecisionReason.REJECTED_KILL_SWITCH,
        approved: false,
        details: "Autopilot is OFF or MANUAL",
      };
    }

    if (!config.enabledMarketplaceIds.includes(offer.marketplaceId)) {
      return {
        reason: AutopilotDecisionReason.REJECTED_CHANNEL_POLICY,
        approved: false,
        details: "Marketplace not enabled for Autopilot",
      };
    }

    if (offer.score < config.minScore) {
      return {
        reason: AutopilotDecisionReason.REJECTED_LOW_SCORE,
        approved: false,
      };
    }

    // Hard guard: an unknown commission is not safe enough for automatic posting.
    if (monetization.estimatedCommissionCents == null) {
      return {
        reason: AutopilotDecisionReason.REJECTED_MINIMUM_COMMISSION,
        approved: false,
        details: "Comissão não informada para a oferta.",
      };
    }
    if (monetization.estimatedCommissionCents < config.minimumCommissionCents) {
      return {
        reason: AutopilotDecisionReason.REJECTED_MINIMUM_COMMISSION,
        approved: false,
        details: `Comissão R$ ${(monetization.estimatedCommissionCents / 100).toFixed(2)} é menor que o mínimo R$ ${(config.minimumCommissionCents / 100).toFixed(2)}`,
      };
    }

    if (context.postsToday >= config.maxDailyPosts) {
      return {
        reason: AutopilotDecisionReason.REJECTED_DAILY_LIMIT,
        approved: false,
      };
    }

    if (context.lastPublicationAt) {
      const nowMs = clock.now().getTime();
      const lastPubMs = context.lastPublicationAt.getTime();
      const diffMinutes = (nowMs - lastPubMs) / 1000 / 60;
      if (diffMinutes < config.intervalMinutes) {
        return {
          reason: AutopilotDecisionReason.REJECTED_INTERVAL,
          approved: false,
        };
      }
    }

    const currentMinute = clock.getMinutesSinceMidnight(config.timezone);
    let withinSchedule = false;

    if (config.allowedStartMinute <= config.allowedEndMinute) {
      withinSchedule =
        currentMinute >= config.allowedStartMinute &&
        currentMinute <= config.allowedEndMinute;
    } else {
      // Handles windows crossing midnight (e.g., 22:00 to 02:00)
      withinSchedule =
        currentMinute >= config.allowedStartMinute ||
        currentMinute <= config.allowedEndMinute;
    }

    if (!withinSchedule) {
      return {
        reason: AutopilotDecisionReason.REJECTED_OUTSIDE_SCHEDULE,
        approved: false,
      };
    }

    if (
      context.integrationHealth[offer.marketplaceType] !==
      IntegrationStatus.CONNECTED
    ) {
      return {
        reason: AutopilotDecisionReason.REJECTED_INTEGRATION_UNHEALTHY,
        approved: false,
        details: "Integration is not connected",
      };
    }

    if (config.mode === AutopilotMode.AUTO) {
      if (
        monetization.status !== MonetizationStatus.VERIFIED ||
        !monetization.destinationUrl
      ) {
        return {
          reason: AutopilotDecisionReason.REJECTED_MONETIZATION,
          approved: false,
          details: "Monetization link not verified",
        };
      }
    }

    const selectedChannelIds = config.enabledChannelIds.filter((channelId) => {
      const channel = context.channelStatus[channelId];
      return Boolean(
        channel?.enabled &&
        MarketplacePublicationPolicy.canPublish(
          offer.marketplaceType,
          channel.visibility,
        ),
      );
    });

    if (!selectedChannelIds.length) {
      return {
        reason: AutopilotDecisionReason.REJECTED_CHANNEL_POLICY,
        approved: false,
        details: "No valid channel found based on marketplace policy",
      };
    }

    if (config.mode === AutopilotMode.DRY_RUN) {
      return {
        reason: AutopilotDecisionReason.DRY_RUN_APPROVED,
        approved: true,
        channelId: selectedChannelIds[0],
        channelIds: selectedChannelIds,
        details:
          monetization.status !== MonetizationStatus.VERIFIED
            ? "Não seria publicada: link afiliado não verificado."
            : "Simulação aprovada.",
      };
    }

    return {
      reason: AutopilotDecisionReason.APPROVED,
      approved: true,
      channelId: selectedChannelIds[0],
      channelIds: selectedChannelIds,
    };
  }
}
