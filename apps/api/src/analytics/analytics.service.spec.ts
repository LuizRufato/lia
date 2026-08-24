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
    } as unknown as PrismaService;

    return new AnalyticsService({} as ConfigService, prisma);
  };

  it('reports zero sales when there is a publication/click but no confirmed conversion', async () => {
    const service = makeService([]);

    await expect(service.getOverview('tenant-1')).resolves.toMatchObject({
      today: { sales: 0 },
    });
  });

  it('reports one sale only for an attributed confirmed conversion', async () => {
    const service = makeService([
      {
        attributionStatus: 'ATTRIBUTED',
        commissionStatus: 'CONFIRMED',
        totalCommissionCents: 1234,
      },
    ]);

    await expect(service.getOverview('tenant-1')).resolves.toMatchObject({
      today: { sales: 1 },
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
});
