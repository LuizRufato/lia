import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  buildSimulatedNewShopeeSaleMessage,
  generateAdminAlertRecipientHash,
} from '@lia/core';
import {
  decryptSecret,
  encryptSecret,
  getEncryptionKey,
  WhatsAppEvolutionProvider,
} from '@lia/integrations';
import { PrismaService } from '../prisma.service';
import { UpdateAdminAlertConfigDto } from './dto/update-admin-alert-config.dto';

const MAX_RECIPIENTS = 5;
const TEST_COOLDOWN_MS = 60_000;
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
type RecipientRecord = {
  id: string;
  encryptedRecipient: string;
  recipientIv: string;
  recipientAuthTag: string;
  enabled: boolean;
};

@Injectable()
export class AdminAlertsService {
  private readonly testSentAt = new Map<string, number>();
  private readonly testInFlight = new Set<string>();

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
    const hasCurrentRecipient = await this.hasAnyRecipient(tenantId, existing);
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
      const encrypted = encryptSecret(
        this.normalizeRecipient(input.recipient),
        getEncryptionKey(),
      );
      encryptedRecipient = encrypted.encryptedSecret;
      recipientIv = encrypted.iv;
      recipientAuthTag = encrypted.authTag;
    }

    const hasRecipient = input.removeRecipient
      ? await this.hasStoredRecipientRows(existing?.id)
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

  async addRecipient(tenantId: string, role: string, value: string) {
    this.assertAdminRole(role);
    const config = await this.prisma.adminAlertConfig.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
    });
    if (
      (await this.getRecipientRecords(tenantId, config)).length >=
      MAX_RECIPIENTS
    ) {
      throw new BadRequestException(
        'É possível cadastrar no máximo 5 destinatários.',
      );
    }
    const normalized = this.normalizeRecipient(value);
    const encrypted = encryptSecret(normalized, getEncryptionKey());
    try {
      await this.prisma.adminAlertRecipient.create({
        data: {
          tenantId,
          configId: config.id,
          encryptedRecipient: encrypted.encryptedSecret,
          recipientIv: encrypted.iv,
          recipientAuthTag: encrypted.authTag,
          recipientHash: generateAdminAlertRecipientHash(
            normalized,
            getEncryptionKey(),
          ),
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002')
        throw new ConflictException('Este destinatário já está cadastrado.');
      throw error;
    }
    return this.toView(tenantId, config);
  }

  async setRecipientEnabled(
    tenantId: string,
    role: string,
    recipientId: string,
    enabled: boolean,
  ) {
    this.assertAdminRole(role);
    await this.requireRecipient(tenantId, recipientId);
    await this.prisma.adminAlertRecipient.update({
      where: { id: recipientId },
      data: { enabled },
    });
    return this.getConfig(tenantId, role);
  }

  async removeRecipient(tenantId: string, role: string, recipientId: string) {
    this.assertAdminRole(role);
    await this.requireRecipient(tenantId, recipientId);
    const deliveries = await this.prisma.adminAlertDelivery.count({
      where: { recipientId },
    });
    if (deliveries > 0) {
      await this.prisma.adminAlertRecipient.update({
        where: { id: recipientId },
        data: { enabled: false },
      });
    } else {
      await this.prisma.adminAlertRecipient.delete({
        where: { id: recipientId },
      });
    }
    return this.getConfig(tenantId, role);
  }

  async sendTestMessage(tenantId: string, role: string) {
    this.assertAdminRole(role);
    const config = await this.requireSendConfig(tenantId);
    return this.sendManualMessage(
      tenantId,
      config,
      '✅ Teste de alertas LIA\n\nSeu WhatsApp administrativo está configurado corretamente.',
    );
  }

  async sendSimulation(tenantId: string, role: string) {
    this.assertAdminRole(role);
    const config = await this.requireSendConfig(tenantId);
    return this.sendManualMessage(
      tenantId,
      config,
      buildSimulatedNewShopeeSaleMessage(),
    );
  }

  private async sendManualMessage(tenantId: string, config: any, text: string) {
    const lastSentAt = this.testSentAt.get(tenantId) || 0;
    if (Date.now() - lastSentAt < TEST_COOLDOWN_MS)
      throw new BadRequestException(
        'Aguarde um minuto antes de enviar outro teste.',
      );
    if (this.testInFlight.has(tenantId))
      throw new ConflictException('Já existe um teste de alerta em andamento.');
    const sender = await this.findUsableSender(
      tenantId,
      config.adminWhatsappIntegrationId,
    );
    if (!sender)
      throw new BadRequestException(
        'Selecione uma integração WhatsApp/Evolution conectada antes de enviar um teste.',
      );
    const recipients = (
      await this.getRecipientRecords(tenantId, config)
    ).filter((recipient) => recipient.enabled);
    if (!recipients.length)
      throw new BadRequestException(
        'Cadastre um destinatário autorizado antes de enviar um teste.',
      );

    this.testInFlight.add(tenantId);
    try {
      const token = decryptSecret(
        sender.encryptedAccessToken!,
        sender.tokenIv!,
        sender.tokenAuthTag!,
        getEncryptionKey(),
      );
      const results = await Promise.all(
        recipients.map(async (recipient) => {
          try {
            const destination = decryptSecret(
              recipient.encryptedRecipient,
              recipient.recipientIv,
              recipient.recipientAuthTag,
              getEncryptionKey(),
            );
            const messageId =
              await new WhatsAppEvolutionProvider().sendPrivateMessage(
                sender.externalInstanceName!,
                token,
                destination,
                text,
              );
            return { sent: Boolean(messageId), messageId };
          } catch {
            return { sent: false, messageId: null };
          }
        }),
      );
      const sent = results.filter((result) => result.sent).length;
      const failed = results.length - sent;
      if (sent > 0) this.testSentAt.set(tenantId, Date.now());
      return {
        success: sent > 0,
        status: failed === 0 ? 'SENT' : sent > 0 ? 'PARTIAL' : 'FAILED',
        sent,
        failed,
      };
    } finally {
      this.testInFlight.delete(tenantId);
    }
  }

  private async requireSendConfig(tenantId: string) {
    const config = await this.prisma.adminAlertConfig.findUnique({
      where: { tenantId },
    });
    if (!config?.enabled)
      throw new BadRequestException(
        'Ative os alertas antes de enviar um teste.',
      );
    if (!config.adminWhatsappIntegrationId)
      throw new BadRequestException(
        'Selecione uma integração WhatsApp/Evolution conectada antes de enviar um teste.',
      );
    return config;
  }

  private assertAdminRole(role: string): asserts role is AdminRole {
    if (role !== 'OWNER' && role !== 'ADMIN')
      throw new ForbiddenException(
        'Somente OWNER ou ADMIN pode alterar os alertas administrativos.',
      );
  }

  private normalizeRecipient(value: string): string {
    const digits = value.trim().replace(/\D/g, '');
    if (!/^\d{10,11}$/.test(digits) && !/^55\d{10,11}$/.test(digits))
      throw new BadRequestException(
        'Informe um telefone brasileiro válido com DDD.',
      );
    return digits.startsWith('55') ? digits : `55${digits}`;
  }

  private async toView(tenantId: string, config: any) {
    await this.ensureLegacyRecipient(tenantId, config);
    const records = config
      ? await this.getRecipientRecords(tenantId, config)
      : [];
    const recipients = records.map((record) => ({
      id: record.id,
      enabled: record.enabled,
      masked: this.maskRecipient(
        decryptSecret(
          record.encryptedRecipient,
          record.recipientIv,
          record.recipientAuthTag,
          getEncryptionKey(),
        ),
      ),
    }));
    const senderIntegrations = await this.getSafeSenderIntegrations(tenantId);
    const selectedSender = senderIntegrations.find(
      (integration) => integration.id === config?.adminWhatsappIntegrationId,
    );
    return {
      enabled: config?.enabled ?? DEFAULTS.enabled,
      hasRecipient: recipients.length > 0,
      recipientMasked: recipients[0]?.masked ?? null,
      recipients,
      maxRecipients: MAX_RECIPIENTS,
      adminWhatsappIntegrationId: config?.adminWhatsappIntegrationId ?? null,
      senderIntegrationName: selectedSender?.name ?? null,
      senderIntegrations,
      ...Object.fromEntries(
        TOGGLE_FIELDS.map((field) => [
          field,
          config?.[field] ?? DEFAULTS[field],
        ]),
      ),
      enabledAt: config?.enabledAt ?? null,
    };
  }

  private async hasAnyRecipient(_tenantId: string, config: any) {
    if (
      config?.encryptedRecipient &&
      config.recipientIv &&
      config.recipientAuthTag
    )
      return true;
    return this.hasStoredRecipientRows(config?.id);
  }

  private async hasStoredRecipientRows(configId?: string) {
    if (!configId || !this.prisma.adminAlertRecipient?.count) return false;
    return (
      (await this.prisma.adminAlertRecipient.count({ where: { configId } })) > 0
    );
  }

  private async getRecipientRecords(
    tenantId: string,
    config: any,
  ): Promise<RecipientRecord[]> {
    const rows: RecipientRecord[] =
      config?.id && this.prisma.adminAlertRecipient?.findMany
        ? await this.prisma.adminAlertRecipient.findMany({
            where: { tenantId, configId: config.id },
            select: {
              id: true,
              encryptedRecipient: true,
              recipientIv: true,
              recipientAuthTag: true,
              enabled: true,
            },
            orderBy: { createdAt: 'asc' },
          })
        : [];
    if (
      rows.length ||
      !config?.encryptedRecipient ||
      !config.recipientIv ||
      !config.recipientAuthTag
    )
      return rows;
    return [
      {
        id: `legacy:${config.id || tenantId}`,
        encryptedRecipient: config.encryptedRecipient,
        recipientIv: config.recipientIv,
        recipientAuthTag: config.recipientAuthTag,
        enabled: true,
      },
    ];
  }

  private async ensureLegacyRecipient(tenantId: string, config: any) {
    if (
      !config?.id ||
      !config.encryptedRecipient ||
      !config.recipientIv ||
      !config.recipientAuthTag ||
      !this.prisma.adminAlertRecipient?.upsert
    )
      return;
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
    await this.prisma.adminAlertRecipient.upsert({
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

  private async requireRecipient(tenantId: string, recipientId: string) {
    const recipient = await this.prisma.adminAlertRecipient.findFirst({
      where: { id: recipientId, tenantId },
    });
    if (!recipient)
      throw new BadRequestException('Destinatário não encontrado.');
    return recipient;
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
