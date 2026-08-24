import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ConfigService } from '@nestjs/config';
import {
  ShopeeAffiliateClient,
  decryptSecret,
  isRetryableShopeeConversionError,
  SHOPEE_CONVERSION_CURSOR_DELAY_MS,
  SHOPEE_CONVERSION_MAX_PAGES,
} from '@lia/integrations';
import type {
  ShopeeConversionNode,
  ShopeeConversionResponse,
} from '@lia/integrations';
import Decimal from 'decimal.js';
import {
  deriveCommissionStatus,
  normalizeOrderStatus,
} from './conversion-state';

type ShopeeConversionPage = NonNullable<
  ShopeeConversionResponse['data']['conversionReport']
>;

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
    // Keep root retries and legacy cursor jobs below the documented cursor TTL.
    // Continuation requests are paced explicitly in fetchNextPage because the
    // BullMQ limiter only governs job starts, not calls made inside a job.
    duration: 20000,
  },
})
@Injectable()
export class ShopeeConversionsProcessor extends WorkerHost {
  private readonly logger = new Logger(ShopeeConversionsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
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
    } = job.data;
    const masterKey = this.configService.get<string>(
      'INTEGRATION_ENCRYPTION_KEY',
    );

    if (!masterKey) {
      throw new UnrecoverableError('System misconfiguration');
    }

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
      if (pageCount > SHOPEE_CONVERSION_MAX_PAGES) {
        throw new Error(
          `Shopee conversion pagination truncated: page guard exceeded at page ${pageCount}.`,
        );
      }

      const limit = 500;
      const pages: ShopeeConversionPage[] = [];
      let response = await client.getConversionReport(
        purchaseTimeStart,
        purchaseTimeEnd,
        limit,
        scrollId,
      );
      let currentPage = pageCount;
      let totalProcessedCount = 0;
      let totalAttributedCount = 0;

      // Acquire the complete cursor chain before touching PostgreSQL. The
      // array is bounded by the page guard and stores response objects by
      // reference, so persistence cannot delay the next cursor request.
      while (true) {
        const report = response.data?.conversionReport;
        if (!report?.pageInfo) {
          throw new Error(
            'Shopee conversion pagination incomplete: missing pageInfo.',
          );
        }

        const hasNextPage = report.pageInfo.hasNextPage === true;
        const nextScrollId = report.pageInfo.scrollId;
        if (hasNextPage && !nextScrollId) {
          throw new Error(
            'Shopee conversion pagination incomplete: hasNextPage=true without scrollId.',
          );
        }
        if (hasNextPage && currentPage >= SHOPEE_CONVERSION_MAX_PAGES) {
          throw new Error(
            `Shopee conversion pagination truncated: page guard reached at page ${currentPage}.`,
          );
        }

        pages.push(report);

        if (!hasNextPage) {
          break;
        }

        response = await this.fetchNextPage(
          client,
          purchaseTimeStart,
          purchaseTimeEnd,
          limit,
          nextScrollId!,
        );
        currentPage += 1;
      }

      // Keep database writes sequential. If any write fails, the outer catch
      // prevents checkpointing and BullMQ retries the root window.
      currentPage = pageCount;
      for (const page of pages) {
        const pageResult = await this.persistConversionPage(
          tenantId,
          page.nodes || [],
        );
        totalProcessedCount += pageResult.processedCount;
        totalAttributedCount += pageResult.attributedCount;

        this.logger.log(
          `Page ${currentPage} synced for ${tenantId}. Processed: ${pageResult.processedCount}, Attributed: ${pageResult.attributedCount}`,
        );
        currentPage += 1;
      }

      await this.prisma.marketplaceIntegration.update({
        where: { id: integration.id },
        data: {
          lastConversionSyncAt: new Date(purchaseTimeEnd * 1000),
          lastConversionError: null,
        },
      });

      return {
        success: true,
        processedCount: totalProcessedCount,
        attributedCount: totalAttributedCount,
        hasMore: false,
      };
    } catch (error: any) {
      this.logger.error(
        `Shopee Conversion Sync failed for tenant ${tenantId}: ${error.message}`,
      );

      // Legacy queued child jobs may still contain a cursor. Make their next
      // BullMQ attempt restart the fixed window from the root instead of
      // retrying the same cursor.
      if (scrollId && typeof job.updateData === 'function') {
        try {
          const {
            scrollId: _scrollId,
            pageCount: _pageCount,
            ...rootData
          } = job.data;
          await job.updateData(rootData);
        } catch (updateError: any) {
          this.logger.warn(
            `Could not reset legacy Shopee cursor job ${job.id}: ${updateError?.message || updateError}`,
          );
        }
      }

      await this.prisma.marketplaceIntegration.update({
        where: { id: integration.id },
        data: {
          lastConversionError: String(
            error.message || 'Shopee conversion sync failed',
          ).slice(0, 500),
        },
      });

      if (isRetryableShopeeConversionError(error)) {
        throw error;
      }
      throw new UnrecoverableError(error.message);
    }
  }

  private async fetchNextPage(
    client: ShopeeAffiliateClient,
    purchaseTimeStart: number,
    purchaseTimeEnd: number,
    limit: number,
    scrollId: string,
  ): Promise<ShopeeConversionResponse> {
    // Start the continuation timer independently of page persistence. This is
    // the cursor-safety boundary: a slow DB write must not delay the next API
    // request beyond Shopee's cursor lifetime.
    await new Promise<void>((resolve) =>
      setTimeout(resolve, SHOPEE_CONVERSION_CURSOR_DELAY_MS),
    );
    return client.getConversionReport(
      purchaseTimeStart,
      purchaseTimeEnd,
      limit,
      scrollId,
    );
  }

  private async persistConversionPage(
    tenantId: string,
    nodes: ShopeeConversionNode[],
  ): Promise<{ processedCount: number; attributedCount: number }> {
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
      const shopeeCappedCents = new Decimal(node.shopeeCommissionCapped || '0')
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
      const commissionStatus = deriveCommissionStatus(normalizedOrderStatuses);

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
                  foundAttributionKey ??
                  existingConversion?.attributionKey ??
                  null,
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

    return { processedCount, attributedCount };
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
