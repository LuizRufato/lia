import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ConfigService } from '@nestjs/config';
import {
  encryptSecret,
  decryptSecret,
  WhatsAppCloudProvider,
  WhatsAppEvolutionProvider,
  ShopeeAffiliateClient,
  getEncryptionKey,
  getShopeeConversionWindow,
} from '@lia/integrations';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @InjectQueue('shopee-api-queue') private readonly shopeeQueue: Queue,
    @InjectQueue('shopee-conversions-queue')
    private readonly shopeeConversionsQueue: Queue,
  ) {}

  async getShopeeIntegration(tenantId: string) {
    const integration = await this.prisma.marketplaceIntegration.findUnique({
      where: {
        tenantId_provider: {
          tenantId,
          provider: 'SHOPEE',
        },
      },
    });

    if (!integration) {
      return { status: 'NOT_CONNECTED' };
    }

    return {
      status: integration.status,
      appId: integration.publicIdentifier,
      lastSyncAt: integration.lastSyncAt,
      lastSyncProcessedCount: integration.lastSyncProcessedCount,
      lastError: integration.lastError,
      lastConversionSyncAt: integration.lastConversionSyncAt,
      lastConversionError: integration.lastConversionError,
      // Never return the actual encrypted/decrypted secret to frontend
    };
  }

  async connectShopee(tenantId: string, appId: string, appSecret: string) {
    const normalizedAppId = appId?.trim();
    const normalizedSecret = appSecret?.trim();
    if (!normalizedAppId || !normalizedSecret) {
      throw new BadRequestException('App ID e App Secret são obrigatórios.');
    }

    const existing = await this.prisma.marketplaceIntegration.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'SHOPEE' } },
    });

    // The submitted credentials are tested before they can become CONNECTED.
    // This prevents a typo from silently replacing a known-good integration.
    try {
      await this.verifyShopeeCredentials(normalizedAppId, normalizedSecret);
    } catch (error: any) {
      const message = this.sanitizeShopeeError(error);
      const preserveKnownGood = Boolean(
        existing?.status === 'CONNECTED' &&
        existing.publicIdentifier &&
        existing.encryptedSecret &&
        existing.iv &&
        existing.authTag,
      );

      if (preserveKnownGood) {
        await this.prisma.marketplaceIntegration.update({
          where: { id: existing!.id },
          data: { lastError: message },
        });
      } else {
        const masterKey = getEncryptionKey();
        const { encryptedSecret, iv, authTag } = encryptSecret(
          normalizedSecret,
          masterKey,
        );
        await this.prisma.marketplaceIntegration.upsert({
          where: {
            tenantId_provider: { tenantId, provider: 'SHOPEE' },
          },
          update: {
            publicIdentifier: normalizedAppId,
            encryptedSecret,
            iv,
            authTag,
            status: 'ERROR',
            lastError: message,
          },
          create: {
            tenantId,
            provider: 'SHOPEE',
            publicIdentifier: normalizedAppId,
            encryptedSecret,
            iv,
            authTag,
            status: 'ERROR',
            lastError: message,
          },
        });
      }

      throw new BadRequestException(message);
    }

    const masterKey = getEncryptionKey();
    const { encryptedSecret, iv, authTag } = encryptSecret(
      normalizedSecret,
      masterKey,
    );

    await this.prisma.marketplaceIntegration.upsert({
      where: { tenantId_provider: { tenantId, provider: 'SHOPEE' } },
      update: {
        publicIdentifier: normalizedAppId,
        encryptedSecret,
        iv,
        authTag,
        status: 'CONNECTED',
        lastError: null,
      },
      create: {
        tenantId,
        provider: 'SHOPEE',
        publicIdentifier: normalizedAppId,
        encryptedSecret,
        iv,
        authTag,
        status: 'CONNECTED',
      },
    });

    return { success: true, status: 'CONNECTED', tested: true };
  }

  async disconnectShopee(tenantId: string) {
    await this.prisma.marketplaceIntegration.delete({
      where: {
        tenantId_provider: {
          tenantId,
          provider: 'SHOPEE',
        },
      },
    });
    return { success: true };
  }

  async syncShopeeNow(tenantId: string) {
    const integration = await this.prisma.marketplaceIntegration.findUnique({
      where: {
        tenantId_provider: { tenantId, provider: 'SHOPEE' },
      },
    });

    if (!integration || integration.status !== 'CONNECTED') {
      throw new BadRequestException('Shopee is not connected.');
    }

    const syncBucket = Math.floor(Date.now() / (15 * 60 * 1000));
    await this.shopeeQueue.add(
      'sync-shopee',
      { tenantId, syncRunId: `manual-${syncBucket}` },
      {
        jobId: `shopee-sync-${tenantId}-${syncBucket}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 24 * 60 * 60 },
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );

    return { success: true };
  }

  async syncShopeeConversions(tenantId: string, days: number = 7) {
    const integration = await this.prisma.marketplaceIntegration.findUnique({
      where: {
        tenantId_provider: { tenantId, provider: 'SHOPEE' },
      },
    });

    if (!integration || integration.status !== 'CONNECTED') {
      throw new BadRequestException('Shopee is not connected.');
    }

    const end = Math.floor(Date.now() / 1000);
    const safeDays = Math.min(Math.max(Math.floor(days), 1), 30);
    const window = getShopeeConversionWindow(
      integration.lastConversionSyncAt,
      end,
      safeDays * 24 * 60 * 60,
    );
    const syncBucket = Math.floor(end / (5 * 60));

    await this.shopeeConversionsQueue.add(
      'sync',
      {
        tenantId,
        ...window,
        syncRunId: `manual-${end}`,
      },
      {
        jobId: `shopee-conv-sync-${tenantId}-${syncBucket}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 20000 },
        removeOnComplete: { age: 24 * 60 * 60 },
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );

    return { success: true };
  }

  async testShopeeConnection(tenantId: string) {
    const integration = await this.prisma.marketplaceIntegration.findUnique({
      where: {
        tenantId_provider: { tenantId, provider: 'SHOPEE' },
      },
    });

    if (
      !integration ||
      !integration.encryptedSecret ||
      !integration.iv ||
      !integration.authTag ||
      !integration.publicIdentifier
    ) {
      throw new BadRequestException('Shopee is not fully configured.');
    }

    const masterKey = getEncryptionKey();

    let appSecret: string;
    try {
      appSecret = decryptSecret(
        integration.encryptedSecret,
        integration.iv,
        integration.authTag,
        masterKey,
      );
    } catch (e) {
      throw new BadRequestException('Failed to decrypt Shopee credentials.');
    }

    const client = new ShopeeAffiliateClient(
      integration.publicIdentifier,
      appSecret,
    );

    try {
      await client.getProductOfferV2(1, 1);

      // Mark as connected in DB (update timestamp)
      await this.prisma.marketplaceIntegration.update({
        where: { id: integration.id },
        data: { status: 'CONNECTED', lastError: null },
      });

      return { success: true };
    } catch (error: any) {
      const message = this.sanitizeShopeeError(error);
      await this.prisma.marketplaceIntegration.update({
        where: { id: integration.id },
        data: {
          status: 'ERROR',
          lastError: message,
        },
      });
      throw new BadRequestException(message);
    }
  }

  // --- WHATSAPP CLOUD API ---

  async getWhatsAppIntegration(tenantId: string) {
    const integration = await this.prisma.channelIntegration.findUnique({
      where: {
        tenantId_provider: { tenantId, provider: 'WHATSAPP' },
      },
    });

    if (!integration) {
      return { status: 'NOT_CONNECTED' };
    }

    // Reconcile every Evolution state read; CONNECTED in Postgres is not
    // considered authoritative after a provider restart or logout.
    if (
      integration.transport === 'WEB_UNOFFICIAL' &&
      integration.externalInstanceName &&
      integration.encryptedAccessToken &&
      integration.tokenIv &&
      integration.tokenAuthTag
    ) {
      try {
        const provider = new WhatsAppEvolutionProvider();
        const masterKey = getEncryptionKey();
        const instanceToken = decryptSecret(
          integration.encryptedAccessToken!,
          integration.tokenIv!,
          integration.tokenAuthTag!,
          masterKey,
        );
        const state = await provider.getConnectionState(
          integration.externalInstanceName,
          instanceToken,
        );
        if (state === 'open') {
          const updated = await this.prisma.channelIntegration.update({
            where: { id: integration.id },
            data: {
              status: 'CONNECTED',
              connectedAt: new Date(),
            },
          });
          integration.status = updated.status;
          integration.connectedAt = updated.connectedAt;
        } else if (state === 'close' || state === 'DISCONNECTED') {
          const updated = await this.prisma.channelIntegration.update({
            where: { id: integration.id },
            data: {
              status: 'NEEDS_REAUTH',
              lastErrorCode: 'EVOLUTION_DISCONNECTED',
            },
          });
          integration.status = updated.status;
          integration.lastErrorCode = updated.lastErrorCode;
        } else if (state === 'UNAUTHORIZED') {
          const updated = await this.prisma.channelIntegration.update({
            where: { id: integration.id },
            data: {
              status: 'NEEDS_REAUTH',
              lastErrorCode: 'EVOLUTION_UNAUTHORIZED',
            },
          });
          integration.status = updated.status;
          integration.lastErrorCode = updated.lastErrorCode;
        }
      } catch (e) {
        console.error('Error reconciling Evolution API status:', e);
        await this.prisma.channelIntegration.update({
          where: { id: integration.id },
          data: {
            status: 'ERROR',
            lastErrorCode: 'EVOLUTION_HEALTH_CHECK_FAILED',
          },
        });
        integration.status = 'ERROR';
        integration.lastErrorCode = 'EVOLUTION_HEALTH_CHECK_FAILED';
      }
    }

    return {
      status: integration.status,
      transport: integration.transport,
      wabaId: integration.wabaId,
      phoneNumberId: integration.phoneNumberId,
      lastError: integration.lastErrorCode,
      connectedAt: integration.connectedAt,
    };
  }

  async connectWhatsApp(
    tenantId: string,
    wabaId: string,
    phoneNumberId: string,
    accessToken: string,
  ) {
    const masterKey = getEncryptionKey();

    const existing = await this.prisma.channelIntegration.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'WHATSAPP' } },
    });
    if (existing?.transport === 'WEB_UNOFFICIAL') {
      if (
        !existing.externalInstanceName ||
        !existing.encryptedAccessToken ||
        !existing.tokenIv ||
        !existing.tokenAuthTag
      ) {
        throw new BadRequestException(
          'A sessão Evolution existente precisa ser reautenticada antes de trocar o transporte.',
        );
      }
      const oldToken = decryptSecret(
        existing.encryptedAccessToken,
        existing.tokenIv,
        existing.tokenAuthTag,
        masterKey,
      );
      const removed = await new WhatsAppEvolutionProvider().disconnectInstance(
        existing.externalInstanceName,
        oldToken,
      );
      if (!removed) {
        throw new BadRequestException(
          'A sessão Evolution ativa precisa ser invalidada antes de ativar Cloud.',
        );
      }
    }

    const { encryptedSecret, iv, authTag } = encryptSecret(
      accessToken,
      masterKey,
    );

    await this.prisma.channelIntegration.upsert({
      where: {
        tenantId_provider: { tenantId, provider: 'WHATSAPP' },
      },
      update: {
        transport: 'CLOUD_OFFICIAL',
        wabaId,
        phoneNumberId,
        encryptedAccessToken: encryptedSecret,
        tokenIv: iv,
        tokenAuthTag: authTag,
        status: 'CONNECTED',
        connectedAt: new Date(),
        lastErrorAt: null,
        lastErrorCode: null,
      },
      create: {
        tenantId,
        provider: 'WHATSAPP',
        wabaId,
        phoneNumberId,
        encryptedAccessToken: encryptedSecret,
        tokenIv: iv,
        tokenAuthTag: authTag,
        status: 'CONNECTED',
        connectedAt: new Date(),
      },
    });

    return { success: true };
  }

  async disconnectWhatsApp(tenantId: string) {
    const integration = await this.prisma.channelIntegration.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'WHATSAPP' } },
    });
    if (!integration) return { success: true };

    if (integration.transport === 'WEB_UNOFFICIAL') {
      if (
        !integration.externalInstanceName ||
        !integration.encryptedAccessToken ||
        !integration.tokenIv ||
        !integration.tokenAuthTag
      ) {
        throw new BadRequestException(
          'Evolution session credentials are incomplete; remote logout was not confirmed.',
        );
      }
      const token = decryptSecret(
        integration.encryptedAccessToken,
        integration.tokenIv,
        integration.tokenAuthTag,
        getEncryptionKey(),
      );
      const remoteDisconnected =
        await new WhatsAppEvolutionProvider().disconnectInstance(
          integration.externalInstanceName,
          token,
        );
      if (!remoteDisconnected) {
        throw new BadRequestException(
          'Evolution remote session could not be invalidated.',
        );
      }
    }

    await this.prisma.channelIntegration.delete({
      where: {
        tenantId_provider: { tenantId, provider: 'WHATSAPP' },
      },
    });
    return { success: true };
  }

  async testWhatsAppConnection(tenantId: string) {
    const integration = await this.prisma.channelIntegration.findUnique({
      where: {
        tenantId_provider: { tenantId, provider: 'WHATSAPP' },
      },
    });

    if (!integration || integration.status !== 'CONNECTED') {
      throw new BadRequestException('WhatsApp is not connected.');
    }

    const masterKey = getEncryptionKey();

    // Set environment variable temporary if needed by provider, but it's better to pass it.
    // In our WhatsAppCloudProvider we read process.env.INTEGRATION_SECRET_KEY,
    // let's ensure it's set or we modify it to read from config.
    // For now we'll just set it on process.env dynamically if not present.
    if (!process.env.INTEGRATION_SECRET_KEY) {
      process.env.INTEGRATION_SECRET_KEY = masterKey;
    }

    const provider = new WhatsAppCloudProvider();
    const success = await provider.testConnection({
      wabaId: integration.wabaId!,
      phoneNumberId: integration.phoneNumberId!,
      encryptedAccessToken: integration.encryptedAccessToken!,
      tokenIv: integration.tokenIv!,
      tokenAuthTag: integration.tokenAuthTag!,
    });

    if (!success) {
      await this.prisma.channelIntegration.update({
        where: { id: integration.id },
        data: {
          status: 'ERROR',
          lastErrorAt: new Date(),
          lastErrorCode: 'TEST_CONNECTION_FAILED',
        },
      });
      return {
        success: false,
        message: 'Invalid credentials or network error.',
      };
    }

    await this.prisma.channelIntegration.update({
      where: { id: integration.id },
      data: {
        status: 'CONNECTED',
        lastHealthCheckAt: new Date(),
        lastErrorCode: null,
      },
    });

    return { success: true };
  }

  // --- WHATSAPP EVOLUTION API (WEB UNOFFICIAL) ---

  async connectWhatsAppEvolution(tenantId: string, phoneNumber?: string) {
    const provider = new WhatsAppEvolutionProvider();
    const existing = await this.prisma.channelIntegration.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'WHATSAPP' } },
    });
    const externalInstanceName =
      existing?.externalInstanceName || `lia-${tenantId.substring(0, 8)}`;
    let knownToken: string | undefined;
    if (
      existing?.encryptedAccessToken &&
      existing.tokenIv &&
      existing.tokenAuthTag
    ) {
      knownToken = decryptSecret(
        existing.encryptedAccessToken,
        existing.tokenIv,
        existing.tokenAuthTag,
        getEncryptionKey(),
      );
    }

    // Reuse a healthy/connecting instance. A stale instance is invalidated by
    // the provider before a replacement is created, avoiding orphan sessions.
    const response = await provider.connectInstance(
      externalInstanceName,
      phoneNumber,
      knownToken,
    );

    const masterKey = getEncryptionKey();
    const instanceToken = response.externalInstanceToken || knownToken;
    if (!instanceToken) {
      throw new BadRequestException(
        'Evolution retornou uma instância existente sem token recuperável; reautenticação necessária.',
      );
    }
    const { encryptedSecret, iv, authTag } = encryptSecret(
      instanceToken,
      masterKey,
    );

    await this.prisma.channelIntegration.upsert({
      where: {
        tenantId_provider: { tenantId, provider: 'WHATSAPP' },
      },
      update: {
        transport: 'WEB_UNOFFICIAL',
        externalInstanceName: response.instanceName,
        encryptedAccessToken: encryptedSecret,
        tokenIv: iv,
        tokenAuthTag: authTag,
        status: response.state === 'open' ? 'CONNECTED' : 'CONNECTING',
        connectedAt: response.state === 'open' ? new Date() : null,
      },
      create: {
        tenantId,
        provider: 'WHATSAPP',
        transport: 'WEB_UNOFFICIAL',
        externalInstanceName: response.instanceName,
        encryptedAccessToken: encryptedSecret,
        tokenIv: iv,
        tokenAuthTag: authTag,
        status: response.state === 'open' ? 'CONNECTED' : 'CONNECTING',
      },
    });

    return {
      success: true,
      qrcodeBase64: response.qrcodeBase64,
      pairingCode: response.pairingCode,
      reused: response.reused,
      state: response.state,
    };
  }

  async getWhatsAppEvolutionGroups(tenantId: string) {
    const integration = await this.prisma.channelIntegration.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'WHATSAPP' } },
    });

    if (
      !integration ||
      integration.transport !== 'WEB_UNOFFICIAL' ||
      !integration.externalInstanceName
    ) {
      throw new BadRequestException('Evolution API integration not found.');
    }

    const provider = new WhatsAppEvolutionProvider();

    // Retrieve connection state before groups
    const masterKey = getEncryptionKey();

    let instanceToken: string;
    try {
      instanceToken = decryptSecret(
        integration.encryptedAccessToken!,
        integration.tokenIv!,
        integration.tokenAuthTag!,
        masterKey,
      );
    } catch {
      await this.markEvolutionGroupsError(
        integration.id,
        'EVOLUTION_CREDENTIALS_INVALID',
      );
      throw new BadRequestException(
        'As credenciais da Evolution estão inválidas ou indisponíveis.',
      );
    }

    let state: Awaited<
      ReturnType<WhatsAppEvolutionProvider['getConnectionState']>
    >;
    try {
      state = await provider.getConnectionState(
        integration.externalInstanceName,
        instanceToken,
      );
    } catch {
      await this.markEvolutionGroupsError(
        integration.id,
        'EVOLUTION_UNAVAILABLE',
      );
      throw new BadRequestException('Falha ao consultar a Evolution.');
    }

    if (state !== 'open') {
      await this.prisma.channelIntegration.update({
        where: { id: integration.id },
        data: {
          status:
            state === 'UNAUTHORIZED' ||
            state === 'DISCONNECTED' ||
            state === 'close'
              ? 'NEEDS_REAUTH'
              : 'CONNECTING',
          lastErrorCode:
            state === 'UNAUTHORIZED' ? 'EVOLUTION_UNAUTHORIZED' : null,
        },
      });
      throw new BadRequestException(
        `Evolution API is not connected. State: ${state}`,
      );
    }

    // Mark as connected if not already
    if (integration.status !== 'CONNECTED') {
      await this.prisma.channelIntegration.update({
        where: { id: integration.id },
        data: { status: 'CONNECTED', connectedAt: new Date() },
      });
    }

    let groups;
    try {
      groups = await provider.fetchGroups(
        integration.externalInstanceName,
        instanceToken,
      );
    } catch {
      await this.markEvolutionGroupsError(
        integration.id,
        'EVOLUTION_GROUPS_FETCH_FAILED',
      );
      throw new BadRequestException('Falha ao consultar grupos na Evolution.');
    }

    // Upsert channels as DISABLED by default if not exists
    const results = [];
    for (const group of groups) {
      const channel = await this.prisma.channel.upsert({
        where: {
          tenantId_provider_externalChatId: {
            tenantId,
            provider: 'WHATSAPP',
            externalChatId: group.id,
          },
        },
        update: {
          displayName: group.subject,
          lastSeenAt: new Date(),
          staleAt: null,
        },
        create: {
          tenantId,
          provider: 'WHATSAPP',
          externalChatId: group.id,
          displayName: group.subject,
          enabled: false, // Explicit opt-in required
          lastSeenAt: new Date(),
        },
      });
      results.push({ ...channel, participants: group.participants });
    }

    // Groups no longer returned by Evolution are stale and disabled. Existing
    // enabled groups remain enabled only while they continue to be observed.
    await this.prisma.channel.updateMany({
      where: {
        tenantId,
        provider: 'WHATSAPP',
        ...(groups.length
          ? { externalChatId: { notIn: groups.map((group) => group.id) } }
          : {}),
      },
      data: { enabled: false, staleAt: new Date() },
    });

    return { success: true, groups: results };
  }

  private async markEvolutionGroupsError(
    integrationId: string,
    errorCode: string,
  ) {
    try {
      await this.prisma.channelIntegration.update({
        where: { id: integrationId },
        data: {
          status: 'ERROR',
          lastErrorAt: new Date(),
          lastErrorCode: errorCode,
        },
      });
    } catch {
      // Keep the safe client-facing error even if recording diagnostics fails.
    }
  }

  async getWhatsAppSafety(tenantId: string) {
    return this.prisma.whatsAppSafetyConfig.findUnique({
      where: { tenantId },
      select: {
        enabled: true,
        killSwitch: true,
        minIntervalSeconds: true,
        maxPerHour: true,
        maxPerDay: true,
        quietStartMinute: true,
        quietEndMinute: true,
        reconnectionCooldownSeconds: true,
        minQualityScore: true,
        maxObservationAgeMinutes: true,
        circuitState: true,
        consecutiveErrors: true,
        circuitOpenedAt: true,
      },
    });
  }

  async updateWhatsAppSafety(tenantId: string, body: Record<string, unknown>) {
    const intValue = (
      value: unknown,
      fallback: number,
      min: number,
      max: number,
    ) => {
      const parsed = Number(value);
      return Number.isFinite(parsed)
        ? Math.min(max, Math.max(min, Math.round(parsed)))
        : fallback;
    };
    const floatValue = (
      value: unknown,
      fallback: number,
      min: number,
      max: number,
    ) => {
      const parsed = Number(value);
      return Number.isFinite(parsed)
        ? Math.min(max, Math.max(min, parsed))
        : fallback;
    };
    return this.prisma.whatsAppSafetyConfig.upsert({
      where: { tenantId },
      update: {
        ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
        ...(typeof body.killSwitch === 'boolean'
          ? { killSwitch: body.killSwitch }
          : {}),
        minIntervalSeconds: intValue(body.minIntervalSeconds, 60, 1, 86_400),
        maxPerHour: intValue(body.maxPerHour, 20, 1, 1_000),
        maxPerDay: intValue(body.maxPerDay, 100, 1, 10_000),
        reconnectionCooldownSeconds: intValue(
          body.reconnectionCooldownSeconds,
          90,
          0,
          86_400,
        ),
        minQualityScore: floatValue(body.minQualityScore, 0, 0, 1),
        maxObservationAgeMinutes: intValue(
          body.maxObservationAgeMinutes,
          1440,
          1,
          30 * 24 * 60,
        ),
        quietStartMinute:
          body.quietStartMinute == null
            ? null
            : intValue(body.quietStartMinute, 0, 0, 1439),
        quietEndMinute:
          body.quietEndMinute == null
            ? null
            : intValue(body.quietEndMinute, 1439, 0, 1439),
      },
      create: {
        tenantId,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
        killSwitch:
          typeof body.killSwitch === 'boolean' ? body.killSwitch : false,
        minIntervalSeconds: intValue(body.minIntervalSeconds, 60, 1, 86_400),
        maxPerHour: intValue(body.maxPerHour, 20, 1, 1_000),
        maxPerDay: intValue(body.maxPerDay, 100, 1, 10_000),
        reconnectionCooldownSeconds: intValue(
          body.reconnectionCooldownSeconds,
          90,
          0,
          86_400,
        ),
        minQualityScore: floatValue(body.minQualityScore, 0, 0, 1),
        maxObservationAgeMinutes: intValue(
          body.maxObservationAgeMinutes,
          1440,
          1,
          30 * 24 * 60,
        ),
        quietStartMinute:
          body.quietStartMinute == null
            ? null
            : intValue(body.quietStartMinute, 0, 0, 1439),
        quietEndMinute:
          body.quietEndMinute == null
            ? null
            : intValue(body.quietEndMinute, 1439, 0, 1439),
      },
      select: {
        enabled: true,
        killSwitch: true,
        minIntervalSeconds: true,
        maxPerHour: true,
        maxPerDay: true,
        quietStartMinute: true,
        quietEndMinute: true,
        reconnectionCooldownSeconds: true,
        minQualityScore: true,
        maxObservationAgeMinutes: true,
        circuitState: true,
        consecutiveErrors: true,
        circuitOpenedAt: true,
      },
    });
  }

  private async verifyShopeeCredentials(appId: string, appSecret: string) {
    const client = new ShopeeAffiliateClient(appId, appSecret);
    await client.getProductOfferV2(1, 1);
  }

  private sanitizeShopeeError(error: any): string {
    const raw = String(
      error?.message || 'Falha ao validar credenciais Shopee.',
    );
    return raw
      .replace(
        /(secret|token|authorization|credential)\s*[=:]\s*[^\s,;]+/gi,
        '$1=[redacted]',
      )
      .slice(0, 240);
  }

  async sendWhatsAppEvolutionTestMessage(tenantId: string, channelId?: string) {
    if (!channelId) {
      throw new BadRequestException('A WhatsApp channel must be selected.');
    }

    // The target must belong to the signed-in tenant and be explicitly enabled.
    // No free-form recipient or message is accepted by this endpoint.
    const channel = await this.prisma.channel.findFirst({
      where: {
        id: channelId,
        tenantId,
        provider: 'WHATSAPP',
        enabled: true,
      },
    });

    if (!channel) {
      throw new BadRequestException(
        'Enabled WhatsApp channel not found for this tenant.',
      );
    }

    const integration = await this.prisma.channelIntegration.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'WHATSAPP' } },
    });

    if (
      !integration ||
      integration.status !== 'CONNECTED' ||
      integration.transport !== 'WEB_UNOFFICIAL' ||
      !integration.externalInstanceName ||
      !integration.encryptedAccessToken ||
      !integration.tokenIv ||
      !integration.tokenAuthTag
    ) {
      throw new BadRequestException(
        'WhatsApp Web/Evolution is not connected for this tenant.',
      );
    }

    const instanceToken = decryptSecret(
      integration.encryptedAccessToken,
      integration.tokenIv,
      integration.tokenAuthTag,
      getEncryptionKey(),
    );

    const messageId = await new WhatsAppEvolutionProvider().sendGroupMessage(
      integration.externalInstanceName,
      instanceToken,
      channel.externalChatId,
      '✅ *Teste da LIA*\n\nConexão com o WhatsApp confirmada. Nenhuma oferta ou link foi publicado.',
    );

    if (!messageId) {
      return {
        success: false,
        status: 'DELIVERY_UNKNOWN',
        channel: channel.displayName,
      };
    }

    return {
      success: true,
      channel: channel.displayName,
      messageId,
    };
  }
}
