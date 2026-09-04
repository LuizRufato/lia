jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    quit: jest.fn(),
  })),
);

import { AnalyticsService } from './analytics.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';

describe('AnalyticsService sales KPI', () => {
  const makeService = (todayConversions: unknown[]) => {
    const prisma = {
      marketplaceConversion: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(todayConversions)
          .mockResolvedValueOnce([]),
      },
      autopilotConfig: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ timezone: 'America/Campo_Grande' }),
      },
      clickEvent: { count: jest.fn().mockResolvedValue(0) },
      offerObservation: { count: jest.fn().mockResolvedValue(0) },
      offerEvaluation: { count: jest.fn().mockResolvedValue(0) },
      publication: { count: jest.fn().mockResolvedValue(0) },
    } as unknown as PrismaService;

    return new AnalyticsService({} as ConfigService, prisma);
  };

  it('reports zero sales when there is a publication/click but no attributed conversion', async () => {
    const service = makeService([]);

    await expect(service.getOverview('tenant-1')).resolves.toMatchObject({
      today: { sales: 0 },
    });
  });

  it('reports one sale for an attributed confirmed conversion', async () => {
    const service = makeService([
      {
        attributionStatus: 'ATTRIBUTED',
        commissionStatus: 'CONFIRMED',
        totalCommissionCents: 1234,
      },
    ]);

    await expect(service.getOverview('tenant-1')).resolves.toMatchObject({
      today: { sales: 1, confirmedSales: 1, pendingSales: 0 },
    });
  });

  it('counts an attributed pending conversion as a sale before commission confirmation', async () => {
    const service = makeService([
      {
        attributionStatus: 'ATTRIBUTED',
        commissionStatus: 'PENDING',
        totalCommissionCents: 450,
      },
    ]);

    await expect(service.getOverview('tenant-1')).resolves.toMatchObject({
      today: {
        sales: 1,
        confirmedSales: 0,
        pendingSales: 1,
        pendingCommissionCents: 450,
        expectedCommissionCents: 450,
        confirmedCommissionCents: 0,
      },
    });
  });

  it('does not count a cancelled attributed conversion as a sale', async () => {
    const service = makeService([
      {
        attributionStatus: 'ATTRIBUTED',
        commissionStatus: 'CANCELLED',
        totalCommissionCents: 0,
      },
    ]);

    await expect(service.getOverview('tenant-1')).resolves.toMatchObject({
      today: {
        sales: 0,
        cancelledSales: 1,
        expectedCommissionCents: 0,
        cancelledCommissionCents: 0,
      },
    });
  });

  it('adds confirmed and pending commission to expected commission', async () => {
    const service = makeService([
      {
        attributionStatus: 'ATTRIBUTED',
        commissionStatus: 'CONFIRMED',
        totalCommissionCents: 700,
      },
      {
        attributionStatus: 'ATTRIBUTED',
        commissionStatus: 'ESTIMATED',
        totalCommissionCents: 300,
      },
    ]);

    await expect(service.getOverview('tenant-1')).resolves.toMatchObject({
      today: {
        sales: 2,
        confirmedCommissionCents: 700,
        pendingCommissionCents: 300,
        expectedCommissionCents: 1000,
      },
    });
  });

  it('uses Shopee actualAmount as line value without multiplying by quantity', async () => {
    const service = makeService([
      {
        attributionStatus: 'ATTRIBUTED',
        commissionStatus: 'PENDING',
        totalCommissionCents: 450,
        orders: [
          {
            items: [{ actualAmountCents: 350, itemPriceCents: 400, qty: 2 }],
          },
        ],
      },
    ]);

    await expect(service.getOverview('tenant-1')).resolves.toMatchObject({
      today: { grossSalesCents: 350 },
    });
  });

  it('uses the tenant local midnight for today and yesterday windows', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-24T04:30:00.000Z'));
    const service = makeService([]);
    const prisma = (service as any).prisma;

    try {
      await service.getOverview('tenant-1');
      const calls = prisma.marketplaceConversion.findMany.mock.calls;
      expect(calls[0][0].where.purchaseTime.gte.toISOString()).toBe(
        '2026-08-24T04:00:00.000Z',
      );
      expect(calls[1][0].where.purchaseTime).toMatchObject({
        gte: new Date('2026-08-23T04:00:00.000Z'),
        lt: new Date('2026-08-24T04:00:00.000Z'),
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it.each(['today', 'yesterday', '7d', '30d', 'this_month', 'last_month'])(
    'resolves the %s period in the tenant timezone',
    async (period) => {
      const prisma = {
        autopilotConfig: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ timezone: 'America/Campo_Grande' }),
        },
        marketplaceConversion: {
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
        },
      } as unknown as PrismaService;
      const service = new AnalyticsService({} as ConfigService, prisma);

      const result = await service.getSales('tenant-1', { period });

      expect(result.period.key).toBe(period);
      expect(result.period.timezone).toBe('America/Campo_Grande');
      expect(result.period.from.getUTCHours()).toBe(4);
    },
  );

  it('supports custom period, filters and real pagination without accepting tenantId', async () => {
    const prisma = {
      autopilotConfig: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ timezone: 'America/Campo_Grande' }),
      },
      marketplaceConversion: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;
    const service = new AnalyticsService({} as ConfigService, prisma);

    const result = await service.getSales('tenant-1', {
      period: 'custom',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-07',
      commissionStatus: 'PENDING',
      orderStatus: 'COMPLETED',
      search: 'pote',
      page: '2',
      limit: '500',
      tenantId: 'other-tenant',
    } as any);

    const where = (prisma.marketplaceConversion.count as jest.Mock).mock
      .calls[0][0].where;
    expect(where.tenantId).toBe('tenant-1');
    expect(where.commissionStatus).toBe('PENDING');
    expect(where.orders).toEqual({ some: { orderStatus: 'COMPLETED' } });
    expect(where.OR).toHaveLength(2);
    expect(result.pagination).toMatchObject({ page: 2, limit: 100, total: 2 });
    expect(result.period.from.toISOString()).toBe('2026-08-01T04:00:00.000Z');
    expect(result.period.to.toISOString()).toBe('2026-08-08T04:00:00.000Z');
  });

  it('does not divide conversion or EPC by zero clicks', async () => {
    const prisma = {
      autopilotConfig: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ timezone: 'America/Campo_Grande' }),
      },
      clickEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      marketplaceConversion: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;
    const service = new AnalyticsService({} as ConfigService, prisma);

    await expect(
      service.getReport('tenant-1', { period: 'today' }),
    ).resolves.toMatchObject({
      conversionRate: null,
      epcExpectedCents: null,
      clicks: 0,
      sales: 0,
    });
  });

  describe('hourly analytics history', () => {
    const timezone = 'America/Campo_Grande';
    const buildHistory = (
      service: AnalyticsService,
      period: { key: string; from: Date; to: Date; timezone: string },
      clicks: unknown[] = [],
      conversions: unknown[] = [],
    ) => (service as any).buildHistory(clicks, conversions, period);

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-24T18:37:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('builds today from local midnight through the current local hour', () => {
      const service = makeService([]);
      const history = buildHistory(service, {
        key: 'today',
        from: new Date('2026-08-24T04:00:00.000Z'),
        to: new Date('2026-08-25T04:00:00.000Z'),
        timezone,
      });

      expect(history).toHaveLength(15);
      expect(history[0].at).toBe('2026-08-24T04:00:00.000Z');
      expect(history.at(-1).at).toBe('2026-08-24T18:00:00.000Z');
    });

    it('builds yesterday as the complete local day in chronological order', () => {
      const service = makeService([]);
      const history = buildHistory(service, {
        key: 'yesterday',
        from: new Date('2026-08-23T04:00:00.000Z'),
        to: new Date('2026-08-24T04:00:00.000Z'),
        timezone,
      });

      expect(history).toHaveLength(24);
      expect(history[0].at).toBe('2026-08-23T04:00:00.000Z');
      expect(history.at(-1).at).toBe('2026-08-24T03:00:00.000Z');
      expect(history.map((item: any) => item.at)).toEqual(
        [...history]
          .sort((a: any, b: any) => a.at.localeCompare(b.at))
          .map((item: any) => item.at),
      );
    });

    it('places a click at exactly 10:00 in the 10h bucket', () => {
      const service = makeService([]);
      const history = buildHistory(
        service,
        {
          key: 'today',
          from: new Date('2026-08-24T04:00:00.000Z'),
          to: new Date('2026-08-25T04:00:00.000Z'),
          timezone,
        },
        [{ clickedAt: new Date('2026-08-24T14:00:00.000Z') }],
      );

      expect(history[9].clicks).toBe(0);
      expect(history[10].clicks).toBe(1);
    });

    it('groups sales by purchaseTime rather than createdAt', () => {
      const service = makeService([]);
      const history = buildHistory(
        service,
        {
          key: 'today',
          from: new Date('2026-08-24T04:00:00.000Z'),
          to: new Date('2026-08-25T04:00:00.000Z'),
          timezone,
        },
        [],
        [
          {
            purchaseTime: new Date('2026-08-24T14:00:00.000Z'),
            createdAt: new Date('2026-08-24T04:30:00.000Z'),
            attributionStatus: 'ATTRIBUTED',
            commissionStatus: 'PENDING',
            totalCommissionCents: 720,
          },
        ],
      );

      expect(history[10].sales).toBe(1);
      expect(history[0].sales).toBe(0);
    });

    it('keeps long periods grouped daily', () => {
      const service = makeService([]);
      const history = buildHistory(service, {
        key: '7d',
        from: new Date('2026-08-18T04:00:00.000Z'),
        to: new Date('2026-08-25T04:00:00.000Z'),
        timezone,
      });

      expect(history).toHaveLength(7);
      expect(history[0].at).toBe('2026-08-18T04:00:00.000Z');
      expect(history.at(-1).at).toBe('2026-08-24T04:00:00.000Z');
    });
  });
});
