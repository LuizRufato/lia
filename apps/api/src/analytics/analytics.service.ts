import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  getRedisConfig,
  getZonedDateParts,
  nextLocalDay,
  startOfLocalDay,
  zonedTimeToUtc,
} from '@lia/core';
import { PrismaService } from '../prisma.service';

type PeriodKey =
  'today' | 'yesterday' | '7d' | '30d' | 'this_month' | 'last_month' | 'custom';

type PeriodQuery = {
  period?: string;
  dateFrom?: string;
  dateTo?: string;
};

type SalesQuery = PeriodQuery & {
  marketplace?: string;
  commissionStatus?: string;
  orderStatus?: string;
  attributionStatus?: string;
  search?: string;
  page?: string;
  limit?: string;
};

type ResolvedPeriod = {
  key: PeriodKey;
  from: Date;
  to: Date;
  timezone: string;
};

@Injectable()
export class AnalyticsService {
  private readonly redis: Redis;
  private static readonly DEFAULT_TIMEZONE = 'America/Campo_Grande';

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.redis = new Redis(getRedisConfig().url);
  }

  private async getTenantTimezone(tenantId: string): Promise<string> {
    const config = await this.prisma.autopilotConfig.findUnique({
      where: { tenantId },
      select: { timezone: true },
    });
    const timezone = config?.timezone || AnalyticsService.DEFAULT_TIMEZONE;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
      return timezone;
    } catch {
      return AnalyticsService.DEFAULT_TIMEZONE;
    }
  }

  private localDateToUtc(value: string, timezone: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('dateFrom/dateTo devem usar YYYY-MM-DD.');
    }
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Data inválida.');
    }
    return zonedTimeToUtc(year, month, day, 0, 0, timezone);
  }

  private async resolvePeriod(
    tenantId: string,
    query: PeriodQuery = {},
  ): Promise<ResolvedPeriod> {
    const timezone = await this.getTenantTimezone(tenantId);
    const now = new Date();
    const today = startOfLocalDay(now, timezone);
    const parts = getZonedDateParts(now, timezone);
    const requested = query.period || 'today';

    if (requested === 'custom') {
      if (!query.dateFrom || !query.dateTo) {
        throw new BadRequestException(
          'Período personalizado exige dateFrom e dateTo.',
        );
      }
      const from = this.localDateToUtc(query.dateFrom, timezone);
      const endDay = this.localDateToUtc(query.dateTo, timezone);
      const to = nextLocalDay(endDay, timezone);
      if (from >= to) {
        throw new BadRequestException(
          'dateFrom deve ser anterior ou igual a dateTo.',
        );
      }
      return { key: 'custom', from, to, timezone };
    }

    switch (requested as PeriodKey) {
      case 'today':
        return {
          key: 'today',
          from: today,
          to: nextLocalDay(today, timezone),
          timezone,
        };
      case 'yesterday': {
        const yesterday = startOfLocalDay(
          new Date(today.getTime() - 86_400_000),
          timezone,
        );
        return { key: 'yesterday', from: yesterday, to: today, timezone };
      }
      case '7d':
        return {
          key: '7d',
          from: startOfLocalDay(
            new Date(today.getTime() - 6 * 86_400_000),
            timezone,
          ),
          to: nextLocalDay(today, timezone),
          timezone,
        };
      case '30d':
        return {
          key: '30d',
          from: startOfLocalDay(
            new Date(today.getTime() - 29 * 86_400_000),
            timezone,
          ),
          to: nextLocalDay(today, timezone),
          timezone,
        };
      case 'this_month':
        return {
          key: 'this_month',
          from: zonedTimeToUtc(parts.year, parts.month, 1, 0, 0, timezone),
          to: nextLocalDay(today, timezone),
          timezone,
        };
      case 'last_month': {
        const currentMonth = new Date(Date.UTC(parts.year, parts.month - 1, 1));
        const previousMonth = new Date(
          Date.UTC(parts.year, parts.month - 2, 1),
        );
        return {
          key: 'last_month',
          from: zonedTimeToUtc(
            previousMonth.getUTCFullYear(),
            previousMonth.getUTCMonth() + 1,
            1,
            0,
            0,
            timezone,
          ),
          to: zonedTimeToUtc(
            currentMonth.getUTCFullYear(),
            currentMonth.getUTCMonth() + 1,
            1,
            0,
            0,
            timezone,
          ),
          timezone,
        };
      }
      default:
        throw new BadRequestException('Período inválido.');
    }
  }

  private buildSalesWhere(
    tenantId: string,
    period: ResolvedPeriod,
    query: SalesQuery = {},
  ) {
    const assertFilter = (
      value: string | undefined,
      allowed: string[],
      name: string,
    ) => {
      if (value && !allowed.includes(value)) {
        throw new BadRequestException(`${name} inválido.`);
      }
    };
    assertFilter(query.marketplace, ['SHOPEE', 'MERCADO_LIVRE'], 'marketplace');
    assertFilter(
      query.commissionStatus,
      ['PENDING', 'ESTIMATED', 'CONFIRMED', 'CANCELLED'],
      'commissionStatus',
    );
    assertFilter(
      query.orderStatus,
      ['UNPAID', 'PENDING', 'COMPLETED', 'CANCELLED'],
      'orderStatus',
    );
    assertFilter(
      query.attributionStatus,
      ['ATTRIBUTED', 'UNATTRIBUTED'],
      'attributionStatus',
    );
    const where: any = {
      tenantId,
      purchaseTime: { gte: period.from, lt: period.to },
      attributionStatus: query.attributionStatus || 'ATTRIBUTED',
    };
    if (query.marketplace) where.provider = query.marketplace;
    if (query.commissionStatus) where.commissionStatus = query.commissionStatus;
    if (query.orderStatus) {
      where.orders = { some: { orderStatus: query.orderStatus } };
    }
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { offer: { title: { contains: search, mode: 'insensitive' } } },
        {
          orders: {
            some: {
              items: {
                some: { itemName: { contains: search, mode: 'insensitive' } },
              },
            },
          },
        },
      ];
    }
    return where;
  }

  private salesSelect() {
    return {
      id: true,
      purchaseTime: true,
      provider: true,
      attributionStatus: true,
      commissionStatus: true,
      totalCommissionCents: true,
      netCommissionCents: true,
      offer: {
        select: { title: true, marketplace: { select: { type: true } } },
      },
      orders: {
        select: {
          externalOrderId: true,
          orderStatus: true,
          items: {
            select: {
              itemName: true,
              qty: true,
              itemPriceCents: true,
              actualAmountCents: true,
              itemTotalCommissionCents: true,
            },
          },
        },
      },
      adminAlerts: {
        orderBy: { createdAt: 'desc' as const },
        take: 1,
        select: {
          deliveryStatus: true,
          createdAt: true,
          sentAt: true,
          deliveries: {
            select: { status: true, sentAt: true, lastError: true },
          },
        },
      },
    };
  }

  private summarizeConversions(conversions: any[]) {
    const active = conversions.filter(
      (conversion) => conversion.commissionStatus !== 'CANCELLED',
    );
    const confirmed = active.filter(
      (conversion) => conversion.commissionStatus === 'CONFIRMED',
    );
    const pending = active.filter((conversion) =>
      ['ESTIMATED', 'PENDING'].includes(conversion.commissionStatus),
    );
    const cancelled = conversions.filter(
      (conversion) => conversion.commissionStatus === 'CANCELLED',
    );
    const grossSalesCents = active.reduce(
      (sum, conversion) =>
        sum +
        (conversion.orders || [])
          .flatMap((order: any) => order.items || [])
          .reduce(
            (itemSum: number, item: any) =>
              itemSum + (item.actualAmountCents || 0),
            0,
          ),
      0,
    );
    const confirmedCommissionCents = confirmed.reduce(
      (sum, conversion) => sum + (conversion.totalCommissionCents || 0),
      0,
    );
    const pendingCommissionCents = pending.reduce(
      (sum, conversion) => sum + (conversion.totalCommissionCents || 0),
      0,
    );
    const expectedCommissionCents =
      confirmedCommissionCents + pendingCommissionCents;
    const sales = active.length;

    return {
      sales,
      grossSalesCents,
      confirmedSales: confirmed.length,
      pendingSales: pending.length,
      cancelledSales: cancelled.length,
      confirmedCommissionCents,
      pendingCommissionCents,
      expectedCommissionCents,
      cancelledCommissionCents: cancelled.reduce(
        (sum, conversion) => sum + (conversion.totalCommissionCents || 0),
        0,
      ),
      // Kept for API compatibility: this is now explicitly the confirmed amount.
      commissionCents: confirmedCommissionCents,
      ticketAverageCents: sales ? Math.round(grossSalesCents / sales) : 0,
    };
  }

  private mapSale(conversion: any) {
    return {
      id: conversion.id,
      purchaseTime: conversion.purchaseTime,
      marketplace: conversion.provider,
      product:
        conversion.offer?.title ||
        conversion.orders[0]?.items[0]?.itemName ||
        'Oferta',
      attributionStatus: conversion.attributionStatus,
      commissionStatus: conversion.commissionStatus,
      grossSalesCents: (conversion.orders || [])
        .flatMap((order: any) => order.items || [])
        .reduce(
          (sum: number, item: any) => sum + (item.actualAmountCents || 0),
          0,
        ),
      commissionCents: conversion.totalCommissionCents || 0,
      orders: conversion.orders.map((order: any) => ({
        orderId: order.externalOrderId,
        status: order.orderStatus,
        items: order.items.map((item: any) => ({
          name: item.itemName,
          qty: item.qty,
          itemPriceCents: item.itemPriceCents,
          actualAmountCents: item.actualAmountCents,
          commissionCents: item.itemTotalCommissionCents,
        })),
      })),
      adminAlert: conversion.adminAlerts[0]
        ? {
            status: conversion.adminAlerts[0].deliveryStatus,
            createdAt: conversion.adminAlerts[0].createdAt,
            sentAt: conversion.adminAlerts[0].sentAt,
            deliveries: conversion.adminAlerts[0].deliveries.map(
              (delivery: any) => ({
                status: delivery.status,
                sentAt: delivery.sentAt,
                error: delivery.lastError ? 'present' : null,
              }),
            ),
          }
        : null,
    };
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

    // Persist timestamps in UTC, but define the day in the tenant's local zone.
    const timezone = await this.getTenantTimezone(tenantId);
    const startOfDay = startOfLocalDay(new Date(), timezone);

    const [clicksToday, uniqueClicks, botsExcluded, publishedOffers] =
      await Promise.all([
        this.prisma.clickEvent.count({
          where: {
            link: { offer: { tenantId } },
            clickedAt: { gte: startOfDay },
            classification: 'VALID',
          },
        }),
        // A unique click is scoped to tracked link + visitor HMAC + tenant-local day.
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
          .then(
            (rows) =>
              new Set(rows.map((row) => `${row.linkId}:${row.visitorHash}`))
                .size,
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
      orderBy: { clickedAt: 'desc' },
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
      (event) => event.classification === 'VALID',
    );
    const productCounts = new Map<string, number>();
    for (const event of validEvents) {
      const name =
        event.link.offer.title || event.link.offer.product?.name || 'Oferta';
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
      device: event.deviceType || 'unknown',
      browser: event.userAgentFamily || 'unknown',
      channel: event.link.publication.channel.displayName,
      marketplace: event.link.offer.marketplace.type,
      product:
        event.link.offer.title || event.link.offer.product?.name || 'Oferta',
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
    const today = await this.resolvePeriod(tenantId, { period: 'today' });
    const yesterday = await this.resolvePeriod(tenantId, {
      period: 'yesterday',
    });
    const [todayConversions, yesterdayConversions, todayMetrics] =
      await Promise.all([
        this.prisma.marketplaceConversion.findMany({
          where: this.buildSalesWhere(tenantId, today),
          select: {
            commissionStatus: true,
            totalCommissionCents: true,
            orders: {
              select: { items: { select: { actualAmountCents: true } } },
            },
          },
        }),
        this.prisma.marketplaceConversion.findMany({
          where: this.buildSalesWhere(tenantId, yesterday),
          select: {
            commissionStatus: true,
            totalCommissionCents: true,
            orders: {
              select: { items: { select: { actualAmountCents: true } } },
            },
          },
        }),
        Promise.all([
          this.prisma.clickEvent.count({
            where: {
              link: { offer: { tenantId } },
              clickedAt: { gte: today.from, lt: today.to },
              classification: 'VALID',
            },
          }),
          this.prisma.offerObservation.count({
            where: {
              offer: { tenantId },
              observedAt: { gte: today.from, lt: today.to },
            },
          }),
          this.prisma.offerEvaluation.count({
            where: {
              observation: { offer: { tenantId } },
              evaluatedAt: { gte: today.from, lt: today.to },
              decision: 'ELIGIBLE',
            },
          }),
          this.prisma.publication.count({
            where: {
              channel: { tenantId },
              status: 'PUBLISHED',
              publishedAt: { gte: today.from, lt: today.to },
            },
          }),
        ]),
      ]);

    const [validClicks, offersAnalyzed, offersApproved, publicationsToday] =
      todayMetrics;
    const todaySummary = this.summarizeConversions(todayConversions);
    const yesterdaySummary = this.summarizeConversions(yesterdayConversions);

    return {
      today: {
        ...todaySummary,
        validClicks,
        offersAnalyzed,
        offersApproved,
        publicationsToday,
        conversionRate: validClicks ? todaySummary.sales / validClicks : null,
      },
      yesterday: yesterdaySummary,
    };
  }

  async getSales(tenantId: string, query: SalesQuery = {}) {
    const period = await this.resolvePeriod(tenantId, query);
    const where = this.buildSalesWhere(tenantId, period, query);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const [total, rows, summaryRows] = await Promise.all([
      this.prisma.marketplaceConversion.count({ where }),
      this.prisma.marketplaceConversion.findMany({
        where,
        orderBy: { purchaseTime: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: this.salesSelect(),
      }),
      this.prisma.marketplaceConversion.findMany({
        where,
        select: {
          commissionStatus: true,
          totalCommissionCents: true,
          orders: {
            select: { items: { select: { actualAmountCents: true } } },
          },
        },
      }),
    ]);
    return {
      period: {
        key: period.key,
        from: period.from,
        to: period.to,
        timezone: period.timezone,
      },
      summary: this.summarizeConversions(summaryRows),
      items: rows.map((row) => this.mapSale(row)),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getReport(tenantId: string, query: PeriodQuery = {}) {
    const period = await this.resolvePeriod(tenantId, query);
    const where = this.buildSalesWhere(tenantId, period);
    const validClicks = await this.prisma.clickEvent.findMany({
      where: {
        link: { offer: { tenantId } },
        clickedAt: { gte: period.from, lt: period.to },
        classification: 'VALID',
      },
      select: {
        clickedAt: true,
        linkId: true,
        visitorHash: true,
        link: {
          select: {
            offer: {
              select: { title: true, product: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: { clickedAt: 'desc' },
      take: 10_000,
    });
    const [botsExcluded, conversions] = await Promise.all([
      this.prisma.clickEvent.count({
        where: {
          link: { offer: { tenantId } },
          clickedAt: { gte: period.from, lt: period.to },
          classification: { in: ['PREVIEW_BOT', 'SUSPECTED_BOT'] },
        },
      }),
      this.prisma.marketplaceConversion.findMany({
        where,
        select: {
          purchaseTime: true,
          commissionStatus: true,
          totalCommissionCents: true,
          orders: {
            select: {
              items: {
                select: {
                  itemName: true,
                  qty: true,
                  actualAmountCents: true,
                  itemTotalCommissionCents: true,
                },
              },
            },
          },
        },
      }),
    ]);
    const summary = this.summarizeConversions(conversions);
    const uniqueClicks = new Set(
      validClicks
        .filter((click) => click.visitorHash)
        .map((click) => `${click.linkId}:${click.visitorHash}`),
    ).size;
    const clickProducts = new Map<string, number>();
    for (const click of validClicks) {
      const name =
        click.link.offer.title || click.link.offer.product?.name || 'Oferta';
      clickProducts.set(name, (clickProducts.get(name) || 0) + 1);
    }
    const soldProducts = new Map<string, { qty: number; commission: number }>();
    for (const conversion of conversions) {
      if (conversion.commissionStatus === 'CANCELLED') continue;
      for (const item of (conversion.orders || []).flatMap(
        (order: any) => order.items || [],
      )) {
        const current = soldProducts.get(item.itemName) || {
          qty: 0,
          commission: 0,
        };
        current.qty += item.qty || 0;
        current.commission += item.itemTotalCommissionCents || 0;
        soldProducts.set(item.itemName, current);
      }
    }
    const history = this.buildHistory(validClicks, conversions, period);
    return {
      period: {
        key: period.key,
        from: period.from,
        to: period.to,
        timezone: period.timezone,
      },
      clicks: validClicks.length,
      uniqueClicks,
      botsExcluded,
      ...summary,
      conversionRate: validClicks.length
        ? summary.sales / validClicks.length
        : null,
      epcExpectedCents: validClicks.length
        ? summary.expectedCommissionCents / validClicks.length
        : null,
      history,
      topProducts: {
        clicked: [...clickProducts.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5),
        sold: [...soldProducts.entries()]
          .map(([name, value]) => ({ name, qty: value.qty }))
          .sort((a, b) => b.qty - a.qty)
          .slice(0, 5),
        commission: [...soldProducts.entries()]
          .map(([name, value]) => ({ name, commissionCents: value.commission }))
          .sort((a, b) => b.commissionCents - a.commissionCents)
          .slice(0, 5),
      },
      recentClicks: validClicks.slice(0, 20).map((click) => ({
        at: click.clickedAt,
        product:
          click.link.offer.title || click.link.offer.product?.name || 'Oferta',
      })),
    };
  }

  private buildHistory(
    clicks: any[],
    conversions: any[],
    period: ResolvedPeriod,
  ) {
    const isToday = period.key === 'today';
    const buckets: Array<{ from: Date; to: Date; at: string }> = [];
    if (isToday) {
      const now = new Date();
      for (let index = 11; index >= 0; index -= 1) {
        const to = new Date(now.getTime() - index * 5 * 60_000);
        const from = new Date(to.getTime() - 5 * 60_000);
        buckets.push({ from, to, at: from.toISOString() });
      }
    } else {
      let cursor = period.from;
      while (cursor < period.to && buckets.length < 62) {
        const to = nextLocalDay(cursor, period.timezone);
        buckets.push({ from: cursor, to, at: cursor.toISOString() });
        cursor = to;
      }
    }
    return buckets.map((bucket) => {
      const bucketConversions = conversions.filter(
        (conversion) =>
          conversion.purchaseTime >= bucket.from &&
          conversion.purchaseTime < bucket.to,
      );
      const bucketClicks = clicks.filter(
        (click) =>
          click.clickedAt >= bucket.from && click.clickedAt < bucket.to,
      );
      const bucketSummary = this.summarizeConversions(bucketConversions);
      return {
        at: bucket.at,
        clicks: bucketClicks.length,
        sales: bucketSummary.sales,
        grossSalesCents: bucketSummary.grossSalesCents,
        expectedCommissionCents: bucketSummary.expectedCommissionCents,
      };
    });
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
