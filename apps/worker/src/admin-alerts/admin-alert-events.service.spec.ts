jest.mock('@lia/integrations', () => ({
  decryptSecret: jest.fn(() => '5511999991234'),
  getEncryptionKey: jest.fn(() => 'encryption-key'),
}));

import { AdminAlertEventsService } from './admin-alert-events.service';

describe('AdminAlertEventsService', () => {
  let prisma: any;
  let queue: any;
  let service: AdminAlertEventsService;

  beforeEach(() => {
    jest.clearAllMocks();
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      adminAlertConfig: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      adminAlert: {
        upsert: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      channelIntegration: { findFirst: jest.fn() },
      adminAlertRecipient: {
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
      adminAlertDelivery: {
        createMany: jest.fn(),
        findMany: jest.fn(),
      },
      publication: { count: jest.fn() },
      clickEvent: { count: jest.fn() },
      marketplaceConversion: { findMany: jest.fn() },
    };
    service = new AdminAlertEventsService(prisma, queue);
  });

  const runDailySummary = async (
    now: Date,
    conversions: any[] | ((query: any) => any[]) = [],
  ) => {
    prisma.adminAlertConfig.findMany.mockResolvedValue([
      { tenantId: 'tenant-a' },
    ]);
    prisma.publication.count.mockResolvedValue(0);
    prisma.clickEvent.count.mockResolvedValue(0);
    prisma.marketplaceConversion.findMany.mockImplementation((query: any) =>
      Promise.resolve(
        typeof conversions === 'function' ? conversions(query) : conversions,
      ),
    );
    prisma.adminAlert.upsert.mockResolvedValue({
      id: 'alert-a',
      createdAt: now,
      deliveryStatus: 'PENDING',
    });

    await service.scheduleDailySummaries(now);
    return prisma.adminAlert.upsert.mock.calls[
      prisma.adminAlert.upsert.mock.calls.length - 1
    ][0];
  };

  const conversionsInWindow =
    (rows: any[]) =>
    ({ where }: any) =>
      rows.filter(
        (row) =>
          row.createdAt > where.createdAt.gt &&
          row.createdAt <= where.createdAt.lte,
      );

  it('does not create a summary when the feature is disabled', async () => {
    prisma.adminAlertConfig.findMany.mockResolvedValue([]);

    await service.scheduleDailySummaries(new Date('2026-08-28T02:10:00.000Z'));

    expect(prisma.adminAlert.upsert).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('creates one deterministic zero-activity summary and queues its deliveries', async () => {
    prisma.adminAlertConfig.findMany.mockResolvedValue([
      { tenantId: 'tenant-a' },
    ]);
    prisma.adminAlertConfig.findUnique.mockResolvedValue({
      id: 'config-a',
      enabled: true,
      dailySummaryEnabled: true,
      criticalErrorEnabled: true,
      adminWhatsappIntegrationId: 'sender-a',
      enabledAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    prisma.publication.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    prisma.clickEvent.count.mockResolvedValue(0);
    prisma.marketplaceConversion.findMany.mockResolvedValue([]);
    prisma.channelIntegration.findFirst.mockResolvedValue({ id: 'sender-a' });
    prisma.adminAlertRecipient.findMany.mockResolvedValue([
      { id: 'recipient-a' },
    ]);
    prisma.adminAlert.upsert.mockResolvedValue({
      id: 'alert-a',
      createdAt: new Date('2026-08-28T02:10:00.000Z'),
      deliveryStatus: 'PENDING',
    });
    prisma.adminAlertDelivery.findMany.mockResolvedValue([
      { id: 'delivery-a' },
    ]);

    await service.scheduleDailySummaries(new Date('2026-08-28T02:10:00.000Z'));

    expect(prisma.adminAlert.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dedupeKey: 'daily-summary:tenant-a:2026-08-27' },
        create: expect.objectContaining({
          type: 'DAILY_SUMMARY',
          payload: expect.objectContaining({
            period: '2026-08-27',
            publications: 0,
            clicks: 0,
            sales: 0,
            commissionCents: 0,
          }),
        }),
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'deliver-admin-alert',
      { deliveryId: 'delivery-a' },
      expect.objectContaining({
        attempts: 5,
        backoff: { type: 'exponential', delay: 20_000 },
      }),
    );
  });

  it('uses the legacy configured recipient when no normalized recipient exists', async () => {
    prisma.adminAlertConfig.findMany.mockResolvedValue([
      { tenantId: 'tenant-a' },
    ]);
    prisma.adminAlertConfig.findUnique.mockResolvedValue({
      id: 'config-a',
      enabled: true,
      dailySummaryEnabled: true,
      adminWhatsappIntegrationId: 'sender-a',
      enabledAt: new Date('2026-08-01T00:00:00.000Z'),
      encryptedRecipient: 'encrypted-recipient',
      recipientIv: 'recipient-iv',
      recipientAuthTag: 'recipient-tag',
    });
    prisma.publication.count.mockResolvedValue(0);
    prisma.clickEvent.count.mockResolvedValue(0);
    prisma.marketplaceConversion.findMany.mockResolvedValue([]);
    prisma.channelIntegration.findFirst.mockResolvedValue({ id: 'sender-a' });
    prisma.adminAlertRecipient.findMany.mockResolvedValue([]);
    prisma.adminAlertRecipient.upsert.mockResolvedValue({
      id: 'legacy-recipient',
    });
    prisma.adminAlert.upsert.mockResolvedValue({
      id: 'alert-a',
      createdAt: new Date('2026-08-28T02:10:00.000Z'),
      deliveryStatus: 'PENDING',
    });
    prisma.adminAlertDelivery.findMany.mockResolvedValue([
      { id: 'delivery-a' },
    ]);

    await service.scheduleDailySummaries(new Date('2026-08-28T02:10:00.000Z'));

    expect(prisma.adminAlertRecipient.upsert).toHaveBeenCalled();
    expect(prisma.adminAlertDelivery.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [{ alertId: 'alert-a', recipientId: 'legacy-recipient' }],
      }),
    );
  });

  it('includes a Shopee conversion that arrived late in the creation day summary', async () => {
    const lateConversion = {
      createdAt: new Date('2026-08-28T14:15:00.696Z'),
      attributionStatus: 'ATTRIBUTED',
      totalCommissionCents: 1234,
      orders: [
        {
          items: [{ itemName: 'Produto tardio', actualAmountCents: 5000 }],
        },
      ],
    };

    const call = await runDailySummary(new Date('2026-08-29T02:10:00.000Z'), [
      lateConversion,
    ]);

    expect(call.create.payload).toEqual(
      expect.objectContaining({
        period: '2026-08-28',
        sales: 1,
        commissionCents: 1234,
        topProduct: 'Produto tardio',
      }),
    );
    const conversionQuery =
      prisma.marketplaceConversion.findMany.mock.calls[0][0];
    expect(conversionQuery.where.createdAt).toEqual({
      gt: new Date('2026-08-28T02:10:00.000Z'),
      lte: new Date('2026-08-29T02:10:00.000Z'),
    });
    expect(conversionQuery.where.purchaseTime).toBeUndefined();
  });

  it('does not count the same late conversion again on the following day', async () => {
    const lateConversion = {
      createdAt: new Date('2026-08-28T14:15:00.696Z'),
      attributionStatus: 'ATTRIBUTED',
      totalCommissionCents: 1234,
      orders: [],
    };
    await runDailySummary(
      new Date('2026-08-29T02:10:00.000Z'),
      conversionsInWindow([lateConversion]),
    );
    const call = await runDailySummary(
      new Date('2026-08-30T02:10:00.000Z'),
      conversionsInWindow([lateConversion]),
    );

    expect(call.create.payload).toEqual(
      expect.objectContaining({ period: '2026-08-29', sales: 0 }),
    );
    expect(
      prisma.marketplaceConversion.findMany.mock.calls[1][0].where.createdAt,
    ).toEqual({
      gt: new Date('2026-08-29T02:10:00.000Z'),
      lte: new Date('2026-08-30T02:10:00.000Z'),
    });
  });

  it('counts a conversion created on the same local day', async () => {
    const first = await runDailySummary(
      new Date('2026-08-29T02:10:00.000Z'),
      conversionsInWindow([
        {
          createdAt: new Date('2026-08-28T20:00:00.000Z'),
          attributionStatus: 'UNATTRIBUTED',
          totalCommissionCents: 999,
          orders: [],
        },
      ]),
    );
    const next = await runDailySummary(
      new Date('2026-08-30T02:10:00.000Z'),
      conversionsInWindow([
        {
          createdAt: new Date('2026-08-28T20:00:00.000Z'),
          attributionStatus: 'UNATTRIBUTED',
          totalCommissionCents: 999,
          orders: [],
        },
      ]),
    );

    expect(first.create.payload).toEqual(
      expect.objectContaining({ period: '2026-08-28', sales: 1 }),
    );
    expect(next.create.payload.sales).toBe(0);
  });

  it('moves an after-summary conversion into the next summary without a gap', async () => {
    const conversion = {
      createdAt: new Date('2026-08-29T02:35:00.000Z'),
      attributionStatus: 'UNATTRIBUTED',
      totalCommissionCents: 999,
      orders: [],
    };
    const first = await runDailySummary(
      new Date('2026-08-29T02:10:00.000Z'),
      conversionsInWindow([conversion]),
    );
    const next = await runDailySummary(
      new Date('2026-08-30T02:10:00.000Z'),
      conversionsInWindow([conversion]),
    );

    expect(first.create.payload.sales).toBe(0);
    expect(next.create.payload).toEqual(
      expect.objectContaining({ period: '2026-08-29', sales: 1 }),
    );
  });

  it('assigns an exact cutoff conversion to one summary only', async () => {
    const conversion = {
      createdAt: new Date('2026-08-29T02:10:00.000Z'),
      attributionStatus: 'UNATTRIBUTED',
      totalCommissionCents: 999,
      orders: [],
    };
    const first = await runDailySummary(
      new Date('2026-08-29T02:10:00.000Z'),
      conversionsInWindow([conversion]),
    );
    const next = await runDailySummary(
      new Date('2026-08-30T02:10:00.000Z'),
      conversionsInWindow([conversion]),
    );

    expect(first.create.payload.sales).toBe(1);
    expect(next.create.payload.sales).toBe(0);
  });

  it('keeps cancelled conversions out of the daily summary query', async () => {
    const cancelledConversion = {
      attributionStatus: 'ATTRIBUTED',
      totalCommissionCents: 1234,
      orders: [],
    };
    const call = await runDailySummary(
      new Date('2026-08-29T02:10:00.000Z'),
      ({ where }: any) =>
        where.commissionStatus?.not === 'CANCELLED'
          ? []
          : [cancelledConversion],
    );

    expect(
      prisma.marketplaceConversion.findMany.mock.calls[0][0].where
        .commissionStatus,
    ).toEqual({ not: 'CANCELLED' });
    expect(call.create.payload).toEqual(
      expect.objectContaining({ sales: 0, commissionCents: 0 }),
    );
  });

  it('uses the America/Campo_Grande local day for conversion boundaries', async () => {
    const call = await runDailySummary(new Date('2026-08-29T03:30:00.000Z'));

    expect(call.create.payload.period).toBe('2026-08-28');
    expect(
      prisma.marketplaceConversion.findMany.mock.calls[0][0].where.createdAt.gt,
    ).toEqual(new Date('2026-08-28T02:10:00.000Z'));
    expect(
      prisma.marketplaceConversion.findMany.mock.calls[0][0].where.createdAt
        .lte,
    ).toEqual(new Date('2026-08-29T02:10:00.000Z'));
  });

  it('accounts for a multi-day sequence exactly once per conversion', async () => {
    const conversions = [
      {
        id: 'd-21',
        createdAt: new Date('2026-08-29T01:00:00.000Z'),
        attributionStatus: 'UNATTRIBUTED',
        totalCommissionCents: 0,
        orders: [],
      },
      {
        id: 'd-22-35',
        createdAt: new Date('2026-08-29T02:35:00.000Z'),
        attributionStatus: 'UNATTRIBUTED',
        totalCommissionCents: 0,
        orders: [],
      },
      {
        id: 'd1-08',
        createdAt: new Date('2026-08-29T12:00:00.000Z'),
        attributionStatus: 'UNATTRIBUTED',
        totalCommissionCents: 0,
        orders: [],
      },
      {
        id: 'd1-22-20',
        createdAt: new Date('2026-08-30T02:20:00.000Z'),
        attributionStatus: 'UNATTRIBUTED',
        totalCommissionCents: 0,
        orders: [],
      },
    ];
    const seen: string[][] = [];
    const selectForWindow = ({ where }: any) => {
      const selected = conversionsInWindow(conversions)({ where });
      seen.push(selected.map((conversion) => conversion.id));
      return selected;
    };

    const first = await runDailySummary(
      new Date('2026-08-29T02:10:00.000Z'),
      selectForWindow,
    );
    const second = await runDailySummary(
      new Date('2026-08-30T02:10:00.000Z'),
      selectForWindow,
    );
    const third = await runDailySummary(
      new Date('2026-08-31T02:10:00.000Z'),
      selectForWindow,
    );

    expect([
      first.create.payload.sales,
      second.create.payload.sales,
      third.create.payload.sales,
    ]).toEqual([1, 2, 1]);
    expect(seen.flat()).toEqual(['d-21', 'd-22-35', 'd1-08', 'd1-22-20']);
  });

  it('suppresses a repeated incident within its sixty-minute cooldown', async () => {
    prisma.adminAlert.findFirst.mockResolvedValue({ id: 'previous-alert' });

    await expect(
      service.createShopeeDisconnectedAlert({
        tenantId: 'tenant-a',
        integrationId: 'integration-a',
        state: 'ERROR',
        now: new Date('2026-08-28T02:10:00.000Z'),
      }),
    ).resolves.toBeNull();

    expect(prisma.adminAlert.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          externalEventId: 'shopee:integration-a',
        }),
      }),
    );
    expect(prisma.adminAlert.upsert).not.toHaveBeenCalled();
  });
});
