import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ConfigService } from '@nestjs/config';
import {
  ShopeeAffiliateClient,
  ShopeeAdapter,
  decryptSecret,
} from '@lia/integrations';
import { IngestionService } from '../ingestion.service';

export interface ShopeeSyncJobData {
  tenantId: string;
  syncRunId?: string;
}

@Processor('shopee-api-queue', {
  concurrency: 1, // Impede sync concorrente no mesmo Worker (ideal seria lock distribuído, mas rate limit da API prefere concorrência baixa)
  limiter: {
    max: 2, // limit to 2 per second, conservative to fit in 8000/hr
    duration: 1000,
  },
})
@Injectable()
export class ShopeeProcessor extends WorkerHost {
  private readonly logger = new Logger(ShopeeProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly ingestionService: IngestionService,
  ) {
    super();
  }

  async process(job: Job<ShopeeSyncJobData, any, string>): Promise<any> {
    const { tenantId, syncRunId = `job-${job.id}` } = job.data;
    const masterKey = this.configService.get<string>(
      'INTEGRATION_ENCRYPTION_KEY',
    );

    if (!masterKey) {
      this.logger.error('INTEGRATION_ENCRYPTION_KEY not configured.');
      throw new UnrecoverableError('System misconfiguration');
    }

    // 1. Fetch Integration
    const integration = await this.prisma.marketplaceIntegration.findUnique({
      where: {
        tenantId_provider: {
          tenantId,
          provider: 'SHOPEE',
        },
      },
    });

    if (
      !integration ||
      integration.status !== 'CONNECTED' ||
      !integration.encryptedSecret ||
      !integration.iv ||
      !integration.authTag
    ) {
      this.logger.warn(
        `Shopee integration for tenant ${tenantId} is missing or not connected.`,
      );
      return { skipped: true, reason: 'Not connected' };
    }

    // 2. Decrypt Secret
    let appSecret: string;
    try {
      appSecret = decryptSecret(
        integration.encryptedSecret,
        integration.iv,
        integration.authTag,
        masterKey,
      );
    } catch (e) {
      this.logger.error(
        `Failed to decrypt Shopee secret for tenant ${tenantId}`,
      );
      await this.prisma.marketplaceIntegration.update({
        where: { id: integration.id },
        data: { status: 'ERROR', lastError: 'Decryption failed' },
      });
      throw new UnrecoverableError('Invalid encryption keys');
    }

    const appId = integration.publicIdentifier || '';
    const client = new ShopeeAffiliateClient(appId, appSecret);

    try {
      // 3. Sync all available pages (sortType 5 = COMMISSION_DESC). A single
      // page is not enough to re-observe the real catalog and would leave old
      // offers with stale score components.
      let processed = 0;
      let page = 1;
      let hasNextPage = true;
      const maxPages = 50;
      while (hasNextPage && page <= maxPages) {
        const response = await client.getProductOfferV2(page, 20, 5);
        const productOffer = response.data?.productOfferV2;
        const items = productOffer?.nodes || [];

        for (const item of items) {
          const canonical = ShopeeAdapter.toCanonicalOffer(item);
          await this.ingestionService.processIncomingOffer({
            correlationId: `shopee-${tenantId}-${canonical.externalOfferId}-${syncRunId}`,
            schemaVersion: '1.0',
            tenantId,
            data: canonical,
          });
          processed++;
        }

        hasNextPage = productOffer?.pageInfo?.hasNextPage === true;
        page++;
      }

      // 5. Update Status
      await this.prisma.marketplaceIntegration.update({
        where: { id: integration.id },
        data: {
          lastSyncAt: new Date(),
          lastDiscoveryAt: new Date(),
          lastSyncProcessedCount: processed,
          lastDiscoveryFoundCount: processed,
          lastError: null,
          lastDiscoveryError: null,
          status: 'CONNECTED',
        },
      });

      return { success: true, processed };
    } catch (error: any) {
      this.logger.error(
        `Shopee Sync failed for tenant ${tenantId}: ${error.message}`,
      );

      await this.prisma.marketplaceIntegration.update({
        where: { id: integration.id },
        data: { lastError: error.message },
      });

      throw error; // Let BullMQ retry based on backoff
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    this.logger.error(`Shopee sync job ${job?.id} failed: ${error.message}`);
  }
}
