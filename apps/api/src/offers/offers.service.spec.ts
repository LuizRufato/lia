import { Test, TestingModule } from '@nestjs/testing';
import { OffersService } from './offers.service';
import { PrismaService } from '../prisma.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';

jest.mock('@lia/integrations', () => {
  return {
    getEncryptionKey: jest
      .fn()
      .mockReturnValue(
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ),
    decryptSecret: jest.fn().mockReturnValue('mock-secret'),
    ShopeeAffiliateClient: jest.fn().mockImplementation(() => {
      return {
        generateShortLink: jest
          .fn()
          .mockImplementation(async (originUrl, subIds) => {
            if (originUrl.includes('error')) {
              const err = new Error(
                'Shopee GraphQL Error: Invalid affiliate id',
              );
              (err as any).code = 10032;
              throw err;
            }
            if (originUrl.includes('null-link')) {
              return { data: { generateShortLink: { shortLink: null } } };
            }
            return {
              data: {
                generateShortLink: { shortLink: 'https://shope.ee/mock' },
              },
            };
          }),
      };
    }),
  };
});

describe('OffersService', () => {
  let service: OffersService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OffersService,
        {
          provide: PrismaService,
          useValue: {
            offer: { findUnique: jest.fn() },
            affiliateLink: {
              create: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
            },
            marketplaceIntegration: { findUnique: jest.fn() },
            $transaction: jest
              .fn()
              .mockImplementation(async (cb) => cb(prisma)),
            monetizationRecord: { upsert: jest.fn() },
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('mock-master-key') },
        },
      ],
    }).compile();

    service = module.get<OffersService>(OffersService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should prevent Tenant A from accessing Tenant B offer', async () => {
    (prisma.offer.findUnique as jest.Mock).mockResolvedValue({
      tenantId: 'tenant-B',
    });
    await expect(
      service.verifyMonetization('tenant-A', 'offer-123'),
    ).rejects.toThrow(BadRequestException);
  });

  it('should be idempotent for same offer and context', async () => {
    (prisma.offer.findUnique as jest.Mock).mockResolvedValue({
      tenantId: 'tenant-A',
      url: 'https://shopee.com.br/product-cru',
      observations: [
        {
          canonicalPayload: {
            canonicalUrl: 'https://shopee.com.br/product-cru',
          },
        },
      ],
    });
    (prisma.affiliateLink.findUnique as jest.Mock).mockResolvedValue({
      status: 'VERIFIED',
      affiliateUrl: 'https://shope.ee/mock-existing',
    });

    const result = await service.verifyMonetization('tenant-A', 'offer-123');
    expect(result.status).toBe('VERIFIED');
    expect(result.affiliateUrl).toBe('https://shope.ee/mock-existing');
    expect(prisma.affiliateLink.create).not.toHaveBeenCalled();
    expect(prisma.affiliateLink.updateMany).not.toHaveBeenCalled();
  });

  it('should throw immediately if already VERIFYING', async () => {
    (prisma.offer.findUnique as jest.Mock).mockResolvedValue({
      tenantId: 'tenant-A',
      url: 'https://shopee.com.br/product-cru',
      observations: [
        {
          canonicalPayload: {
            canonicalUrl: 'https://shopee.com.br/product-cru',
          },
        },
      ],
    });
    (prisma.affiliateLink.findUnique as jest.Mock).mockResolvedValue({
      status: 'VERIFYING',
    });

    await expect(
      service.verifyMonetization('tenant-A', 'offer-123'),
    ).rejects.toThrow('Verificação já está em andamento para esta oferta.');
    expect(prisma.affiliateLink.create).not.toHaveBeenCalled();
  });

  it('should throw if GraphQL returns error and rollback state to FAILED', async () => {
    (prisma.offer.findUnique as jest.Mock).mockResolvedValue({
      tenantId: 'tenant-A',
      url: 'https://shopee.com.br/error-product',
      observations: [
        {
          canonicalPayload: {
            canonicalUrl: 'https://shopee.com.br/error-product',
          },
        },
      ],
    });

    // First call to findUnique returns null (not verified yet)
    // Second call to findUnique inside updateMany refresh returns the updated row
    (prisma.affiliateLink.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'link-123', attributionKey: 'key-123' });

    (prisma.affiliateLink.create as jest.Mock).mockResolvedValue({
      id: 'link-123',
      attributionKey: 'key-123',
    });

    (prisma.marketplaceIntegration.findUnique as jest.Mock).mockResolvedValue({
      publicIdentifier: 'app-id',
      encryptedSecret: 'enc',
      iv: 'iv',
      authTag: 'tag',
    });

    await expect(
      service.verifyMonetization('tenant-A', 'offer-123'),
    ).rejects.toThrow('Shopee GraphQL Error: Invalid affiliate id');

    // Check if status is set to FAILED in the catch block
    expect(prisma.affiliateLink.update).toHaveBeenCalledWith({
      where: { id: 'link-123' },
      data: { status: 'FAILED' },
    });
  });

  it('should prevent concurrent execution if create fails due to unique constraint', async () => {
    (prisma.offer.findUnique as jest.Mock).mockResolvedValue({
      tenantId: 'tenant-A',
      url: 'https://shopee.com.br/product-cru',
      observations: [
        {
          canonicalPayload: {
            canonicalUrl: 'https://shopee.com.br/product-cru',
          },
        },
      ],
    });
    (prisma.affiliateLink.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.affiliateLink.create as jest.Mock).mockRejectedValue(
      new Error('Unique constraint violation'),
    );

    await expect(
      service.verifyMonetization('tenant-A', 'offer-123'),
    ).rejects.toThrow('Verificação já iniciada concorrentemente.');
  });
});
