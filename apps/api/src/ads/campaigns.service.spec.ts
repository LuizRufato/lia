import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';

describe('CampaignsService', () => {
  const baseCampaign: any = {
    id: 'campaign-a',
    tenantId: 'tenant-a',
    advertiserId: 'advertiser-a',
    offerId: 'offer-a',
    name: 'Campanha',
    status: 'DRAFT',
    bidCpcCents: 100,
    totalBudgetCents: 10000,
    dailyBudgetCents: 2000,
    startAt: new Date('2026-08-28T09:00:00.000Z'),
    endAt: new Date('2026-08-30T09:00:00.000Z'),
    advertiser: { id: 'advertiser-a', name: 'Anunciante', status: 'ACTIVE' },
    offer: {
      id: 'offer-a',
      title: 'Oferta Shopee',
      price: 1000,
      imageUrl: null,
      status: 'ACTIVE',
      marketplace: { type: 'SHOPEE' },
    },
    submittedAt: null,
    approvedAt: null,
    rejectionReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function makeService() {
    const prisma: any = {
      advertiser: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            id: 'advertiser-a',
            tenantId: 'tenant-a',
            status: 'ACTIVE',
          }),
      },
      offer: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            id: 'offer-a',
            tenantId: 'tenant-a',
            title: 'Oferta',
            externalId: 'external-a',
            url: 'https://shopee.test/offer',
            status: 'ACTIVE',
            marketplace: { type: 'SHOPEE' },
          }),
      },
      adCampaign: {
        findFirst: jest.fn().mockResolvedValue(baseCampaign),
        update: jest
          .fn()
          .mockImplementation(({ data }: any) => ({
            ...baseCampaign,
            ...data,
          })),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) => ({
            ...baseCampaign,
            ...data,
          })),
      },
      $transaction: jest.fn((callback: (tx: any) => unknown) =>
        callback(prisma),
      ),
    };
    const audit = { record: jest.fn() } as any;
    return { service: new CampaignsService(prisma, audit), prisma, audit };
  }

  it('creates only valid Shopee campaigns with the selected real offer', async () => {
    const { service, prisma, audit } = makeService();
    prisma.adCampaign.create.mockResolvedValue({ ...baseCampaign });
    const result = await service.create('tenant-a', 'admin-a', 'OWNER', {
      name: ' Campanha ',
      advertiserId: 'advertiser-a',
      offerId: 'offer-a',
      bidCpcCents: 100,
      totalBudgetCents: 10000,
      dailyBudgetCents: 2000,
      startAt: '2026-08-28T09:00:00.000Z',
      endAt: '2026-08-30T09:00:00.000Z',
    });
    expect(result.offer.marketplace.type).toBe('SHOPEE');
    expect(prisma.adCampaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          marketplace: 'SHOPEE',
          placement: 'PUBLIC_SEARCH',
          pricingModel: 'CPC',
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'CAMPAIGN_CREATED' }),
    );
  });

  it('rejects invalid budgets, dates, non-Shopee offers, and cross-tenant references', async () => {
    const { service, prisma } = makeService();
    const input: any = {
      name: 'Campanha',
      advertiserId: 'advertiser-a',
      offerId: 'offer-a',
      bidCpcCents: 100,
      totalBudgetCents: 1000,
      dailyBudgetCents: 2000,
      startAt: '2026-08-30T09:00:00.000Z',
      endAt: '2026-08-28T09:00:00.000Z',
    };
    await expect(
      service.create('tenant-a', 'admin-a', 'OWNER', input),
    ).rejects.toBeInstanceOf(BadRequestException);
    prisma.offer.findFirst.mockResolvedValue({
      ...input,
      id: 'offer-ml',
      title: 'Meli',
      externalId: 'ml',
      url: 'https://meli.test',
      status: 'ACTIVE',
      marketplace: { type: 'MERCADO_LIVRE' },
    });
    await expect(
      service.create('tenant-a', 'admin-a', 'OWNER', {
        ...input,
        dailyBudgetCents: 500,
        startAt: '2026-08-28T09:00:00.000Z',
        endAt: '2026-08-30T09:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    prisma.offer.findFirst.mockResolvedValue(null);
    await expect(
      service.create('tenant-a', 'admin-a', 'OWNER', {
        ...input,
        dailyBudgetCents: 500,
        startAt: '2026-08-28T09:00:00.000Z',
        endAt: '2026-08-30T09:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('enforces explicit campaign transitions', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.submit('tenant-a', 'admin-a', 'OWNER', 'campaign-a'),
    ).resolves.toBeDefined();
    prisma.adCampaign.findFirst.mockResolvedValue({
      ...baseCampaign,
      status: 'ACTIVE',
    });
    await expect(
      service.submit('tenant-a', 'admin-a', 'OWNER', 'campaign-a'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
