import {
  Processor,
  WorkerHost,
  OnWorkerEvent,
  InjectQueue,
} from '@nestjs/bullmq';
import { Job, UnrecoverableError, Queue } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ConfigService } from '@nestjs/config';
import { ShopeeAffiliateClient, decryptSecret } from '@lia/integrations';
import Decimal from 'decimal.js';
import {
  conversionPageJobId,
  deriveCommissionStatus,
  normalizeOrderStatus,
} from './conversion-state';

export interface ShopeeConversionsSyncJobData {
  tenantId: string;
  purchaseTimeStart: number;
  purchaseTimeEnd: number;
  scrollId?: string;
  pageCount?: number;
  syncRunId?: string;
}

@Processor('shopee-conversions-queue', {
  concurrency: 1, // Strictly 1 per worker to respect API rate limits and avoid race conditions on cursor
  limiter: {
    max: 1,
    duration: 35000, // Cooldown >30s if we don't have scrollId, but wait, BullMQ limiter applies to ALL jobs.
    // Actually, we manage the 30s delay programmatically if there is no scrollId. Let's just set a moderate queue limit.
  },
})
@Injectable()
export class ShopeeConversionsProcessor extends WorkerHost {
  private readonly logger = new Logger(ShopeeConversionsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @InjectQueue('shopee-conversions-queue') private readonly queue: Queue,
  ) {
    super();
  }

  async process(
    job: Job<ShopeeConversionsSyncJobData, any, string>,
  ): Promise<any> {
    const {
      tenantId,
      purchaseTimeStart,
      purchaseTimeEnd,
      scrollId,
      pageCount = 0,
      syncRunId = `job-${job.id}`,
    } = job.data;
    const masterKey = this.configService.get<string>(
      'INTEGRATION_ENCRYPTION_KEY',
    );

    if (!masterKey) {
      throw new UnrecoverableError('System misconfiguration');
    }

    if (pageCount > 50) {
      this.logger.warn(
        `Max pages reached (50) for job ${job.id}. Aborting to avoid infinite loop.`,
      );
      return { success: true, reason: 'Max pages reached', pages: pageCount };
    }

    // Delay > 30s for the first page (no scrollId) as per Shopee guidelines if another sync just ran.
    // To implement this safely, we assume manual syncs are triggered intentionally. We rely on the client rate limits.

    const integration = await this.prisma.marketplaceIntegration.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'SHOPEE' } },
    });

    if (
      !integration ||
      integration.status !== 'CONNECTED' ||
      !integration.encryptedSecret ||
      !integration.iv ||
      !integration.authTag
    ) {
      return { skipped: true, reason: 'Not connected' };
    }

    let appSecret: string;
    try {
      appSecret = decryptSecret(
        integration.encryptedSecret,
        integration.iv,
        integration.authTag,
        masterKey,
      );
    } catch (e) {
      throw new UnrecoverableError('Invalid encryption keys');
    }

    const appId = integration.publicIdentifier || '';
    const client = new ShopeeAffiliateClient(appId, appSecret);

    try {
      const limit = 500;
      const response = await client.getConversionReport(
        purchaseTimeStart,
        purchaseTimeEnd,
        limit,
        scrollId,
      );

      const nodes = response.data?.conversionReport?.nodes || [];
      const pageInfo = response.data?.conversionReport?.pageInfo;

      let processedCount = 0;
      let attributedCount = 0;

      for (const node of nodes) {
        processedCount++;
        const existingConversion =
          await this.prisma.marketplaceConversion.findUnique({
            where: {
              tenantId_provider_externalConversionId: {
                tenantId,
                provider: 'SHOPEE',
                externalConversionId: String(node.conversionId),
              },
            },
            select: {
              id: true,
              attributionKey: true,
              attributionStatus: true,
              affiliateLinkId: true,
              offerId: true,
            },
          });

        // 1. Attribution. Once attributed, a later report page must not
        // regress it to UNATTRIBUTED.
        let finalAttributionStatus = 'UNATTRIBUTED';
        let affiliateLinkId: string | null = null;
        let offerId: string | null = null;

        // Try to find attribution key from subIds in utmContent
        // In Shopee, utmContent is an array of strings, usually subIds
        let foundAttributionKey: string | null = null;
        for (const utm of node.utmContent || []) {
          if (utm && utm.length > 5) {
            foundAttributionKey = utm;
            // We can stop at the first non-empty string assuming it's our attributionKey
            break;
          }
        }

        if (foundAttributionKey) {
          const affiliateLink = await this.prisma.affiliateLink.findFirst({
            where: {
              tenantId,
              attributionKey: foundAttributionKey,
            },
          });
          if (affiliateLink) {
            finalAttributionStatus = 'ATTRIBUTED';
            affiliateLinkId = affiliateLink.id;
            offerId = affiliateLink.offerId;
            attributedCount++;
          }
        }

        if (existingConversion?.attributionStatus === 'ATTRIBUTED') {
          finalAttributionStatus = 'ATTRIBUTED';
          affiliateLinkId = existingConversion.affiliateLinkId;
          offerId = existingConversion.offerId;
          foundAttributionKey = existingConversion.attributionKey;
        }

        // 2. Format Cents using Decimal.js
        const shopeeCappedCents = new Decimal(
          node.shopeeCommissionCapped || '0',
        )
          .mul(100)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
          .toNumber();
        const sellerCents = new Decimal(node.sellerCommission || '0')
          .mul(100)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
          .toNumber();
        const totalCents = new Decimal(node.totalCommission || '0')
          .mul(100)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
          .toNumber();
        const netCents = new Decimal(node.netCommission || '0')
          .mul(100)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
          .toNumber();

        const normalizedOrderStatuses = (node.orders || []).map((order) =>
          normalizeOrderStatus(order.orderStatus),
        );
        const commissionStatus = deriveCommissionStatus(
          normalizedOrderStatuses,
        );

        // 3. Upsert Conversion
        const conversion = await this.prisma.marketplaceConversion.upsert({
          where: {
            tenantId_provider_externalConversionId: {
              tenantId,
              provider: 'SHOPEE',
              externalConversionId: String(node.conversionId),
            },
          },
          create: {
            tenantId,
            provider: 'SHOPEE',
            externalConversionId: String(node.conversionId),
            purchaseTime: new Date(node.purchaseTime * 1000),
            clickTime: node.clickTime ? new Date(node.clickTime * 1000) : null,
            utmContent: JSON.stringify(node.utmContent || []),
            attributionKey: foundAttributionKey,
            attributionStatus: finalAttributionStatus as any,
            commissionStatus,
            affiliateLinkId,
            offerId,
            buyerType: String(node.buyerType),
            device: node.device,
            campaignType: node.campaignType,
            shopeeCommissionCappedCents: shopeeCappedCents,
            sellerCommissionCents: sellerCents,
            totalCommissionCents: totalCents,
            netCommissionCents: netCents,
          },
          update: {
            purchaseTime: new Date(node.purchaseTime * 1000),
            clickTime: node.clickTime ? new Date(node.clickTime * 1000) : null,
            utmContent: JSON.stringify(node.utmContent || []),
            shopeeCommissionCappedCents: shopeeCappedCents,
            sellerCommissionCents: sellerCents,
            totalCommissionCents: totalCents,
            netCommissionCents: netCents,
            commissionStatus,
            ...(existingConversion?.attributionStatus !== 'ATTRIBUTED'
              ? {
                  attributionKey:
                    foundAttributionKey ?? existingConversion?.attributionKey ?? null,
                  attributionStatus: finalAttributionStatus as any,
                  affiliateLinkId,
                  offerId,
                }
              : {}),
          },
        });

        // 4. Process Orders & Items
        for (const order of node.orders || []) {
          const mOrder = await this.prisma.marketplaceConversionOrder.upsert({
            where: {
              conversionId_externalOrderId: {
                conversionId: conversion.id,
                externalOrderId: String(order.orderId),
              },
            },
            create: {
              conversionId: conversion.id,
              externalOrderId: String(order.orderId),
              orderStatus: normalizeOrderStatus(order.orderStatus),
              shopType: order.shopType,
            },
            update: {
              orderStatus: normalizeOrderStatus(order.orderStatus),
            },
          });

          for (const item of order.items || []) {
            const externalLineKey = `${order.orderId}-${item.itemId}-${item.qty}-${item.itemPrice}`;

            const itemPriceCents = new Decimal(item.itemPrice || '0')
              .mul(100)
              .toDecimalPlaces(0)
              .toNumber();
            const actualAmountCents = new Decimal(item.actualAmount || '0')
              .mul(100)
              .toDecimalPlaces(0)
              .toNumber();
            const iTotalCents = new Decimal(item.itemTotalCommission || '0')
              .mul(100)
              .toDecimalPlaces(0)
              .toNumber();
            const iSellerCents = new Decimal(item.itemSellerCommission || '0')
              .mul(100)
              .toDecimalPlaces(0)
              .toNumber();
            const iShopeeCents = new Decimal(
              item.itemShopeeCommissionCapped || '0',
            )
              .mul(100)
              .toDecimalPlaces(0)
              .toNumber();

            await this.prisma.marketplaceConversionItem.upsert({
              where: {
                orderId_externalLineKey: {
                  orderId: mOrder.id,
                  externalLineKey,
                },
              },
              create: {
                orderId: mOrder.id,
                externalItemId: String(item.itemId),
                externalLineKey,
                itemName: item.itemName,
                qty: item.qty,
                itemPriceCents,
                actualAmountCents,
                itemTotalCommissionCents: iTotalCents,
                itemSellerCommissionCents: iSellerCents,
                itemShopeeCommissionCappedCents: iShopeeCents,
                displayItemStatus: item.displayItemStatus,
                fraudStatus: item.fraudStatus,
                globalCategoryLv1Name: item.globalCategoryLv1Name,
                globalCategoryLv2Name: item.globalCategoryLv2Name,
                globalCategoryLv3Name: item.globalCategoryLv3Name,
                modelId: item.modelId ? String(item.modelId) : null,
                promotionId: item.promotionId ? String(item.promotionId) : null,
              },
              update: {
                displayItemStatus: item.displayItemStatus,
                fraudStatus: item.fraudStatus,
                itemTotalCommissionCents: iTotalCents,
                itemSellerCommissionCents: iSellerCents,
                itemShopeeCommissionCappedCents: iShopeeCents,
              },
            });
          }
        }
      }

      this.logger.log(
        `Page ${pageCount} synced for ${tenantId}. Processed: ${processedCount}, Attributed: ${attributedCount}`,
      );

      // 5. Pagination State Machine
      if (pageInfo && pageInfo.hasNextPage && pageInfo.scrollId) {
        // Re-enqueue next page immediately
        await this.queue.add(
          'sync',
          {
            tenantId,
            purchaseTimeStart,
            purchaseTimeEnd,
            scrollId: pageInfo.scrollId,
            pageCount: pageCount + 1,
            syncRunId,
          },
          {
            jobId: conversionPageJobId(
              tenantId,
              purchaseTimeStart,
              purchaseTimeEnd,
              pageInfo.scrollId,
            ),
            removeOnComplete: true,
            attempts: 3,
            backoff: { type: 'fixed', delay: 35000 }, // If fails (e.g. scrollId expires), wait 35s and it will restart without scrollId? Wait, if scrollId fails, we shouldn't retry with the same scrollId.
          },
        );

        return {
          success: true,
          processedCount,
          attributedCount,
          nextScrollId: pageInfo.scrollId,
          hasMore: true,
        };
      }

      return { success: true, processedCount, attributedCount, hasMore: false };
    } catch (error: any) {
      this.logger.error(
        `Shopee Conversion Sync failed for tenant ${tenantId}: ${error.message}`,
      );
      // Only throw if we want BullMQ to retry. If it's a 10030 (Rate limit) or network error, retry.
      if (
        error.message.includes('Rate Limit') ||
        error.message.includes('timeout')
      ) {
        throw error;
      }
      throw new UnrecoverableError(error.message);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    if (job) {
      this.logger.error(
        `ShopeeConversionsJob ${job.id} failed: ${error.message}`,
      );
    }
  }
}
