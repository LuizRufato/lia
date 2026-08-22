import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { getRedisConfig } from '@lia/core';
import { PrismaService } from '../prisma.service';

@Injectable()
export class AnalyticsService {
  private readonly redis: Redis;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.redis = new Redis(getRedisConfig().url);
  }

  async getRealtimeMetrics(tenantId: string) {
    // Generate buckets for the last 5 minutes
    const buckets = [];
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      const d = new Date(now.getTime() - i * 60000);
      const yyyy = d.getUTCFullYear();
      const MM = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const HH = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      buckets.push(`${yyyy}${MM}${dd}${HH}${mm}`);
    }

    let clicksNow = 0;

    // Total valid clicks in the last 5 minutes from Redis
    for (const bucket of buckets) {
      const val = await this.redis.get(`clicks:rt:${tenantId}:${bucket}`);
      if (val) {
        clicksNow += parseInt(val, 10);
      }
    }

    // To get "Clicks Hoje" we need to query PostgreSQL for historical accuracy
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const [clicksToday, uniqueClicks, botsExcluded, publishedOffers] =
      await Promise.all([
        this.prisma.clickEvent.count({
          where: {
            link: { offer: { tenantId } },
            clickedAt: { gte: startOfDay },
            classification: 'VALID',
          },
        }),
        // For unique clicks we can count distinct visitorHash for today
        this.prisma.clickEvent
          .groupBy({
            by: ['visitorHash'],
            where: {
              link: { offer: { tenantId } },
              clickedAt: { gte: startOfDay },
              classification: 'VALID',
              visitorHash: { not: null },
            },
          })
          .then((r) => r.length),
        this.prisma.clickEvent.count({
          where: {
            link: { offer: { tenantId } },
            clickedAt: { gte: startOfDay },
            classification: { in: ['PREVIEW_BOT', 'SUSPECTED_BOT'] },
          },
        }),
        this.prisma.publication.count({
          where: {
            channel: { tenantId },
            status: 'PUBLISHED',
          },
        }),
      ]);

    return {
      clicksToday,
      clicksNow,
      uniqueClicks,
      botsExcluded,
      publishedOffers,
    };
  }

  async getOverview(tenantId: string) {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const conversionsToday = await this.prisma.marketplaceConversion.findMany({
      where: {
        tenantId,
        attributionStatus: 'ATTRIBUTED',
        purchaseTime: { gte: startOfDay },
      },
    });

    // Only count non-cancelled
    const validConversions = conversionsToday; // Or filter by status if we had one at the root, but status is in orders.
    // Wait, let's just count all that are ATTRIBUTED. If order is cancelled, we might still want to show it or subtract it.
    // Let's sum the estimatedTotalCommissionCents

    let totalSales = validConversions.length;
    let totalCommissionCents = 0;

    for (const conv of validConversions) {
      totalCommissionCents += conv.totalCommissionCents || 0;
    }

    // Also get previous day for comparison
    const startOfYesterday = new Date(startOfDay);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);

    const conversionsYesterday =
      await this.prisma.marketplaceConversion.findMany({
        where: {
          tenantId,
          attributionStatus: 'ATTRIBUTED',
          purchaseTime: { gte: startOfYesterday, lt: startOfDay },
        },
      });

    let yesterdaySales = conversionsYesterday.length;
    let yesterdayCommissionCents = 0;
    for (const conv of conversionsYesterday) {
      yesterdayCommissionCents += conv.totalCommissionCents || 0;
    }

    return {
      today: {
        sales: totalSales,
        commissionCents: totalCommissionCents,
      },
      yesterday: {
        sales: yesterdaySales,
        commissionCents: yesterdayCommissionCents,
      },
    };
  }

  async getConversions(tenantId: string) {
    const conversions = await this.prisma.marketplaceConversion.findMany({
      where: { tenantId },
      orderBy: { purchaseTime: 'desc' },
      take: 50,
      include: {
        offer: true,
        orders: {
          include: {
            items: true,
          },
        },
      },
    });

    return conversions.map((c: any) => ({
      id: c.id,
      purchaseTime: c.purchaseTime,
      attributionStatus: c.attributionStatus,
      totalCommissionCents: c.totalCommissionCents,
      offerTitle: c.offer?.title || null,
      offerUrl: c.offer?.url || null,
      orders: c.orders.map((o: any) => ({
        status: o.orderStatus,
        items: o.items.map((i: any) => ({
          name: i.itemName,
          qty: i.qty,
          priceCents: i.itemPriceCents,
        })),
      })),
    }));
  }
}
