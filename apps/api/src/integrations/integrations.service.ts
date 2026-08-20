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
      lastError: integration.lastError,
      // Never return the actual encrypted/decrypted secret to frontend
    };
  }

  async connectShopee(tenantId: string, appId: string, appSecret: string) {
    const masterKey = getEncryptionKey();

    const { encryptedSecret, iv, authTag } = encryptSecret(
      appSecret,
      masterKey,
    );

    await this.prisma.marketplaceIntegration.upsert({
      where: {
        tenantId_provider: {
          tenantId,
          provider: 'SHOPEE',
        },
      },
      update: {
        publicIdentifier: appId,
        encryptedSecret,
        iv,
        authTag,
        status: 'CONNECTED',
        lastError: null,
      },
      create: {
        tenantId,
        provider: 'SHOPEE',
        publicIdentifier: appId,
        encryptedSecret,
        iv,
        authTag,
        status: 'CONNECTED',
      },
    });

    return { success: true };
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

    // Add to BullMQ for the worker to process
    await this.shopeeQueue.add(
      'sync-shopee',
      { tenantId },
      {
        jobId: `shopee-sync-${tenantId}-${Date.now()}`, // Prevents immediate duplicates if run repeatedly
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
    const start = end - days * 24 * 60 * 60;

    await this.shopeeConversionsQueue.add(
      'sync',
      {
        tenantId,
        purchaseTimeStart: start,
        purchaseTimeEnd: end,
      },
      {
        jobId: `shopee-conv-sync-${tenantId}-${Date.now()}`,
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
      integration.status !== 'CONNECTED' ||
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
      const result = await client.getProductOfferV2(1, 1);

      // Mark as connected in DB (update timestamp)
      await this.prisma.marketplaceIntegration.update({
        where: { id: integration.id },
        data: { status: 'CONNECTED', lastError: null, lastSyncAt: new Date() },
      });

      return { success: true };
    } catch (error: any) {
      await this.prisma.marketplaceIntegration.update({
        where: { id: integration.id },
        data: {
          status: 'ERROR',
          lastError: error.message || 'Connection failed',
        },
      });
      throw new BadRequestException(
        error.message || 'Shopee connection test failed.',
      );
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

    // --- RECONCILIAÇÃO EVOLUTION API ---
    if (
      integration.transport === 'WEB_UNOFFICIAL' &&
      integration.status === 'CONNECTING' &&
      integration.externalInstanceName
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
          // Atualiza banco para CONNECTED
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
          // Mantém CONNECTING se ainda estiver tentando, ou limpa
          // Por precaução vamos apenas retornar o state
        }
      } catch (e) {
        console.error('Error reconciling Evolution API status:', e);
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

    const { encryptedSecret, iv, authTag } = encryptSecret(
      accessToken,
      masterKey,
    );

    await this.prisma.channelIntegration.upsert({
      where: {
        tenantId_provider: { tenantId, provider: 'WHATSAPP' },
      },
      update: {
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

  async connectWhatsAppEvolution(tenantId: string) {
    const provider = new WhatsAppEvolutionProvider();

    // Generate a unique instance name for this tenant
    const externalInstanceName = `lia-${tenantId.substring(0, 8)}-${Date.now()}`;

    // Create/Fetch in Evolution API
    const response = await provider.connectInstance(externalInstanceName);

    const masterKey = getEncryptionKey();
    const { encryptedSecret, iv, authTag } = encryptSecret(
      response.externalInstanceToken,
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
        status: 'CONNECTING',
        connectedAt: null,
      },
      create: {
        tenantId,
        provider: 'WHATSAPP',
        transport: 'WEB_UNOFFICIAL',
        externalInstanceName: response.instanceName,
        encryptedAccessToken: encryptedSecret,
        tokenIv: iv,
        tokenAuthTag: authTag,
        status: 'CONNECTING',
      },
    });

    return {
      success: true,
      qrcodeBase64: response.qrcodeBase64,
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

    if (state !== 'open') {
      await this.prisma.channelIntegration.update({
        where: { id: integration.id },
        data: { status: 'NOT_CONNECTED' },
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

    const groups = await provider.fetchGroups(
      integration.externalInstanceName,
      instanceToken,
    );

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
        },
        create: {
          tenantId,
          provider: 'WHATSAPP',
          externalChatId: group.id,
          displayName: group.subject,
          enabled: false, // Explicit opt-in required
        },
      });
      results.push({ ...channel, participants: group.participants });
    }

    return { success: true, groups: results };
  }
}
