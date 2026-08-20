import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma.service';

/**
 * Queues a new Shopee ingestion cycle for every connected tenant.
 * It intentionally performs no scoring or publication itself: those remain in
 * the existing queues and the Autopilot mode controls whether anything is sent.
 */
@Injectable()
export class ShopeeSyncSchedulerService {
  private readonly logger = new Logger(ShopeeSyncSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('shopee-api-queue') private readonly shopeeQueue: Queue,
  ) {}

  @Cron('0 */15 * * * *')
  async scheduleConnectedIntegrations() {
    const integrations = await this.prisma.marketplaceIntegration.findMany({
      where: { provider: 'SHOPEE', status: 'CONNECTED' },
      select: { tenantId: true },
    });

    const intervalBucket = Math.floor(Date.now() / (15 * 60 * 1000));
    for (const integration of integrations) {
      await this.shopeeQueue.add(
        'sync-shopee',
        { tenantId: integration.tenantId },
        {
          // Avoid duplicate polls if more than one Worker is briefly online.
          jobId: `shopee-scheduled-${integration.tenantId}-${intervalBucket}`,
          removeOnComplete: { age: 24 * 60 * 60 },
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      );
    }

    if (integrations.length > 0) {
      this.logger.log(
        `Queued scheduled Shopee sync for ${integrations.length} tenant(s).`,
      );
    }
  }
}
