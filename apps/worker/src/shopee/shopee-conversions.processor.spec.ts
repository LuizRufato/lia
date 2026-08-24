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
      await jest.runOnlyPendingTimersAsync();
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
