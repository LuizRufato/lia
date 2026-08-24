import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  decryptSecret,
  encryptSecret,
  getEncryptionKey,
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
  constructor(private readonly prisma: PrismaService) {}

  async getConfig(tenantId: string, role: string) {
    this.assertAdminRole(role);

    const config = await this.prisma.adminAlertConfig.findUnique({
      where: { tenantId },
    });

    return this.toView(config);
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
        enabledAt,
        ...toggleData,
      },
      update: {
        enabled,
        encryptedRecipient,
        recipientIv,
        recipientAuthTag,
        enabledAt,
        ...toggleData,
      },
    });

    return this.toView(saved);
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

  private toView(config: any) {
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

    return {
      enabled: config?.enabled ?? DEFAULTS.enabled,
      hasRecipient,
      recipientMasked,
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
}
