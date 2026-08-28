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
