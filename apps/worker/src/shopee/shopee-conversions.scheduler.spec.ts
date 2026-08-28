import { ShopeeConversionsSchedulerService } from './shopee-conversions.scheduler';

jest.mock('@lia/integrations', () => ({
  SHOPEE_CONVERSION_INTERVAL_MS: 5 * 60 * 1000,
  getShopeeConversionWindow: jest.fn(
    (last: Date | null, now: number, initialLookback = 7 * 24 * 60 * 60) => ({
      purchaseTimeStart: last
        ? Math.min(last.getTime() / 1000, now) - 15 * 60
        : now - initialLookback,
      purchaseTimeEnd: now,
    }),
  ),
}));

describe('ShopeeConversionsSchedulerService', () => {
  afterEach(() => jest.useRealTimers());

  it('queues a five-minute incremental window and skips an in-flight tenant', async () => {
    jest.useFakeTimers().setSystemTime(new Date(1_700_000_300 * 1000));
    const prisma = {
      marketplaceIntegration: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'integration-1',
            tenantId: 'tenant-1',
            status: 'CONNECTED',
            encryptedSecret: null,
            lastConversionSyncAt: new Date(1_700_000_000 * 1000),
          },
          {
            id: 'integration-2',
            tenantId: 'tenant-2',
            status: 'CONNECTED',
            encryptedSecret: null,
            lastConversionSyncAt: null,
          },
        ]),
      },
    };
    const queue = {
      getJobs: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ data: { tenantId: 'tenant-2' } }]),
      add: jest.fn().mockResolvedValue(undefined),
    };
    const events = { createShopeeDisconnectedAlert: jest.fn() };
    const service = new ShopeeConversionsSchedulerService(
      prisma as any,
      queue as any,
      events as any,
    );

    await service.scheduleConnectedIntegrations();

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][1]).toMatchObject({
      tenantId: 'tenant-1',
      purchaseTimeStart: 1_699_999_100,
      purchaseTimeEnd: 1_700_000_300,
    });
    expect(events.createShopeeDisconnectedAlert).not.toHaveBeenCalled();
  });

  it('alerts only when the persisted Shopee integration is disconnected', async () => {
    const prisma = {
      marketplaceIntegration: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'integration-a',
            tenantId: 'tenant-a',
            status: 'DISCONNECTED',
            encryptedSecret: 'encrypted-secret',
            lastConversionSyncAt: null,
          },
        ]),
      },
    };
    const queue = { getJobs: jest.fn(), add: jest.fn() };
    const events = {
      createShopeeDisconnectedAlert: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ShopeeConversionsSchedulerService(
      prisma as any,
      queue as any,
      events as any,
    );

    await service.scheduleConnectedIntegrations();

    expect(events.createShopeeDisconnectedAlert).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      integrationId: 'integration-a',
      state: 'DISCONNECTED',
    });
    expect(queue.add).not.toHaveBeenCalled();
  });
});
