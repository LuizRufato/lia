import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma.service';

/** Keeps the conversion report current without relying on a manual endpoint. */
@Injectable()
export class ShopeeConversionsSchedulerService {
  private readonly logger = new Logger(ShopeeConversionsSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('shopee-conversions-queue') private readonly queue: Queue,
  ) {}

  @Cron('0 */30 * * * *')
  async scheduleConnectedIntegrations() {
    const integrations = await this.prisma.marketplaceIntegration.findMany({
      where: { provider: 'SHOPEE', status: 'CONNECTED' },
      select: { tenantId: true },
    });

    const end = Math.floor(Date.now() / 1000);
    const start = end - 7 * 24 * 60 * 60;
    const intervalBucket = Math.floor(Date.now() / (30 * 60 * 1000));

    for (const integration of integrations) {
      await this.queue.add(
        'sync',
        {
          tenantId: integration.tenantId,
          purchaseTimeStart: start,
          purchaseTimeEnd: end,
          syncRunId: `scheduled-${intervalBucket}`,
        },
        {
          jobId: `shopee-conv-sync-${integration.tenantId}-${intervalBucket}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 35000 },
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
