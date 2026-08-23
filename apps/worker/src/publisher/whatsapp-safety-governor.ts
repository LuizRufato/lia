import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface WhatsAppGovernorInput {
  tenantId: string;
  channelId: string;
  integration: any;
  channel: any;
  offer: any;
  observedAt?: Date;
  score?: number | null;
  category?: string | null;
  sellerId?: string | null;
  now?: Date;
}

export interface WhatsAppGovernorDecision {
  allowed: boolean;
  reason?: string;
  retryAt?: Date;
}

const minuteOfDay = (date: Date) => date.getHours() * 60 + date.getMinutes();
// Reuse the existing FatigueRule policy: three real publications in 12h.
// DELIVERY_UNKNOWN is included conservatively because delivery may have happened.
const SATURATION_WINDOW_MS = 12 * 60 * 60 * 1000;
const SATURATION_LIMIT = 3;
const REAL_PUBLICATION_STATUSES: Array<'PUBLISHED' | 'PUBLISHING' | 'DELIVERY_UNKNOWN'> = [
  'PUBLISHED',
  'PUBLISHING',
  'DELIVERY_UNKNOWN',
];

/** Database-backed, conservative gate immediately before a WhatsApp send. */
@Injectable()
export class WhatsAppSafetyGovernor {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(input: WhatsAppGovernorInput): Promise<WhatsAppGovernorDecision> {
    const now = input.now || new Date();
    const config = await this.prisma.whatsAppSafetyConfig.findUnique({
      where: { tenantId: input.tenantId },
    });
    const maxPerHour = config?.maxPerHour ?? 20;
    const maxPerDay = config?.maxPerDay ?? 100;
    const minIntervalSeconds = Math.max(
      config?.minIntervalSeconds ?? input.channel.safetyMinIntervalSeconds ?? 60,
      input.channel.safetyMinIntervalSeconds ?? 60,
    );

    if (config?.enabled === false || config?.killSwitch) {
      return { allowed: false, reason: 'WHATSAPP_KILL_SWITCH' };
    }
    if (config?.circuitState === 'OPEN') {
      const openedAt = config.circuitOpenedAt?.getTime() || now.getTime();
      const cooldown = 10 * 60_000;
      if (now.getTime() - openedAt < cooldown) {
        return {
          allowed: false,
          reason: 'WHATSAPP_CIRCUIT_OPEN',
          retryAt: new Date(openedAt + cooldown),
        };
      }
      await this.prisma.whatsAppSafetyConfig.update({
        where: { tenantId: input.tenantId },
        data: { circuitState: 'CLOSED', consecutiveErrors: 0, circuitOpenedAt: null },
      });
    }
    if (!input.channel.enabled || input.channel.provider !== 'WHATSAPP') {
      return { allowed: false, reason: 'WHATSAPP_GROUP_DISABLED' };
    }
    if (!input.integration || input.integration.status !== 'CONNECTED') {
      return { allowed: false, reason: 'WHATSAPP_SESSION_OFFLINE' };
    }
    if (
      input.integration.transport === 'WEB_UNOFFICIAL' &&
      (!input.integration.externalInstanceName || !input.integration.encryptedAccessToken)
    ) {
      return { allowed: false, reason: 'WHATSAPP_TRANSPORT_INVALID' };
    }
    if (
      input.integration.transport === 'CLOUD_OFFICIAL' &&
      (!input.integration.wabaId || !input.integration.phoneNumberId || !input.integration.encryptedAccessToken)
    ) {
      return { allowed: false, reason: 'WHATSAPP_TRANSPORT_INVALID' };
    }
    const reconnectionCooldown =
      (config?.reconnectionCooldownSeconds ?? 90) * 1000;
    if (
      input.integration.connectedAt &&
      now.getTime() - new Date(input.integration.connectedAt).getTime() < reconnectionCooldown
    ) {
      return {
        allowed: false,
        reason: 'WHATSAPP_RECONNECTION_COOLDOWN',
        retryAt: new Date(new Date(input.integration.connectedAt).getTime() + reconnectionCooldown),
      };
    }

    const start = config?.quietStartMinute ?? input.channel.safetyWindowStartMinute;
    const end = config?.quietEndMinute ?? input.channel.safetyWindowEndMinute;
    if (start !== null && start !== undefined && end !== null && end !== undefined) {
      const current = minuteOfDay(now);
      const inside = start <= end ? current >= start && current <= end : current >= start || current <= end;
      if (!inside) return { allowed: false, reason: 'WHATSAPP_OUTSIDE_ALLOWED_WINDOW' };
    }

    if (input.offer?.status !== 'ACTIVE') {
      return { allowed: false, reason: 'WHATSAPP_OFFER_EXPIRED' };
    }
    if (
      input.offer?.monetization?.status !== 'VERIFIED' ||
      !input.offer?.monetization?.destinationUrl
    ) {
      return { allowed: false, reason: 'WHATSAPP_MONETIZATION_INVALID' };
    }
    const maxAge = (config?.maxObservationAgeMinutes ?? 1440) * 60_000;
    if (input.observedAt && now.getTime() - new Date(input.observedAt).getTime() > maxAge) {
      return { allowed: false, reason: 'WHATSAPP_OBSERVATION_EXPIRED' };
    }
    const score = Number(input.score ?? 0);
    if (score < (config?.minQualityScore ?? 0)) {
      return { allowed: false, reason: 'WHATSAPP_QUALITY_GATE' };
    }

    const hourAgo = new Date(now.getTime() - 60 * 60_000);
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
    const [hourCount, dayCount, lastPublication] = await Promise.all([
      this.prisma.publication.count({
        where: {
          channelId: input.channelId,
          status: { in: REAL_PUBLICATION_STATUSES },
          createdAt: { gte: hourAgo },
        },
      }),
      this.prisma.publication.count({
        where: {
          channelId: input.channelId,
          status: { in: REAL_PUBLICATION_STATUSES },
          createdAt: { gte: dayAgo },
        },
      }),
      this.prisma.publication.findFirst({
        where: { channelId: input.channelId, status: 'PUBLISHED' },
        orderBy: { publishedAt: 'desc' },
        select: { publishedAt: true },
      }),
    ]);
    const tenantCounts = await Promise.all([
      this.prisma.publication.count({
        where: {
          channel: { tenantId: input.tenantId },
          status: { in: REAL_PUBLICATION_STATUSES },
          createdAt: { gte: hourAgo },
        },
      }),
      this.prisma.publication.count({
        where: {
          channel: { tenantId: input.tenantId },
          status: { in: REAL_PUBLICATION_STATUSES },
          createdAt: { gte: dayAgo },
        },
      }),
    ]);
    const saturationSince = new Date(now.getTime() - SATURATION_WINDOW_MS);
    const categoryCount = input.category
      ? await this.prisma.publication.count({
          where: {
            channelId: input.channelId,
            status: { in: REAL_PUBLICATION_STATUSES },
            createdAt: { gte: saturationSince },
            candidate: { evaluation: { observation: { category: input.category } } },
          },
        })
      : 0;
    const sellerCount = input.sellerId
      ? await this.prisma.publication.count({
          where: {
            channelId: input.channelId,
            status: { in: REAL_PUBLICATION_STATUSES },
            createdAt: { gte: saturationSince },
            candidate: {
              evaluation: {
                observation: {
                  canonicalPayload: {
                    path: ['seller', 'externalId'],
                    equals: input.sellerId,
                  },
                },
              },
            },
          } as any,
        })
      : 0;
    const channelHourly = input.channel.safetyMaxPerHour ?? 10;
    const channelDaily = input.channel.safetyMaxPerDay ?? 50;
    if (tenantCounts[0] >= maxPerHour) {
      return { allowed: false, reason: 'WHATSAPP_TENANT_HOURLY_LIMIT', retryAt: new Date(now.getTime() + 60 * 60_000) };
    }
    if (tenantCounts[1] >= maxPerDay) {
      return { allowed: false, reason: 'WHATSAPP_TENANT_DAILY_LIMIT', retryAt: new Date(now.getTime() + 24 * 60 * 60_000) };
    }
    if (hourCount >= Math.min(maxPerHour, channelHourly)) {
      return { allowed: false, reason: 'WHATSAPP_HOURLY_LIMIT', retryAt: new Date(now.getTime() + 60 * 60_000) };
    }
    if (dayCount >= Math.min(maxPerDay, channelDaily)) {
      return { allowed: false, reason: 'WHATSAPP_DAILY_LIMIT', retryAt: new Date(now.getTime() + 24 * 60 * 60_000) };
    }
    if (lastPublication?.publishedAt && now.getTime() - lastPublication.publishedAt.getTime() < minIntervalSeconds * 1000) {
      return {
        allowed: false,
        reason: 'WHATSAPP_MIN_INTERVAL',
        retryAt: new Date(lastPublication.publishedAt.getTime() + minIntervalSeconds * 1000),
      };
    }
    if (categoryCount >= SATURATION_LIMIT) {
      return { allowed: false, reason: 'WHATSAPP_CATEGORY_SATURATION', retryAt: new Date(saturationSince.getTime() + SATURATION_WINDOW_MS) };
    }
    if (sellerCount >= SATURATION_LIMIT) {
      return { allowed: false, reason: 'WHATSAPP_SELLER_SATURATION', retryAt: new Date(saturationSince.getTime() + SATURATION_WINDOW_MS) };
    }

    return { allowed: true };
  }

  async recordFailure(tenantId: string): Promise<void> {
    const current = await this.prisma.whatsAppSafetyConfig.findUnique({ where: { tenantId } });
    const errors = (current?.consecutiveErrors ?? 0) + 1;
    await this.prisma.whatsAppSafetyConfig.upsert({
      where: { tenantId },
      update: {
        consecutiveErrors: errors,
        circuitState: errors >= 3 ? 'OPEN' : current?.circuitState ?? 'CLOSED',
        circuitOpenedAt: errors >= 3 ? new Date() : current?.circuitOpenedAt,
      },
      create: {
        tenantId,
        consecutiveErrors: errors,
        circuitState: errors >= 3 ? 'OPEN' : 'CLOSED',
        circuitOpenedAt: errors >= 3 ? new Date() : null,
      },
    });
  }

  async recordSuccess(tenantId: string): Promise<void> {
    await this.prisma.whatsAppSafetyConfig.upsert({
      where: { tenantId },
      update: { consecutiveErrors: 0, circuitState: 'CLOSED', circuitOpenedAt: null },
      create: { tenantId, consecutiveErrors: 0, circuitState: 'CLOSED' },
    });
  }
}
