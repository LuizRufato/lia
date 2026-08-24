import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import {
  generateAdminAlertRecipientHash,
  buildNewShopeeSaleMessage,
} from '@lia/core';
import {
  decryptSecret,
  getEncryptionKey,
  WhatsAppEvolutionProvider,
} from '@lia/integrations';
import { PrismaService } from '../prisma.service';

type AdminAlertJobData = { deliveryId?: string; alertId?: string };

@Processor('admin-alerts', { concurrency: 1 })
@Injectable()
export class AdminAlertsProcessor extends WorkerHost {
  private readonly logger = new Logger(AdminAlertsProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<AdminAlertJobData, any, string>): Promise<any> {
    const delivery = job.data.deliveryId
      ? await this.prisma.adminAlertDelivery.findUnique({
          where: { id: job.data.deliveryId },
          include: { alert: true, recipient: true },
        })
      : await this.getLegacyDelivery(job.data.alertId);
    if (!delivery)
      throw new UnrecoverableError('Admin alert delivery not found.');
    if (delivery.status === 'SENT')
      return { skipped: true, reason: 'Already sent' };

    const alert = delivery.alert;
    const config =
      delivery.config ||
      (await this.prisma.adminAlertConfig.findUnique({
        where: { tenantId: alert.tenantId },
        select: {
          enabled: true,
          newShopeeSaleEnabled: true,
          adminWhatsappIntegrationId: true,
          enabledAt: true,
        },
      }));
    if (
      !config?.enabled ||
      alert.type !== 'NEW_SHOPEE_SALE' ||
      !config.newShopeeSaleEnabled ||
      !config.adminWhatsappIntegrationId ||
      !config.enabledAt ||
      alert.createdAt < config.enabledAt ||
      !delivery.recipient.enabled
    ) {
      return { skipped: true, reason: 'Alert configuration is not eligible' };
    }

    const sender = await this.prisma.channelIntegration.findFirst({
      where: {
        id: config.adminWhatsappIntegrationId,
        tenantId: alert.tenantId,
        provider: 'WHATSAPP',
        transport: 'WEB_UNOFFICIAL',
        status: 'CONNECTED',
        externalInstanceName: { not: null },
        encryptedAccessToken: { not: null },
        tokenIv: { not: null },
        tokenAuthTag: { not: null },
      },
      select: {
        externalInstanceName: true,
        encryptedAccessToken: true,
        tokenIv: true,
        tokenAuthTag: true,
      },
    });
    if (!sender)
      return { skipped: true, reason: 'Sender integration is not usable' };

    let recipient: string;
    let token: string;
    try {
      recipient = decryptSecret(
        delivery.recipient.encryptedRecipient,
        delivery.recipient.recipientIv,
        delivery.recipient.recipientAuthTag,
        getEncryptionKey(),
      );
      token = decryptSecret(
        sender.encryptedAccessToken!,
        sender.tokenIv!,
        sender.tokenAuthTag!,
        getEncryptionKey(),
      );
    } catch (error: any) {
      await this.markFailed(
        delivery.id,
        alert.id,
        `Credential decryption failed: ${error?.message || error}`,
      );
      return { failed: true, reason: 'Credential decryption failed' };
    }

    const attemptNumber = (job.attemptsMade || 0) + 1;
    const maxAttempts = Number(job.opts.attempts || 1);
    if ((this.prisma as any).adminAlertDelivery?.update) {
      await this.prisma.adminAlertDelivery.update({
        where: { id: delivery.id },
        data: { status: 'PENDING', attempts: { increment: 1 } },
      });
    }
    await this.prisma.adminAlert.update({
      where: { id: alert.id },
      data: { deliveryStatus: 'PENDING', deliveryAttempts: { increment: 1 } },
    });

    try {
      const messageId =
        await new WhatsAppEvolutionProvider().sendPrivateMessage(
          sender.externalInstanceName!,
          token,
          recipient,
          buildNewShopeeSaleMessage(alert.payload as any),
        );
      if (!messageId) throw new Error('WhatsApp provider response ambiguous');
      if (this.prisma.adminAlertDelivery?.update) {
        await this.prisma.adminAlertDelivery.update({
          where: { id: delivery.id },
          data: { status: 'SENT', sentAt: new Date(), lastError: null },
        });
      }
      await this.refreshAlertStatus(alert.id);
      return { success: true, messageId };
    } catch (error: any) {
      const safeError = sanitizeDeliveryError(error);
      if (isTransientDeliveryError(error) && attemptNumber < maxAttempts) {
        if (this.prisma.adminAlertDelivery?.update) {
          await this.prisma.adminAlertDelivery.update({
            where: { id: delivery.id },
            data: { status: 'PENDING', lastError: safeError },
          });
        }
        await this.prisma.adminAlert.update({
          where: { id: alert.id },
          data: { deliveryStatus: 'PENDING', lastDeliveryError: safeError },
        });
        throw new Error(safeError);
      }
      await this.markFailed(delivery.id, alert.id, safeError);
      this.logger.error(
        `Admin alert delivery ${delivery.id} failed: ${safeError}`,
      );
      return { failed: true, reason: safeError };
    }
  }

  private async getLegacyDelivery(alertId?: string): Promise<any> {
    if (!alertId) return null;
    const alert = await this.prisma.adminAlert.findUnique({
      where: { id: alertId },
    });
    if (!alert) return null;
    const config = await this.prisma.adminAlertConfig.findUnique({
      where: { tenantId: alert.tenantId },
    });
    if (!config) return null;
    if (
      !this.prisma.adminAlertRecipient?.upsert ||
      !this.prisma.adminAlertDelivery?.upsert
    ) {
      return {
        id: `legacy:${alert.id}`,
        status: alert.deliveryStatus,
        alert,
        recipient: {
          enabled: true,
          encryptedRecipient: config.encryptedRecipient,
          recipientIv: config.recipientIv,
          recipientAuthTag: config.recipientAuthTag,
        },
        config,
      };
    }
    const recipient = await this.ensureLegacyRecipient(alert.tenantId, config);
    if (!recipient) return null;
    return this.prisma.adminAlertDelivery.upsert({
      where: { alertId_recipientId: { alertId, recipientId: recipient.id } },
      create: { alertId, recipientId: recipient.id },
      update: {},
      include: { alert: true, recipient: true },
    });
  }

  async enqueueAdminAlert(
    tenantId: string,
    alert: { id: string; createdAt: Date; deliveryStatus: string },
    queue: { add: Function },
  ) {
    if (alert.deliveryStatus === 'SENT') return;
    const config = await this.prisma.adminAlertConfig.findUnique({
      where: { tenantId },
      select: {
        id: true,
        enabled: true,
        newShopeeSaleEnabled: true,
        encryptedRecipient: true,
        recipientIv: true,
        recipientAuthTag: true,
        adminWhatsappIntegrationId: true,
        enabledAt: true,
      },
    });
    if (
      !config?.enabled ||
      !config.newShopeeSaleEnabled ||
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
    const legacy = await this.ensureLegacyRecipient(tenantId, config);
    const recipients = await this.prisma.adminAlertRecipient.findMany({
      where: { configId: config.id, tenantId, enabled: true },
      select: { id: true },
    });
    if (!recipients.length && !legacy) return;
    const targetRecipients = recipients.length
      ? recipients
      : legacy
        ? [{ id: legacy.id }]
        : [];
    await this.prisma.adminAlertDelivery.createMany({
      data: targetRecipients.map((recipient) => ({
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
        status: { in: ['PENDING', 'FAILED'] },
        recipientId: { in: targetRecipients.map((recipient) => recipient.id) },
      },
      select: { id: true, status: true },
    });
    for (const delivery of deliveries) {
      await queue.add(
        'deliver-admin-alert',
        { deliveryId: delivery.id },
        {
          jobId: `admin-alert:${alert.id}:delivery:${delivery.id}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 20000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    }
  }

  private async ensureLegacyRecipient(tenantId: string, config: any) {
    if (
      !config.encryptedRecipient ||
      !config.recipientIv ||
      !config.recipientAuthTag ||
      !config.id
    )
      return null;
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
    return this.prisma.adminAlertRecipient.upsert({
      where: { configId_recipientHash: { configId: config.id, recipientHash } },
      create: {
        tenantId,
        configId: config.id,
        encryptedRecipient: config.encryptedRecipient,
        recipientIv: config.recipientIv,
        recipientAuthTag: config.recipientAuthTag,
        recipientHash,
      },
      update: { enabled: true },
    });
  }

  private async refreshAlertStatus(alertId: string) {
    if (!this.prisma.adminAlertDelivery?.findMany) {
      await this.prisma.adminAlert.update({
        where: { id: alertId },
        data: {
          deliveryStatus: 'SENT',
          sentAt: new Date(),
          lastDeliveryError: null,
        },
      });
      return;
    }
    const deliveries = await this.prisma.adminAlertDelivery.findMany({
      where: { alertId },
      select: { status: true, sentAt: true, lastError: true },
    });
    const hasPending = deliveries.some(
      (delivery) => delivery.status === 'PENDING',
    );
    const hasFailed = deliveries.some(
      (delivery) => delivery.status === 'FAILED',
    );
    const allSent =
      deliveries.length > 0 &&
      deliveries.every((delivery) => delivery.status === 'SENT');
    await this.prisma.adminAlert.update({
      where: { id: alertId },
      data: allSent
        ? {
            deliveryStatus: 'SENT',
            sentAt: new Date(),
            lastDeliveryError: null,
          }
        : {
            deliveryStatus: hasPending
              ? 'PENDING'
              : hasFailed
                ? 'FAILED'
                : 'NOT_REQUESTED',
          },
    });
  }

  private async markFailed(deliveryId: string, alertId: string, error: string) {
    const safeError = sanitizeDeliveryError(error);
    if ((this.prisma as any).adminAlertDelivery?.update) {
      await this.prisma.adminAlertDelivery.update({
        where: { id: deliveryId },
        data: { status: 'FAILED', lastError: safeError },
      });
    }
    if ((this.prisma as any).adminAlertDelivery?.update) {
      await this.refreshAlertStatus(alertId);
      await this.prisma.adminAlert.update({
        where: { id: alertId },
        data: { lastDeliveryError: safeError },
      });
    } else {
      await this.prisma.adminAlert.update({
        where: { id: alertId },
        data: { deliveryStatus: 'FAILED', lastDeliveryError: safeError },
      });
    }
  }
}

export { buildNewShopeeSaleMessage } from '@lia/core';

function isTransientDeliveryError(error: any): boolean {
  const message = String(error?.message || error).toLowerCase();
  return (
    message.includes('ambiguous') ||
    message.includes('timeout') ||
    message.includes('http 5') ||
    message.includes('temporarily')
  );
}

export function sanitizeDeliveryError(error: any): string {
  return String(error?.message || error || 'Delivery failed')
    .replace(/\+?\d{10,15}/g, '[redacted-phone]')
    .replace(
      /(token|apikey|authorization|secret|password)\s*[=:]\s*[^\s,;]+/gi,
      '$1=[redacted]',
    )
    .slice(0, 240);
}
