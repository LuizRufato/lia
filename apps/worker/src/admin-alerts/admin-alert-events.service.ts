import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { generateAdminAlertRecipientHash } from '@lia/core';
import { decryptSecret, getEncryptionKey } from '@lia/integrations';
import { PrismaService } from '../prisma.service';
import { buildAdminAlertJobId } from './admin-alert-job-id';
import { getLocalDayWindow } from './daily-summary-time';

type AlertType = 'CRITICAL_ERROR' | 'DAILY_SUMMARY';
type AlertInput = {
  tenantId: string;
  type: AlertType;
  dedupeKey: string;
  payload: Record<string, unknown>;
  externalEventId?: string;
  provider?: 'SHOPEE';
  marketplaceConversionId?: string;
};

const TOGGLE_BY_TYPE = {
  CRITICAL_ERROR: 'criticalErrorEnabled',
  DAILY_SUMMARY: 'dailySummaryEnabled',
} as const;

const INCIDENT_COOLDOWN_MS = 60 * 60 * 1000;

@Injectable()
export class AdminAlertEventsService {
  private readonly logger = new Logger(AdminAlertEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('admin-alerts') private readonly queue: Queue,
  ) {}

  async createPublicationFailureAlert(input: {
    tenantId: string;
    publicationId?: string | null;
    jobId?: string | null;
    product?: string | null;
    channel?: string | null;
    error?: string | null;
  }) {
    const identity = input.publicationId || input.jobId || 'unknown';
    const alert = await this.createAndQueue({
      tenantId: input.tenantId,
      type: 'CRITICAL_ERROR',
      dedupeKey: `publication-failure:${input.tenantId}:${identity}`,
      externalEventId: identity,
      payload: {
        incidentType: 'PUBLICATION_FAILURE',
        product: input.product || null,
        channel: input.channel || null,
        error: sanitizeError(input.error),
      },
    });
    this.logger.log(
      'ADMIN_ALERT_PUBLICATION_FAILURE_CREATED tenant=' +
        input.tenantId +
        ' alert=' +
        alert.id,
    );
    return alert;
  }

  async createEvolutionOfflineAlert(input: {
    tenantId: string;
    integrationId: string;
    integrationName?: string | null;
    state: string;
    error?: string | null;
    now?: Date;
  }) {
    const now = input.now || new Date();
    if (
      await this.hasRecentIncident(
        'CRITICAL_ERROR',
        `evolution:${input.integrationId}`,
        now,
      )
    ) {
      this.logger.debug('ADMIN_ALERT_COOLDOWN_SKIPPED');
      return null;
    }
    const alert = await this.createAndQueue({
      tenantId: input.tenantId,
      type: 'CRITICAL_ERROR',
      dedupeKey: `evolution-offline:${input.tenantId}:${input.integrationId}:${now.getTime()}`,
      externalEventId: `evolution:${input.integrationId}`,
      payload: {
        incidentType: 'EVOLUTION_OFFLINE',
        integration: input.integrationName || 'WhatsApp administrativo',
        state: input.state,
        error: sanitizeError(input.error),
      },
    });
    this.logger.log(
      'ADMIN_ALERT_EVOLUTION_OFFLINE_CREATED tenant=' +
        input.tenantId +
        ' alert=' +
        alert.id,
    );
    return alert;
  }

  async createShopeeDisconnectedAlert(input: {
    tenantId: string;
    integrationId: string;
    state: string;
    error?: string | null;
    now?: Date;
  }) {
    const now = input.now || new Date();
    if (
      await this.hasRecentIncident(
        'CRITICAL_ERROR',
        `shopee:${input.integrationId}`,
        now,
      )
    ) {
      this.logger.debug('ADMIN_ALERT_COOLDOWN_SKIPPED');
      return null;
    }
    const alert = await this.createAndQueue({
      tenantId: input.tenantId,
      type: 'CRITICAL_ERROR',
      dedupeKey: `shopee-disconnected:${input.tenantId}:${input.integrationId}:${now.getTime()}`,
      externalEventId: `shopee:${input.integrationId}`,
      provider: 'SHOPEE',
      payload: {
        incidentType: 'SHOPEE_DISCONNECTED',
        state: input.state,
        error: sanitizeError(input.error),
      },
    });
    this.logger.log(
      'ADMIN_ALERT_SHOPEE_DISCONNECTED_CREATED tenant=' +
        input.tenantId +
        ' alert=' +
        alert.id,
    );
    return alert;
  }

  async scheduleDailySummaries(now = new Date()) {
    const { localDate, start, end } = getLocalDayWindow(now);
    const configs = await this.prisma.adminAlertConfig.findMany({
      where: { enabled: true, dailySummaryEnabled: true },
      select: { tenantId: true },
    });

    for (const config of configs) {
      const payload = await this.collectDailyMetrics(
        config.tenantId,
        start,
        end,
      );
      const alert = await this.createAndQueue({
        tenantId: config.tenantId,
        type: 'DAILY_SUMMARY',
        dedupeKey: `daily-summary:${config.tenantId}:${localDate}`,
        payload: { ...payload, period: localDate },
      });
      this.logger.log(
        alert.created
          ? 'DAILY_SUMMARY_CREATED tenant=' +
              config.tenantId +
              ' date=' +
              localDate
          : 'DAILY_SUMMARY_DUPLICATE_SKIPPED tenant=' +
              config.tenantId +
              ' date=' +
              localDate,
      );
    }
  }

  private async collectDailyMetrics(tenantId: string, start: Date, end: Date) {
    const [publications, clicks, conversions, failures] = await Promise.all([
      this.prisma.publication.count({
        where: {
          channel: { tenantId },
          status: 'PUBLISHED',
          publishedAt: { gte: start, lte: end },
        },
      }),
      this.prisma.clickEvent.count({
        where: {
          link: { publication: { channel: { tenantId } } },
          clickedAt: { gte: start, lte: end },
          classification: 'VALID',
        },
      }),
      this.prisma.marketplaceConversion.findMany({
        where: {
          tenantId,
          provider: 'SHOPEE',
          purchaseTime: { gte: start, lte: end },
          commissionStatus: { not: 'CANCELLED' },
        },
        select: {
          attributionStatus: true,
          totalCommissionCents: true,
          orders: {
            select: {
              items: { select: { itemName: true, actualAmountCents: true } },
            },
          },
        },
      }),
      this.prisma.publication.count({
        where: {
          channel: { tenantId },
          status: 'FAILED',
          updatedAt: { gte: start, lte: end },
        },
      }),
    ]);

    const topProducts = new Map<string, number>();
    let commissionCents = 0;
    for (const conversion of conversions) {
      if (conversion.attributionStatus === 'ATTRIBUTED') {
        commissionCents += conversion.totalCommissionCents || 0;
      }
      for (const order of conversion.orders) {
        for (const item of order.items) {
          topProducts.set(
            item.itemName,
            (topProducts.get(item.itemName) || 0) +
              (item.actualAmountCents || 0),
          );
        }
      }
    }
    const topProduct =
      [...topProducts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    return {
      publications,
      clicks,
      sales: conversions.length,
      commissionCents,
      topProduct,
      failures,
    };
  }

  private async createAndQueue(input: AlertInput) {
    const existing = this.prisma.adminAlert.findUnique
      ? await this.prisma.adminAlert.findUnique({
          where: { dedupeKey: input.dedupeKey },
          select: { id: true },
        })
      : null;
    const alert = await this.prisma.adminAlert.upsert({
      where: { dedupeKey: input.dedupeKey },
      create: {
        tenantId: input.tenantId,
        type: input.type,
        provider: input.provider,
        externalEventId: input.externalEventId,
        marketplaceConversionId: input.marketplaceConversionId,
        dedupeKey: input.dedupeKey,
        payload: input.payload as any,
      },
      update: {},
      select: { id: true, createdAt: true, deliveryStatus: true },
    });
    await this.enqueueAlert(input.tenantId, input.type, alert);
    return { ...alert, created: !existing };
  }

  private async enqueueAlert(
    tenantId: string,
    type: AlertType,
    alert: { id: string; createdAt: Date; deliveryStatus: string },
  ) {
    const config = await this.prisma.adminAlertConfig.findUnique({
      where: { tenantId },
    });
    const toggle = TOGGLE_BY_TYPE[type];
    if (
      !config?.enabled ||
      !config[toggle] ||
      !config.adminWhatsappIntegrationId ||
      !config.enabledAt ||
      alert.createdAt < config.enabledAt
    )
      return;

    const sender = await this.prisma.channelIntegration.findFirst({
      where: {
        id: config.adminWhatsappIntegrationId,
        tenantId,
        provider: 'WHATSAPP',
        transport: 'WEB_UNOFFICIAL',
        status: 'CONNECTED',
      },
      select: { id: true },
    });
    if (!sender) return;
    let recipients = await this.prisma.adminAlertRecipient.findMany({
      where: { tenantId, configId: config.id, enabled: true },
      select: { id: true },
    });
    if (!recipients.length) {
      const legacy = await this.ensureLegacyRecipient(tenantId, config);
      if (legacy) recipients = [{ id: legacy.id }];
    }
    if (!recipients.length) return;
    await this.prisma.adminAlertDelivery.createMany({
      data: recipients.map((recipient) => ({
        alertId: alert.id,
        recipientId: recipient.id,
      })),
      skipDuplicates: true,
    });
    await this.prisma.adminAlert.update({
      where: { id: alert.id },
      data: { deliveryStatus: 'PENDING', lastDeliveryError: null },
    });
    const deliveries = await this.prisma.adminAlertDelivery.findMany({
      where: {
        alertId: alert.id,
        recipientId: { in: recipients.map(({ id }) => id) },
        status: { in: ['PENDING', 'FAILED'] },
      },
      select: { id: true },
    });
    for (const delivery of deliveries) {
      await this.queue.add(
        'deliver-admin-alert',
        { deliveryId: delivery.id },
        {
          jobId: buildAdminAlertJobId(alert.id, delivery.id),
          attempts: 5,
          backoff: { type: 'exponential', delay: 20_000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    }
  }

  private async hasRecentIncident(
    type: AlertType,
    externalEventId: string,
    now: Date,
  ) {
    const recent = await this.prisma.adminAlert.findFirst({
      where: {
        type,
        externalEventId,
        createdAt: { gte: new Date(now.getTime() - INCIDENT_COOLDOWN_MS) },
      },
      select: { id: true },
    });
    return Boolean(recent);
  }

  private async ensureLegacyRecipient(tenantId: string, config: any) {
    if (
      !config.encryptedRecipient ||
      !config.recipientIv ||
      !config.recipientAuthTag ||
      !config.id
    )
      return null;

    try {
      const normalized = decryptSecret(
        config.encryptedRecipient,
        config.recipientIv,
        config.recipientAuthTag,
        getEncryptionKey(),
      );
      const recipientHash = generateAdminAlertRecipientHash(
        normalized,
        getEncryptionKey(),
      );
      return await this.prisma.adminAlertRecipient.upsert({
        where: {
          configId_recipientHash: { configId: config.id, recipientHash },
        },
        create: {
          tenantId,
          configId: config.id,
          recipientHash,
          encryptedRecipient: config.encryptedRecipient,
          recipientIv: config.recipientIv,
          recipientAuthTag: config.recipientAuthTag,
          enabled: true,
        },
        update: {},
        select: { id: true },
      });
    } catch (error: any) {
      this.logger.error(
        `ADMIN_ALERT_LEGACY_RECIPIENT_FAILED tenant=${tenantId}: ${sanitizeError(error?.message || error)}`,
      );
      return null;
    }
  }
}

function sanitizeError(value?: string | null) {
  return String(value || 'Indisponibilidade não detalhada')
    .replace(/\+?\d{10,15}/g, '[telefone mascarado]')
    .replace(
      /(token|apikey|authorization|secret|password)\s*[=:]\s*[^\s,;]+/gi,
      '$1=[redacted]',
    )
    .slice(0, 240);
}
