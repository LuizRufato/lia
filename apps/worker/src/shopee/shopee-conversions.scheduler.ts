import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma.service';
import {
  getShopeeConversionWindow,
  SHOPEE_CONVERSION_INTERVAL_MS,
} from '@lia/integrations';
import { AdminAlertEventsService } from '../admin-alerts/admin-alert-events.service';

/** Keeps the conversion report current without relying on a manual endpoint. */
@Injectable()
export class ShopeeConversionsSchedulerService {
  private readonly logger = new Logger(ShopeeConversionsSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('shopee-conversions-queue') private readonly queue: Queue,
    @Optional() private readonly adminAlertEvents?: AdminAlertEventsService,
  ) {}

  @Cron('0 */5 * * * *')
  async scheduleConnectedIntegrations() {
    const integrations = await this.prisma.marketplaceIntegration.findMany({
      where: { provider: 'SHOPEE' },
      select: {
        id: true,
        tenantId: true,
        status: true,
        encryptedSecret: true,
        lastConversionSyncAt: true,
      },
    });

    for (const integration of integrations) {
      if (integration.status !== 'CONNECTED') {
        if (
          integration.status !== 'NOT_CONNECTED' ||
          integration.encryptedSecret
        ) {
          try {
            await this.adminAlertEvents?.createShopeeDisconnectedAlert({
              tenantId: integration.tenantId,
              integrationId: integration.id,
              state: integration.status,
            });
          } catch (error: any) {
            this.logger.error(
              `ADMIN_ALERT_SHOPEE_DISCONNECTED_FAILED: ${error?.message || error}`,
            );
          }
        }
        continue;
      }
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
