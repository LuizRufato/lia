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
});
