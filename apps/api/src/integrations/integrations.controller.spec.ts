import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { PrismaService } from '../prisma.service';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
const mockShopeeGetProductOfferV2 = jest.fn();

jest.mock('@lia/integrations', () => ({
  encryptSecret: jest.fn(),
  getEncryptionKey: jest
    .fn()
    .mockReturnValue(
      '0123456789012345678901234567890101234567890123456789012345678901',
    ),
  ShopeeAffiliateClient: jest.fn().mockImplementation(() => ({
    getProductOfferV2: mockShopeeGetProductOfferV2,
  })),
  WhatsAppCloudProvider: jest.fn().mockImplementation(() => ({
    testConnection: jest.fn().mockResolvedValue(true),
  })),
}));

import { encryptSecret, getEncryptionKey } from '@lia/integrations';

describe('IntegrationsController Security', () => {
  let controller: IntegrationsController;
  let service: IntegrationsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    mockShopeeGetProductOfferV2.mockResolvedValue({});
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntegrationsController],
      providers: [
        IntegrationsService,
        {
          provide: PrismaService,
          useValue: {
            marketplaceIntegration: {
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest
              .fn()
              .mockReturnValue(
                '1234567890123456789012345678901212345678901234567890123456789012',
              ), // 64 chars
          },
        },
        {
          provide: getQueueToken('shopee-api-queue'),
          useValue: {
            add: jest.fn(),
          },
        },
        {
          provide: getQueueToken('shopee-conversions-queue'),
          useValue: {
            add: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<IntegrationsController>(IntegrationsController);
    service = module.get<IntegrationsService>(IntegrationsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should NEVER return the app secret or encrypted secret to the frontend', async () => {
    (encryptSecret as jest.Mock).mockReturnValue({
      encryptedSecret: 'mocked-secret-data',
      iv: 'mocked-iv',
      authTag: 'mocked-tag',
    });

    jest.spyOn(prisma.marketplaceIntegration, 'findUnique').mockResolvedValue({
      id: 'integration-id',
      tenantId: 'tenant-123',
      provider: 'SHOPEE',
      publicIdentifier: 'app-id-123',
      encryptedSecret: 'some-encrypted-hex-value-that-should-never-leak',
      iv: 'iv-value',
      authTag: 'auth-tag-value',
      keyVersion: 1,
      status: 'CONNECTED',
      lastSyncAt: new Date(),
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const result = await controller.getShopee({
      user: { tenantId: 'tenant-123' },
    });

    expect(result.status).toBe('CONNECTED');
    expect(result.appId).toBe('app-id-123');
    // Security check: ensure no secret or encrypted representation leaked
    expect((result as any).encryptedSecret).toBeUndefined();
    expect((result as any).iv).toBeUndefined();
    expect((result as any).authTag).toBeUndefined();
    expect((result as any).appSecret).toBeUndefined();

    // Explicit stringify check
    const jsonStr = JSON.stringify(result);
    expect(jsonStr).not.toContain(
      'some-encrypted-hex-value-that-should-never-leak',
    );
  });

  it('should successfully save App ID larger than Int32 (11+ digits)', async () => {
    // Int32 max is 2147483647 (10 digits). We test with 12 digits to ensure it's handled as string.
    const largeAppId = '999999999999';
    const fakeSecret = 'fake-secret-string';

    const upsertSpy = jest.fn().mockResolvedValue({
      id: 'integration-id',
      tenantId: 'tenant-123',
      provider: 'SHOPEE',
      publicIdentifier: largeAppId,
      status: 'CONNECTED',
    } as any);

    prisma.marketplaceIntegration.upsert = upsertSpy;

    const result = await controller.connectShopee(
      { user: { tenantId: 'tenant-123' } },
      { appId: largeAppId, appSecret: fakeSecret },
    );

    expect(result.success).toBe(true);
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          publicIdentifier: largeAppId,
        }),
        create: expect.objectContaining({
          publicIdentifier: largeAppId,
        }),
      }),
    );
    expect(mockShopeeGetProductOfferV2).toHaveBeenCalledWith(1, 1);
  });

  it('must not replace a known-good integration when current credentials fail', async () => {
    const existing = {
      id: 'integration-id',
      tenantId: 'tenant-123',
      provider: 'SHOPEE',
      publicIdentifier: 'known-good-app',
      encryptedSecret: 'encrypted',
      iv: 'iv',
      authTag: 'tag',
      status: 'CONNECTED',
    };
    (prisma.marketplaceIntegration.findUnique as jest.Mock).mockResolvedValue(
      existing,
    );
    prisma.marketplaceIntegration.update = jest.fn();
    prisma.marketplaceIntegration.upsert = jest.fn();
    mockShopeeGetProductOfferV2.mockRejectedValue(
      new Error('Authentication/Credential Error: invalid credentials'),
    );

    await expect(
      controller.connectShopee(
        { user: { tenantId: 'tenant-123' } },
        { appId: 'new-app', appSecret: 'wrong-secret' },
      ),
    ).rejects.toThrow('Authentication/Credential Error');

    expect(prisma.marketplaceIntegration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: existing.id },
        data: expect.objectContaining({ lastError: expect.any(String) }),
      }),
    );
    expect(prisma.marketplaceIntegration.upsert).not.toHaveBeenCalled();
  });

  it('stores a failed first attempt as ERROR, never CONNECTED', async () => {
    (prisma.marketplaceIntegration.findUnique as jest.Mock).mockResolvedValue(
      null,
    );
    const upsertSpy = jest.fn();
    prisma.marketplaceIntegration.upsert = upsertSpy;
    mockShopeeGetProductOfferV2.mockRejectedValue(
      new Error('Authentication/Credential Error'),
    );

    await expect(
      controller.connectShopee(
        { user: { tenantId: 'tenant-123' } },
        { appId: 'invalid-app', appSecret: 'invalid-secret' },
      ),
    ).rejects.toThrow('Authentication/Credential Error');

    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'ERROR' }),
        update: expect.objectContaining({ status: 'ERROR' }),
      }),
    );
  });
});
