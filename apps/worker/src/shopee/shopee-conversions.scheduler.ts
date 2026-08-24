import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma.service';
import {
  getShopeeConversionWindow,
  SHOPEE_CONVERSION_INTERVAL_MS,
} from '@lia/integrations';

/** Keeps the conversion report current without relying on a manual endpoint. */
@Injectable()
export class ShopeeConversionsSchedulerService {
  private readonly logger = new Logger(ShopeeConversionsSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('shopee-conversions-queue') private readonly queue: Queue,
  ) {}

  @Cron('0 */5 * * * *')
  async scheduleConnectedIntegrations() {
    const integrations = await this.prisma.marketplaceIntegration.findMany({
      where: { provider: 'SHOPEE', status: 'CONNECTED' },
      select: { tenantId: true, lastConversionSyncAt: true },
    });

    for (const integration of integrations) {
      const pendingJobs = await this.queue.getJobs(
        ['waiting', 'active', 'delayed', 'prioritized'],
        0,
        -1,
      );
      if (
        pendingJobs.some((job) => job.data?.tenantId === integration.tenantId)
      ) {
        continue;
      }

      const end = Math.floor(Date.now() / 1000);
      const window = getShopeeConversionWindow(
        integration.lastConversionSyncAt,
        end,
      );
      const intervalBucket = Math.floor(
        end / (SHOPEE_CONVERSION_INTERVAL_MS / 1000),
      );

      await this.queue.add(
        'sync',
        {
          tenantId: integration.tenantId,
          ...window,
          syncRunId: `scheduled-${end}`,
        },
        {
          jobId: `shopee-conv-sync-${integration.tenantId}-${intervalBucket}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 20000 },
          removeOnComplete: { age: 24 * 60 * 60 },
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      );
    }

    if (integrations.length > 0) {
      this.logger.log(
        `Queued scheduled Shopee conversion sync for ${integrations.length} tenant(s).`,
      );
    }
  }
}
