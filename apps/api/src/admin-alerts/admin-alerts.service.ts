import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  decryptSecret,
  encryptSecret,
  getEncryptionKey,
  WhatsAppEvolutionProvider,
} from '@lia/integrations';
import { PrismaService } from '../prisma.service';
import { UpdateAdminAlertConfigDto } from './dto/update-admin-alert-config.dto';

const DEFAULTS = {
  enabled: false,
  newShopeeSaleEnabled: true,
  commissionConfirmedEnabled: false,
  saleCancelledEnabled: false,
  highValueSaleEnabled: false,
  criticalErrorEnabled: false,
  dailySummaryEnabled: false,
} as const;

const TOGGLE_FIELDS = [
  'newShopeeSaleEnabled',
  'commissionConfirmedEnabled',
  'saleCancelledEnabled',
  'highValueSaleEnabled',
  'criticalErrorEnabled',
  'dailySummaryEnabled',
] as const;

type AdminRole = 'OWNER' | 'ADMIN';

@Injectable()
export class AdminAlertsService {
  private readonly testSentAt = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  async getConfig(tenantId: string, role: string) {
    this.assertAdminRole(role);

    const config = await this.prisma.adminAlertConfig.findUnique({
      where: { tenantId },
    });

    return this.toView(tenantId, config);
  }

  async updateConfig(
    tenantId: string,
    role: string,
    input: UpdateAdminAlertConfigDto,
  ) {
    this.assertAdminRole(role);

    if (input.recipient !== undefined && input.removeRecipient) {
      throw new BadRequestException(
        'Escolha entre substituir ou remover o destinatário.',
      );
    }

    const existing = await this.prisma.adminAlertConfig.findUnique({
      where: { tenantId },
    });
    const current = existing || DEFAULTS;
    const hasCurrentRecipient = Boolean(
      existing?.encryptedRecipient &&
      existing.recipientIv &&
      existing.recipientAuthTag,
    );

    let encryptedRecipient = existing?.encryptedRecipient ?? null;
    let recipientIv = existing?.recipientIv ?? null;
    let recipientAuthTag = existing?.recipientAuthTag ?? null;
    let adminWhatsappIntegrationId =
      existing?.adminWhatsappIntegrationId ?? null;

    if (input.adminWhatsappIntegrationId !== undefined) {
      adminWhatsappIntegrationId = input.adminWhatsappIntegrationId || null;
      if (
        adminWhatsappIntegrationId &&
        !(await this.findUsableSender(tenantId, adminWhatsappIntegrationId))
      ) {
        throw new BadRequestException(
          'A integração WhatsApp/Evolution selecionada não está disponível para este tenant.',
        );
      }
    }

    if (input.removeRecipient) {
      encryptedRecipient = null;
      recipientIv = null;
      recipientAuthTag = null;
    } else if (input.recipient !== undefined) {
      const normalizedRecipient = this.normalizeRecipient(input.recipient);
      const encrypted = encryptSecret(normalizedRecipient, getEncryptionKey());
      encryptedRecipient = encrypted.encryptedSecret;
      recipientIv = encrypted.iv;
      recipientAuthTag = encrypted.authTag;
    }

    const hasRecipient = input.removeRecipient
      ? false
      : input.recipient !== undefined
        ? true
        : hasCurrentRecipient;
    const enabled = input.enabled ?? current.enabled;

    if (enabled && !hasRecipient) {
      throw new BadRequestException(
        'Cadastre um destinatário WhatsApp autorizado antes de ativar os alertas.',
      );
    }

    if (
      enabled &&
      (!adminWhatsappIntegrationId ||
        !(await this.findUsableSender(tenantId, adminWhatsappIntegrationId)))
    ) {
      throw new BadRequestException(
        'Selecione uma integração WhatsApp/Evolution conectada antes de ativar os alertas.',
      );
    }

    const wasEnabled = existing?.enabled ?? false;
    const enabledAt =
      enabled && !wasEnabled ? new Date() : (existing?.enabledAt ?? null);
    const toggleData = Object.fromEntries(
      TOGGLE_FIELDS.map((field) => [field, input[field] ?? current[field]]),
    );

    const saved = await this.prisma.adminAlertConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        enabled,
        encryptedRecipient,
        recipientIv,
        recipientAuthTag,
        adminWhatsappIntegrationId,
        enabledAt,
        ...toggleData,
      },
      update: {
        enabled,
        encryptedRecipient,
        recipientIv,
        recipientAuthTag,
        adminWhatsappIntegrationId,
        enabledAt,
        ...toggleData,
      },
    });

    return this.toView(tenantId, saved);
  }

  async sendTestMessage(tenantId: string, role: string) {
    this.assertAdminRole(role);

    const lastSentAt = this.testSentAt.get(tenantId) || 0;
    if (Date.now() - lastSentAt < 60_000) {
      throw new BadRequestException(
        'Aguarde um minuto antes de enviar outro teste.',
      );
    }

    const config = await this.prisma.adminAlertConfig.findUnique({
      where: { tenantId },
    });
    if (!config?.enabled) {
      throw new BadRequestException(
        'Ative os alertas antes de enviar um teste.',
      );
    }
    if (
      !config.encryptedRecipient ||
      !config.recipientIv ||
      !config.recipientAuthTag
    ) {
      throw new BadRequestException(
        'Cadastre um destinatário autorizado antes de enviar um teste.',
      );
    }

    const sender = config.adminWhatsappIntegrationId
      ? await this.findUsableSender(tenantId, config.adminWhatsappIntegrationId)
      : null;
    if (!sender) {
      throw new BadRequestException(
        'Selecione uma integração WhatsApp/Evolution conectada antes de enviar um teste.',
      );
    }

    const recipient = decryptSecret(
      config.encryptedRecipient,
      config.recipientIv,
      config.recipientAuthTag,
      getEncryptionKey(),
    );
    const token = decryptSecret(
      sender.encryptedAccessToken!,
      sender.tokenIv!,
      sender.tokenAuthTag!,
      getEncryptionKey(),
    );
    this.testSentAt.set(tenantId, Date.now());

    const messageId = await new WhatsAppEvolutionProvider().sendPrivateMessage(
      sender.externalInstanceName!,
      token,
      recipient,
      '✅ Teste de alertas LIA\n\nSeu WhatsApp administrativo está configurado corretamente.',
    );

    return {
      success: Boolean(messageId),
      status: messageId ? 'SENT' : 'DELIVERY_UNKNOWN',
      messageId,
    };
  }

  private assertAdminRole(role: string): asserts role is AdminRole {
    if (role !== 'OWNER' && role !== 'ADMIN') {
      throw new ForbiddenException(
        'Somente OWNER ou ADMIN pode alterar os alertas administrativos.',
      );
    }
  }

  private normalizeRecipient(value: string): string {
    const trimmed = value.trim();
    const hasOnlyValidCharacters = /^\+?[\d\s().-]+$/.test(trimmed);
    const digits = trimmed.replace(/\D/g, '');

    if (!hasOnlyValidCharacters || digits.length < 10 || digits.length > 15) {
      throw new BadRequestException(
        'Informe um telefone WhatsApp válido com código do país.',
      );
    }

    return digits;
  }

  private async toView(tenantId: string, config: any) {
    const hasRecipient = Boolean(
      config?.encryptedRecipient &&
      config?.recipientIv &&
      config?.recipientAuthTag,
    );
    const recipientMasked = hasRecipient
      ? this.maskRecipient(
          decryptSecret(
            config.encryptedRecipient,
            config.recipientIv,
            config.recipientAuthTag,
            getEncryptionKey(),
          ),
        )
      : null;

    const senderIntegrations = await this.getSafeSenderIntegrations(tenantId);
    const selectedSender = senderIntegrations.find(
      (integration) => integration.id === config?.adminWhatsappIntegrationId,
    );

    return {
      enabled: config?.enabled ?? DEFAULTS.enabled,
      hasRecipient,
      recipientMasked,
      adminWhatsappIntegrationId: config?.adminWhatsappIntegrationId ?? null,
      senderIntegrationName: selectedSender?.name ?? null,
      senderIntegrations,
      newShopeeSaleEnabled:
        config?.newShopeeSaleEnabled ?? DEFAULTS.newShopeeSaleEnabled,
      commissionConfirmedEnabled:
        config?.commissionConfirmedEnabled ??
        DEFAULTS.commissionConfirmedEnabled,
      saleCancelledEnabled:
        config?.saleCancelledEnabled ?? DEFAULTS.saleCancelledEnabled,
      highValueSaleEnabled:
        config?.highValueSaleEnabled ?? DEFAULTS.highValueSaleEnabled,
      criticalErrorEnabled:
        config?.criticalErrorEnabled ?? DEFAULTS.criticalErrorEnabled,
      dailySummaryEnabled:
        config?.dailySummaryEnabled ?? DEFAULTS.dailySummaryEnabled,
      enabledAt: config?.enabledAt ?? null,
    };
  }

  private maskRecipient(recipient: string): string {
    return `${'*'.repeat(Math.max(6, recipient.length - 4))}${recipient.slice(-4)}`;
  }

  private async getSafeSenderIntegrations(tenantId: string) {
    const integrations = await this.prisma.channelIntegration.findMany({
      where: {
        tenantId,
        provider: 'WHATSAPP',
        transport: 'WEB_UNOFFICIAL',
        status: 'CONNECTED',
        externalInstanceName: { not: null },
        encryptedAccessToken: { not: null },
        tokenIv: { not: null },
        tokenAuthTag: { not: null },
      },
      select: {
        id: true,
        externalInstanceName: true,
        businessDisplayName: true,
      },
    });

    return integrations.map((integration) => ({
      id: integration.id,
      name:
        integration.businessDisplayName ||
        integration.externalInstanceName ||
        'WhatsApp Evolution',
    }));
  }

  private async findUsableSender(tenantId: string, integrationId: string) {
    return this.prisma.channelIntegration.findFirst({
      where: {
        id: integrationId,
        tenantId,
        provider: 'WHATSAPP',
        transport: 'WEB_UNOFFICIAL',
        status: 'CONNECTED',
        externalInstanceName: { not: null },
        encryptedAccessToken: { not: null },
        tokenIv: { not: null },
        tokenAuthTag: { not: null },
      },
      select: {
        id: true,
        externalInstanceName: true,
        encryptedAccessToken: true,
        tokenIv: true,
        tokenAuthTag: true,
      },
    });
  }
}
