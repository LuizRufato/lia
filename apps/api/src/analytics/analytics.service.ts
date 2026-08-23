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
        // A unique click is scoped to tracked link + visitor HMAC + UTC day.
        // The raw IP is never stored or exposed.
        this.prisma.clickEvent
          .findMany({
            where: {
              link: { offer: { tenantId } },
              clickedAt: { gte: startOfDay },
              classification: 'VALID',
              visitorHash: { not: null },
            },
            select: { linkId: true, visitorHash: true },
          })
          .then((rows) =>
            new Set(rows.map((row) => `${row.linkId}:${row.visitorHash}`)).size,
          ),
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

    const recentEvents = await this.prisma.clickEvent.findMany({
      where: {
        link: { offer: { tenantId } },
        clickedAt: { gte: startOfDay },
      },
      orderBy: { clickedAt: "desc" },
      take: 500,
      select: {
        clickedAt: true,
        classification: true,
        intelligenceClass: true,
        deviceType: true,
        userAgentFamily: true,
        link: {
          select: {
            offer: {
              select: {
                title: true,
                product: { select: { name: true } },
                marketplace: { select: { type: true } },
              },
            },
            publication: {
              select: { channel: { select: { displayName: true } } },
            },
          },
        },
      },
    });

    const validEvents = recentEvents.filter(
      (event) => event.classification === "VALID",
    );
    const productCounts = new Map<string, number>();
    for (const event of validEvents) {
      const name = event.link.offer.title || event.link.offer.product?.name || "Oferta";
      productCounts.set(name, (productCounts.get(name) || 0) + 1);
    }

    const topProducts = [...productCounts.entries()]
      .map(([name, clicks]) => ({ name, clicks }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 5);

    const timeline = Array.from({ length: 12 }, (_, index) => {
      const end = new Date(now.getTime() - index * 5 * 60_000);
      const start = new Date(end.getTime() - 5 * 60_000);
      const clicks = validEvents.filter(
        (event) => event.clickedAt >= start && event.clickedAt < end,
      ).length;
      return { at: start.toISOString(), clicks };
    }).reverse();

    const recentClicks = validEvents.slice(0, 20).map((event) => ({
      at: event.clickedAt.toISOString(),
      device: event.deviceType || "unknown",
      browser: event.userAgentFamily || "unknown",
      channel: event.link.publication.channel.displayName,
      marketplace: event.link.offer.marketplace.type,
      product: event.link.offer.title || event.link.offer.product?.name || "Oferta",
    }));

    return {
      clicksToday,
      clicksNow,
      uniqueClicks,
      botsExcluded,
      publishedOffers,
      topProducts,
      timeline,
      recentClicks,
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

    const summarize = (conversions: any[]) => {
      const confirmed = conversions.filter(
        (conversion) => conversion.commissionStatus === 'CONFIRMED',
      );
      const pending = conversions.filter((conversion) =>
        ['ESTIMATED', 'PENDING'].includes(conversion.commissionStatus),
      );
      const cancelled = conversions.filter(
        (conversion) => conversion.commissionStatus === 'CANCELLED',
      );

      return {
        sales: confirmed.length,
        commissionCents: confirmed.reduce(
          (sum, conversion) => sum + (conversion.totalCommissionCents || 0),
          0,
        ),
        pendingSales: pending.length,
        pendingCommissionCents: pending.reduce(
          (sum, conversion) => sum + (conversion.totalCommissionCents || 0),
          0,
        ),
        cancelledSales: cancelled.length,
      };
    };

    const today = summarize(conversionsToday);

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

    const yesterday = summarize(conversionsYesterday);

    return {
      today,
      yesterday,
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
      commissionStatus: c.commissionStatus,
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
