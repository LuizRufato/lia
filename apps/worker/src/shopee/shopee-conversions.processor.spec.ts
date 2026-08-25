const mockGetConversionReport = jest.fn();

jest.mock('@lia/integrations', () => ({
  SHOPEE_CONVERSION_CURSOR_DELAY_MS: 0,
  SHOPEE_CONVERSION_MAX_PAGES: 50,
  decryptSecret: jest.fn().mockReturnValue('secret'),
  isRetryableShopeeConversionError: jest.fn((error: any) => {
    const message = String(error?.message ?? '').toLowerCase();
    return (
      error?.code === 10030 ||
      error?.status === 429 ||
      Number(error?.status) >= 500 ||
      message.includes('rate limit') ||
      message.includes('timeout') ||
      (message.includes('scrollid') &&
        (message.includes('expire') ||
          message.includes('invalid') ||
          message.includes('cursor')))
    );
  }),
  ShopeeAffiliateClient: jest.fn().mockImplementation(() => ({
    getConversionReport: mockGetConversionReport,
  })),
}));

import { ShopeeConversionsProcessor } from './shopee-conversions.processor';

describe('ShopeeConversionsProcessor', () => {
  let prisma: any;
  let processor: ShopeeConversionsProcessor;

  const conversionNode = {
    conversionId: 'conversion-1',
    purchaseTime: 1_700_000_000,
    clickTime: 1_699_999_000,
    shopeeCommissionCapped: '1.00',
    sellerCommission: '2.00',
    totalCommission: '3.00',
    netCommission: '2.50',
    utmContent: ['lia', 'attribution-key'],
    buyerType: 1,
    device: 'mobile',
    campaignType: 'standard',
    orders: [
      {
        orderId: 'order-1',
        orderStatus: 'CANCELED',
        shopType: 'official',
        items: [
          {
            itemId: 'item-1',
            itemName: 'Produto',
            itemPrice: '10.00',
            actualAmount: '9.00',
            qty: 1,
            itemTotalCommission: '1.00',
            itemSellerCommission: '0.50',
            itemSellerCommissionRate: '0.1',
            itemShopeeCommissionCapped: '0.5',
            itemShopeeCommissionRate: '0.1',
            displayItemStatus: 'CANCELLED',
            fraudStatus: 'SAFE',
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConversionReport.mockResolvedValue({
      data: {
        conversionReport: {
          nodes: [conversionNode],
          pageInfo: { hasNextPage: false, scrollId: undefined, limit: 500 },
        },
      },
    });
    prisma = {
      marketplaceIntegration: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'integration-1',
          publicIdentifier: 'app-id',
          encryptedSecret: 'encrypted',
          iv: 'iv',
          authTag: 'tag',
          status: 'CONNECTED',
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      marketplaceConversion: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'conversion-db-1' }),
      },
      adminAlert: {
        upsert: jest.fn().mockResolvedValue({ id: 'alert-db-1' }),
      },
      affiliateLink: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'affiliate-1',
          offerId: 'offer-1',
        }),
      },
      marketplaceConversionOrder: {
        upsert: jest.fn().mockResolvedValue({ id: 'order-db-1' }),
      },
      marketplaceConversionItem: {
        upsert: jest.fn().mockResolvedValue({ id: 'item-db-1' }),
      },
    };
    processor = new ShopeeConversionsProcessor(prisma, {
      get: jest.fn().mockReturnValue('encryption-key'),
    } as any);
  });

  it('upserts conversions idempotently and excludes cancelled orders from confirmed commission', async () => {
    await processor.process({
      id: 'job-1',
      data: {
        tenantId: 'tenant-1',
        purchaseTimeStart: 1,
        purchaseTimeEnd: 2,
      },
    } as any);

    const upsert = prisma.marketplaceConversion.upsert.mock.calls[0][0];
    expect(upsert.create.commissionStatus).toBe('CANCELLED');
    expect(upsert.create.attributionStatus).toBe('ATTRIBUTED');
    expect(
      prisma.marketplaceConversionOrder.upsert.mock.calls[0][0].create
        .orderStatus,
    ).toBe('CANCELLED');
    expect(prisma.marketplaceIntegration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastConversionSyncAt: new Date(2 * 1000),
          lastConversionError: null,
        }),
      }),
    );

    expect(prisma.adminAlert.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          dedupeKey: 'tenant-1:NEW_SHOPEE_SALE:SHOPEE:conversion-1',
        },
        create: expect.objectContaining({
          type: 'NEW_SHOPEE_SALE',
          provider: 'SHOPEE',
          externalEventId: 'conversion-1',
          marketplaceConversionId: 'conversion-db-1',
          payload: expect.objectContaining({
            conversionId: 'conversion-1',
            commissionStatus: 'CANCELLED',
            orders: [
              expect.objectContaining({
                orderId: 'order-1',
                status: 'CANCELLED',
              }),
            ],
          }),
        }),
        update: {},
      }),
    );
  });

  it('keeps one alert for the same conversion across a repeated sync', async () => {
    const alerts = new Map<string, unknown>();
    prisma.marketplaceConversion.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'conversion-db-1',
        attributionStatus: 'UNATTRIBUTED',
        attributionKey: null,
        affiliateLinkId: null,
        offerId: null,
      });
    prisma.adminAlert.upsert.mockImplementation(async (args: any) => {
      alerts.set(args.where.dedupeKey, { id: 'alert-db-1' });
      return { id: 'alert-db-1' };
    });

    const job = {
      id: 'job-repeat',
      data: { tenantId: 'tenant-1', purchaseTimeStart: 1, purchaseTimeEnd: 2 },
    } as any;
    await processor.process(job);
    await processor.process(job);

    expect(alerts.size).toBe(1);
    expect(prisma.adminAlert.upsert).toHaveBeenCalledTimes(2);
  });

  it('creates the alert when a retry finds an existing conversion without an alert', async () => {
    prisma.marketplaceConversion.findUnique.mockResolvedValue({
      id: 'conversion-db-1',
      attributionStatus: 'UNATTRIBUTED',
      attributionKey: null,
      affiliateLinkId: null,
      offerId: null,
    });

    await processor.process({
      id: 'job-retry-alert',
      data: { tenantId: 'tenant-1', purchaseTimeStart: 1, purchaseTimeEnd: 2 },
    } as any);

    expect(prisma.adminAlert.upsert).toHaveBeenCalledTimes(1);
  });

  it('stores all conversion items in the alert payload', async () => {
    const secondItem = {
      ...conversionNode.orders[0].items[0],
      itemId: 'item-2',
      itemName: 'Segundo produto',
      qty: 2,
      itemPrice: '4.00',
      actualAmount: '3.50',
    };
    const nodeWithTwoItems = {
      ...conversionNode,
      orders: [
        {
          ...conversionNode.orders[0],
          items: [conversionNode.orders[0].items[0], secondItem],
        },
      ],
    };
    mockGetConversionReport.mockResolvedValueOnce({
      data: {
        conversionReport: {
          nodes: [nodeWithTwoItems],
          pageInfo: { hasNextPage: false, scrollId: undefined, limit: 500 },
        },
      },
    });

    await processor.process({
      id: 'job-items',
      data: { tenantId: 'tenant-1', purchaseTimeStart: 1, purchaseTimeEnd: 2 },
    } as any);

    const payload = prisma.adminAlert.upsert.mock.calls[0][0].create.payload;
    expect(payload.orders[0].items).toEqual([
      expect.objectContaining({ itemName: 'Produto', qty: 1 }),
      expect.objectContaining({
        itemName: 'Segundo produto',
        qty: 2,
        itemPriceCents: 400,
        actualAmountCents: 350,
      }),
    ]);
  });

  it('does not create an alert when conversion persistence fails before orders and items', async () => {
    prisma.marketplaceConversion.upsert.mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    await expect(
      processor.process({
        id: 'job-conversion-failure',
        data: {
          tenantId: 'tenant-1',
          purchaseTimeStart: 1,
          purchaseTimeEnd: 2,
        },
      } as any),
    ).rejects.toThrow('database unavailable');

    expect(prisma.adminAlert.upsert).not.toHaveBeenCalled();
    expect(prisma.marketplaceConversionOrder.upsert).not.toHaveBeenCalled();
    expect(prisma.marketplaceConversionItem.upsert).not.toHaveBeenCalled();
  });

  it('fails and remains retryable when alert persistence fails', async () => {
    prisma.adminAlert.upsert.mockRejectedValueOnce(
      new Error('alert database unavailable'),
    );

    await expect(
      processor.process({
        id: 'job-alert-failure',
        data: {
          tenantId: 'tenant-1',
          purchaseTimeStart: 1,
          purchaseTimeEnd: 2,
        },
      } as any),
    ).rejects.toThrow('Admin alert persistence failed');

    expect(prisma.marketplaceConversion.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.marketplaceConversionItem.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.marketplaceIntegration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastConversionError: expect.stringContaining(
            'Admin alert persistence failed',
          ),
        }),
      }),
    );
  });

  it('enqueues one deterministic admin-alert job for an eligible sale', async () => {
    const jobs = new Map<string, unknown>();
    const adminAlertsQueue = {
      add: jest.fn(async (_name: string, data: any, options: any) => {
        jobs.set(String(options.jobId), data);
        return { id: options.jobId };
      }),
    };
    prisma.adminAlert.upsert.mockResolvedValue({
      id: 'alert-db-1',
      createdAt: new Date('2026-08-24T20:01:00.000Z'),
      deliveryStatus: 'NOT_REQUESTED',
    });
    prisma.adminAlertConfig = {
      findUnique: jest.fn().mockResolvedValue({
        enabled: true,
        newShopeeSaleEnabled: true,
        encryptedRecipient: 'encrypted-recipient',
        recipientIv: 'recipient-iv',
        recipientAuthTag: 'recipient-tag',
        adminWhatsappIntegrationId: 'sender-a',
        enabledAt: new Date('2026-08-24T20:00:00.000Z'),
      }),
    };
    prisma.channelIntegration = {
      findFirst: jest.fn().mockResolvedValue({ id: 'sender-a' }),
    };
    prisma.adminAlert.updateMany = jest.fn().mockResolvedValue({ count: 1 });

    const queuedProcessor = new ShopeeConversionsProcessor(
      prisma,
      { get: jest.fn().mockReturnValue('encryption-key') } as any,
      adminAlertsQueue as any,
    );
    const job = {
      id: 'job-queue',
      data: { tenantId: 'tenant-1', purchaseTimeStart: 1, purchaseTimeEnd: 2 },
    } as any;

    await queuedProcessor.process(job);
    await queuedProcessor.process(job);

    expect(prisma.adminAlert.upsert).toHaveBeenCalledTimes(2);
    expect(adminAlertsQueue.add).toHaveBeenCalledTimes(2);
    expect(jobs.size).toBe(1);
    expect([...jobs.keys()][0]).toBe('admin-alert-alert-db-1');
    expect([...jobs.values()][0]).toEqual({ alertId: 'alert-db-1' });
  });

  it('re-enqueues pending and failed deliveries with one safe job per delivery', async () => {
    const adminAlertsQueue = { add: jest.fn().mockResolvedValue({}) };
    prisma.adminAlert.upsert.mockResolvedValue({
      id: 'alert-db-1',
      createdAt: new Date('2026-08-24T20:01:00.000Z'),
      deliveryStatus: 'PENDING',
    });
    prisma.adminAlertConfig = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'config-1',
        enabled: true,
        newShopeeSaleEnabled: true,
        adminWhatsappIntegrationId: 'sender-a',
        enabledAt: new Date('2026-08-24T20:00:00.000Z'),
      }),
    };
    prisma.channelIntegration = {
      findFirst: jest.fn().mockResolvedValue({ id: 'sender-a' }),
    };
    prisma.adminAlertRecipient = {
      upsert: jest.fn(),
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'recipient-1' }, { id: 'recipient-2' }]),
    };
    prisma.adminAlertDelivery = {
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'delivery-1' }, { id: 'delivery-2' }]),
    };
    prisma.adminAlert.update = jest.fn().mockResolvedValue(undefined);

    const queuedProcessor = new ShopeeConversionsProcessor(
      prisma,
      { get: jest.fn().mockReturnValue('encryption-key') } as any,
      adminAlertsQueue as any,
    );

    await queuedProcessor.process({
      id: 'job-deliveries',
      data: { tenantId: 'tenant-1', purchaseTimeStart: 1, purchaseTimeEnd: 2 },
    } as any);

    expect(adminAlertsQueue.add).toHaveBeenCalledTimes(2);
    expect(
      adminAlertsQueue.add.mock.calls.map((call: any[]) => call[2].jobId),
    ).toEqual([
      'admin-alert-alert-db-1-delivery-delivery-1',
      'admin-alert-alert-db-1-delivery-delivery-2',
    ]);
    expect(
      prisma.adminAlertDelivery.findMany.mock.calls[0][0].where.status,
    ).toEqual({ in: ['PENDING', 'FAILED'] });
    expect(
      adminAlertsQueue.add.mock.calls.every((call: any[]) =>
        call[2].jobId.includes(':'),
      ),
    ).toBe(false);
  });

  it('does not enqueue a delivery when the alert is already SENT', async () => {
    const adminAlertsQueue = { add: jest.fn() };
    prisma.adminAlert.upsert.mockResolvedValue({
      id: 'alert-db-1',
      createdAt: new Date('2026-08-24T20:01:00.000Z'),
      deliveryStatus: 'SENT',
    });

    const queuedProcessor = new ShopeeConversionsProcessor(
      prisma,
      { get: jest.fn().mockReturnValue('encryption-key') } as any,
      adminAlertsQueue as any,
    );

    await queuedProcessor.process({
      id: 'job-sent-alert',
      data: { tenantId: 'tenant-1', purchaseTimeStart: 1, purchaseTimeEnd: 2 },
    } as any);

    expect(adminAlertsQueue.add).not.toHaveBeenCalled();
  });

  it('extracts the attribution key from the real Shopee utmContent string format', async () => {
    const attributionKey = '0123456789abcdef0123456789abcdef';
    mockGetConversionReport.mockResolvedValueOnce({
      data: {
        conversionReport: {
          nodes: [
            {
              ...conversionNode,
              utmContent: `lia-${attributionKey}---`,
            },
          ],
          pageInfo: { hasNextPage: false, scrollId: undefined, limit: 500 },
        },
      },
    });

    await processor.process({
      id: 'job-real-utm-format',
      data: { tenantId: 'tenant-1', purchaseTimeStart: 1, purchaseTimeEnd: 2 },
    } as any);

    expect(prisma.affiliateLink.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', attributionKey },
    });
    expect(prisma.marketplaceConversion.upsert.mock.calls[0][0].create).toEqual(
      expect.objectContaining({
        attributionKey,
        attributionStatus: 'ATTRIBUTED',
      }),
    );
  });

  it('allows UNATTRIBUTED to become ATTRIBUTED but never regresses it', async () => {
    prisma.marketplaceConversion.findUnique
      .mockResolvedValueOnce({
        id: 'conversion-db-1',
        attributionStatus: 'UNATTRIBUTED',
        attributionKey: null,
        affiliateLinkId: null,
        offerId: null,
      })
      .mockResolvedValueOnce({
        id: 'conversion-db-1',
        attributionStatus: 'ATTRIBUTED',
        attributionKey: 'old-key',
        affiliateLinkId: 'old-link',
        offerId: 'old-offer',
      });
    prisma.affiliateLink.findFirst
      .mockResolvedValueOnce({ id: 'affiliate-1', offerId: 'offer-1' })
      .mockResolvedValueOnce(null);

    const job = {
      id: 'job-2',
      data: { tenantId: 'tenant-1', purchaseTimeStart: 1, purchaseTimeEnd: 2 },
    } as any;
    await processor.process(job);
    await processor.process(job);

    const secondUpdate =
      prisma.marketplaceConversion.upsert.mock.calls[1][0].update;
    expect(secondUpdate.attributionStatus).toBeUndefined();
    expect(secondUpdate.attributionKey).toBeUndefined();
    expect(secondUpdate.affiliateLinkId).toBeUndefined();
  });

  it('fetches the next page before the current page finishes persistence', async () => {
    jest.useFakeTimers();
    let releasePersistence!: () => void;
    const persistenceGate = new Promise<{ id: string }>((resolve) => {
      releasePersistence = () => resolve({ id: 'conversion-db-1' });
    });
    const secondNode = { ...conversionNode, conversionId: 'conversion-2' };
    mockGetConversionReport
      .mockReset()
      .mockResolvedValueOnce({
        data: {
          conversionReport: {
            nodes: [conversionNode],
            pageInfo: { hasNextPage: true, scrollId: 'cursor-1', limit: 500 },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          conversionReport: {
            nodes: [secondNode],
            pageInfo: { hasNextPage: false, scrollId: undefined, limit: 500 },
          },
        },
      });
    prisma.marketplaceConversion.upsert.mockImplementationOnce(
      () => persistenceGate,
    );

    const processing = processor.process({
      id: 'job-pipeline',
      data: { tenantId: 'tenant-1', purchaseTimeStart: 1, purchaseTimeEnd: 2 },
    } as any);

    try {
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(0);
      expect(mockGetConversionReport).toHaveBeenCalledTimes(2);
      expect(prisma.marketplaceConversion.upsert).toHaveBeenCalledTimes(1);

      releasePersistence();
      await processing;

      expect(prisma.marketplaceIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastConversionSyncAt: new Date(2 * 1000),
            lastConversionError: null,
          }),
        }),
      );
    } finally {
      releasePersistence();
      await processing.catch(() => undefined);
      jest.useRealTimers();
    }
  });

  it('acquires page 3 before page 1 persistence finishes', async () => {
    let releasePersistence!: () => void;
    const persistenceGate = new Promise<{ id: string }>((resolve) => {
      releasePersistence = () => resolve({ id: 'conversion-db-1' });
    });
    const secondNode = { ...conversionNode, conversionId: 'conversion-2' };
    const thirdNode = { ...conversionNode, conversionId: 'conversion-3' };
    mockGetConversionReport
      .mockReset()
      .mockResolvedValueOnce({
        data: {
          conversionReport: {
            nodes: [conversionNode],
            pageInfo: { hasNextPage: true, scrollId: 'cursor-1', limit: 500 },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          conversionReport: {
            nodes: [secondNode],
            pageInfo: { hasNextPage: true, scrollId: 'cursor-2', limit: 500 },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          conversionReport: {
            nodes: [thirdNode],
            pageInfo: { hasNextPage: false, scrollId: undefined, limit: 500 },
          },
        },
      });
    prisma.marketplaceConversion.upsert.mockImplementationOnce(
      () => persistenceGate,
    );

    const processing = processor.process({
      id: 'job-three-pages',
      data: { tenantId: 'tenant-1', purchaseTimeStart: 1, purchaseTimeEnd: 2 },
    } as any);

    try {
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(mockGetConversionReport).toHaveBeenCalledTimes(3);
      expect(mockGetConversionReport.mock.calls[2][3]).toBe('cursor-2');
      expect(prisma.marketplaceConversion.upsert).toHaveBeenCalledTimes(1);

      releasePersistence();
      await processing;
    } finally {
      releasePersistence();
      await processing.catch(() => undefined);
    }
  });

  it('does not checkpoint when persistence fails after future pages were acquired', async () => {
    const persistenceError = new Error('database unavailable');
    const secondNode = { ...conversionNode, conversionId: 'conversion-2' };
    mockGetConversionReport
      .mockReset()
      .mockResolvedValueOnce({
        data: {
          conversionReport: {
            nodes: [conversionNode],
            pageInfo: { hasNextPage: true, scrollId: 'cursor-1', limit: 500 },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          conversionReport: {
            nodes: [secondNode],
            pageInfo: { hasNextPage: false, scrollId: undefined, limit: 500 },
          },
        },
      });
    prisma.marketplaceConversion.upsert.mockRejectedValueOnce(persistenceError);

    await expect(
      processor.process({
        id: 'job-persistence-failure',
        data: {
          tenantId: 'tenant-1',
          purchaseTimeStart: 1,
          purchaseTimeEnd: 2,
        },
      } as any),
    ).rejects.toThrow('database unavailable');

    expect(mockGetConversionReport).toHaveBeenCalledTimes(2);
    expect(prisma.marketplaceIntegration.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastConversionSyncAt: expect.any(Date),
        }),
      }),
    );
  });

  it('does not checkpoint when hasNextPage is true without a cursor', async () => {
    mockGetConversionReport.mockReset().mockResolvedValueOnce({
      data: {
        conversionReport: {
          nodes: [conversionNode],
          pageInfo: { hasNextPage: true, scrollId: undefined, limit: 500 },
        },
      },
    });

    await expect(
      processor.process({
        id: 'job-missing-cursor',
        data: {
          tenantId: 'tenant-1',
          purchaseTimeStart: 1,
          purchaseTimeEnd: 2,
        },
      } as any),
    ).rejects.toThrow('hasNextPage=true without scrollId');

    expect(prisma.marketplaceIntegration.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastConversionSyncAt: expect.any(Date),
        }),
      }),
    );
  });

  it('restarts a legacy cursor job from the root after cursor expiry', async () => {
    const error = new Error('invalid or expired scrollId');
    const updateData = jest.fn().mockResolvedValue(undefined);
    mockGetConversionReport.mockReset().mockRejectedValueOnce(error);

    await expect(
      processor.process({
        id: 'job-expired-cursor',
        data: {
          tenantId: 'tenant-1',
          purchaseTimeStart: 1,
          purchaseTimeEnd: 2,
          scrollId: 'expired-cursor',
          pageCount: 1,
        },
        updateData,
      } as any),
    ).rejects.toThrow('invalid or expired scrollId');

    expect(updateData).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      purchaseTimeStart: 1,
      purchaseTimeEnd: 2,
    });
    expect(prisma.marketplaceIntegration.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastConversionSyncAt: expect.any(Date),
        }),
      }),
    );
  });

  it('retries an expired continuation cursor from the root window', async () => {
    const error = new Error('invalid or expired scrollId cursor');
    mockGetConversionReport
      .mockReset()
      .mockResolvedValueOnce({
        data: {
          conversionReport: {
            nodes: [conversionNode],
            pageInfo: { hasNextPage: true, scrollId: 'cursor-1', limit: 500 },
          },
        },
      })
      .mockRejectedValueOnce(error);

    await expect(
      processor.process({
        id: 'job-expired-continuation',
        data: {
          tenantId: 'tenant-1',
          purchaseTimeStart: 1,
          purchaseTimeEnd: 2,
        },
      } as any),
    ).rejects.toBe(error);

    expect(prisma.marketplaceIntegration.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastConversionSyncAt: expect.any(Date),
        }),
      }),
    );
  });

  it.each([
    ['429', Object.assign(new Error('rate limit exceeded'), { status: 429 })],
    ['timeout', new Error('request timeout')],
    ['5xx', Object.assign(new Error('upstream failure'), { status: 503 })],
  ])(
    'does not checkpoint after a %s on a continuation page',
    async (_label, error) => {
      mockGetConversionReport
        .mockReset()
        .mockResolvedValueOnce({
          data: {
            conversionReport: {
              nodes: [conversionNode],
              pageInfo: { hasNextPage: true, scrollId: 'cursor-1', limit: 500 },
            },
          },
        })
        .mockRejectedValueOnce(error);

      await expect(
        processor.process({
          id: `job-${_label}`,
          data: {
            tenantId: 'tenant-1',
            purchaseTimeStart: 1,
            purchaseTimeEnd: 2,
          },
        } as any),
      ).rejects.toBe(error);

      expect(prisma.marketplaceIntegration.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastConversionSyncAt: expect.any(Date),
          }),
        }),
      );
    },
  );

  it('fails safely instead of succeeding when the page guard is reached', async () => {
    let requestCount = 0;
    mockGetConversionReport.mockReset().mockImplementation(async () => {
      requestCount++;
      return {
        data: {
          conversionReport: {
            nodes: [],
            pageInfo: {
              hasNextPage: true,
              scrollId: `cursor-${requestCount}`,
              limit: 500,
            },
          },
        },
      };
    });

    await expect(
      processor.process({
        id: 'job-page-guard',
        data: {
          tenantId: 'tenant-1',
          purchaseTimeStart: 1,
          purchaseTimeEnd: 2,
        },
      } as any),
    ).rejects.toThrow('page guard reached');

    expect(requestCount).toBe(51);
    expect(prisma.marketplaceIntegration.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastConversionSyncAt: expect.any(Date),
        }),
      }),
    );
  });

  it('retries a Shopee rate-limit response and records the safe error', async () => {
    const error = Object.assign(new Error('Rate limit exceeded'), {
      code: 10030,
    });
    mockGetConversionReport.mockRejectedValueOnce(error);

    await expect(
      processor.process({
        id: 'job-rate-limit',
        data: {
          tenantId: 'tenant-1',
          purchaseTimeStart: 1,
          purchaseTimeEnd: 2,
        },
      } as any),
    ).rejects.toBe(error);

    expect(prisma.marketplaceIntegration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { lastConversionError: 'Rate limit exceeded' },
      }),
    );
  });

  it('retries a timeout response without advancing the successful window', async () => {
    const error = new Error('request timeout');
    mockGetConversionReport.mockRejectedValueOnce(error);

    await expect(
      processor.process({
        id: 'job-timeout',
        data: {
          tenantId: 'tenant-1',
          purchaseTimeStart: 1,
          purchaseTimeEnd: 2,
        },
      } as any),
    ).rejects.toBe(error);

    expect(prisma.marketplaceIntegration.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastConversionSyncAt: expect.any(Date),
        }),
      }),
    );
  });
});
