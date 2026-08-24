const mockGetConversionReport = jest.fn();

jest.mock('@lia/integrations', () => ({
  decryptSecret: jest.fn().mockReturnValue('secret'),
  isRetryableShopeeConversionError: jest.fn((error: any) => {
    const message = String(error?.message ?? '').toLowerCase();
    return (
      error?.code === 10030 ||
      message.includes('rate limit') ||
      message.includes('timeout')
    );
  }),
  ShopeeAffiliateClient: jest.fn().mockImplementation(() => ({
    getConversionReport: mockGetConversionReport,
  })),
}));

import { ShopeeConversionsProcessor } from './shopee-conversions.processor';

describe('ShopeeConversionsProcessor', () => {
  const queue = { add: jest.fn() };
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
    processor = new ShopeeConversionsProcessor(
      prisma,
      { get: jest.fn().mockReturnValue('encryption-key') } as any,
      queue as any,
    );
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
