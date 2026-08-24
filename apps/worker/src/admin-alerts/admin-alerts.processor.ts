import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import {
  decryptSecret,
  getEncryptionKey,
  WhatsAppEvolutionProvider,
} from '@lia/integrations';
import { PrismaService } from '../prisma.service';

type AdminAlertJobData = { alertId: string };

type AdminAlertPayload = {
  purchaseTime?: string;
  commissionStatus?: string;
  totalCommissionCents?: number | null;
  orders?: Array<{
    orderId?: string;
    status?: string;
    items?: Array<{
      itemName?: string | null;
      qty?: number | null;
      itemPriceCents?: number | null;
      actualAmountCents?: number | null;
    }>;
  }>;
};

@Processor('admin-alerts', { concurrency: 1 })
@Injectable()
export class AdminAlertsProcessor extends WorkerHost {
  private readonly logger = new Logger(AdminAlertsProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<AdminAlertJobData, any, string>): Promise<any> {
    const { alertId } = job.data;
    const alert = await this.prisma.adminAlert.findUnique({
      where: { id: alertId },
      select: {
        id: true,
        tenantId: true,
        type: true,
        payload: true,
        createdAt: true,
        deliveryStatus: true,
      },
    });

    if (!alert) {
      throw new UnrecoverableError('Admin alert not found.');
    }
    if (alert.deliveryStatus === 'SENT') {
      return { skipped: true, reason: 'Already sent' };
    }

    const config = await this.prisma.adminAlertConfig.findUnique({
      where: { tenantId: alert.tenantId },
      select: {
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
      alert.type !== 'NEW_SHOPEE_SALE' ||
      !config.newShopeeSaleEnabled ||
      !config.encryptedRecipient ||
      !config.recipientIv ||
      !config.recipientAuthTag ||
      !config.adminWhatsappIntegrationId ||
      !config.enabledAt ||
      alert.createdAt < config.enabledAt
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
    if (!sender) {
      return { skipped: true, reason: 'Sender integration is not usable' };
    }

    let recipient: string;
    let token: string;
    try {
      recipient = decryptSecret(
        config.encryptedRecipient,
        config.recipientIv,
        config.recipientAuthTag,
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
        alert.id,
        `Credential decryption failed: ${error?.message || error}`,
      );
      return { failed: true, reason: 'Credential decryption failed' };
    }

    const attemptNumber = (job.attemptsMade || 0) + 1;
    const maxAttempts = Number(job.opts.attempts || 1);
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
          buildNewShopeeSaleMessage(alert.payload as AdminAlertPayload),
        );

      if (!messageId) {
        throw new Error('WhatsApp provider response ambiguous');
      }

      await this.prisma.adminAlert.update({
        where: { id: alert.id },
        data: {
          deliveryStatus: 'SENT',
          sentAt: new Date(),
          lastDeliveryError: null,
        },
      });
      return { success: true, messageId };
    } catch (error: any) {
      const safeError = sanitizeDeliveryError(error);
      const transient = isTransientDeliveryError(error);
      if (transient && attemptNumber < maxAttempts) {
        await this.prisma.adminAlert.update({
          where: { id: alert.id },
          data: { deliveryStatus: 'PENDING', lastDeliveryError: safeError },
        });
        throw new Error(safeError);
      }

      await this.markFailed(alert.id, safeError);
      this.logger.error(
        `Admin alert ${alert.id} delivery failed: ${safeError}`,
      );
      return { failed: true, reason: safeError };
    }
  }

  private async markFailed(alertId: string, error: string) {
    await this.prisma.adminAlert.update({
      where: { id: alertId },
      data: {
        deliveryStatus: 'FAILED',
        lastDeliveryError: sanitizeDeliveryError(error),
      },
    });
  }
}

export function buildNewShopeeSaleMessage(payload: AdminAlertPayload): string {
  const items = (payload.orders || []).flatMap((order) => order.items || []);
  const lines = ['🟢 NOVA VENDA SHOPEE', ''];

  if (items.length === 1) {
    const item = items[0];
    lines.push(`Produto: ${item.itemName || 'Produto não informado'}`);
    lines.push(`Quantidade: ${item.qty ?? 'não informada'}`);
    appendAmount(lines, 'Valor', item.actualAmountCents);
  } else if (items.length > 1) {
    lines.push(`Pedido com ${items.length} itens:`, '');
    for (const item of items) {
      const amount = formatCents(item.actualAmountCents);
      lines.push(
        `• ${item.itemName || 'Produto não informado'} — ${item.qty ?? '?'}x${amount ? ` — ${amount}` : ''}`,
      );
    }
    const amounts = items.map((item) => item.actualAmountCents);
    if (amounts.every((amount) => typeof amount === 'number')) {
      appendAmount(
        lines,
        'Valor do pedido',
        amounts.reduce((total, amount) => total + (amount || 0), 0),
      );
    }
  }

  appendAmount(lines, 'Comissão estimada', payload.totalCommissionCents);
  if (payload.commissionStatus)
    lines.push(`Status: ${payload.commissionStatus}`);
  if (payload.purchaseTime) {
    const date = new Date(payload.purchaseTime);
    if (!Number.isNaN(date.getTime())) {
      lines.push(
        `Horário: ${new Intl.DateTimeFormat('pt-BR', {
          timeZone: 'America/Campo_Grande',
          dateStyle: 'short',
          timeStyle: 'short',
        }).format(date)}`,
      );
    }
  }
  lines.push('LIA');
  return lines.join('\n');
}

function appendAmount(lines: string[], label: string, cents?: number | null) {
  const amount = formatCents(cents);
  if (amount) lines.push(`${label}: ${amount}`);
}

function formatCents(cents?: number | null): string | null {
  return typeof cents === 'number' && Number.isFinite(cents)
    ? `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`
    : null;
}

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
