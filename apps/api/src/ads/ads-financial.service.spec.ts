import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AdsFinancialService } from './ads-financial.service';

describe('AdsFinancialService', () => {
  const advertiser = { id: 'advertiser-a', tenantId: 'tenant-a' };

  function makeService() {
    const prisma: any = {
      advertiser: { findFirst: jest.fn().mockResolvedValue(advertiser) },
      adBillingEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockResolvedValue({
            id: 'event-1',
            tenantId: 'tenant-a',
            advertiserId: 'advertiser-a',
            amountCents: 10000,
          }),
      },
      advertiserBalance: {
        upsert: jest.fn().mockResolvedValue({ availableCents: 10000 }),
      },
      $transaction: jest.fn((callback: (tx: any) => unknown) =>
        callback(prisma),
      ),
    };
    const audit = { record: jest.fn() } as any;
    return { service: new AdsFinancialService(prisma, audit), prisma, audit };
  }

  const credit = {
    amountCents: 10000,
    reason: 'Crédito de teste',
    idempotencyKey: 'credit-1',
  };

  it('adds R$100 as 10000 cents and records the projection atomically', async () => {
    const { service, prisma, audit } = makeService();

    await expect(
      service.addCredit('tenant-a', 'admin-a', 'OWNER', 'advertiser-a', credit),
    ).resolves.toMatchObject({ status: 'CREATED', amountCents: 10000 });
    expect(prisma.adBillingEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'CREDIT',
          amountCents: 10000,
          currency: 'BRL',
        }),
      }),
    );
    expect(prisma.advertiserBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          availableCents: { increment: 10000 },
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'CREDIT_ADDED' }),
    );
  });

  it('does not credit twice when the idempotency key is reused', async () => {
    const { service, prisma } = makeService();
    prisma.adBillingEvent.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'event-1',
        tenantId: 'tenant-a',
        advertiserId: 'advertiser-a',
        amountCents: 10000,
      });

    await service.addCredit(
      'tenant-a',
      'admin-a',
      'OWNER',
      'advertiser-a',
      credit,
    );
    await expect(
      service.addCredit('tenant-a', 'admin-a', 'OWNER', 'advertiser-a', credit),
    ).resolves.toMatchObject({ status: 'DUPLICATE', balanceChanged: false });
    expect(prisma.adBillingEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.advertiserBalance.upsert).toHaveBeenCalledTimes(1);
  });

  it('returns the existing event after a concurrent unique-key race', async () => {
    const { service, prisma } = makeService();
    prisma.adBillingEvent.create.mockRejectedValueOnce({ code: 'P2002' });
    prisma.adBillingEvent.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'event-race',
        tenantId: 'tenant-a',
        advertiserId: 'advertiser-a',
        amountCents: 10000,
      });

    await expect(
      service.addCredit('tenant-a', 'admin-a', 'ADMIN', 'advertiser-a', credit),
    ).resolves.toMatchObject({ status: 'DUPLICATE', eventId: 'event-race' });
  });

  it('rejects invalid amounts, unauthorized roles, and cross-tenant advertisers', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.addCredit(
        'tenant-a',
        'admin-a',
        'VIEWER',
        'advertiser-a',
        credit,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.addCredit('tenant-a', 'admin-a', 'OWNER', 'advertiser-a', {
        ...credit,
        amountCents: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    prisma.advertiser.findFirst.mockResolvedValue(null);
    await expect(
      service.addCredit('tenant-b', 'admin-b', 'OWNER', 'advertiser-a', credit),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
