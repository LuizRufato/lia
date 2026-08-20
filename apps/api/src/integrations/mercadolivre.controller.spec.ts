import { Test, TestingModule } from '@nestjs/testing';
import { MercadoLivreController } from './mercadolivre.controller';
import { MercadoLivreService } from './mercadolivre.service';
import { PrismaService } from '../prisma.service';
import { ConfigService } from '@nestjs/config';

// Mock IORedis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => {
    return {
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
      getdel: jest.fn(),
      eval: jest.fn(),
    };
  });
});

describe('MercadoLivreController (OAuth Security)', () => {
  let controller: MercadoLivreController;
  let service: MercadoLivreService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MercadoLivreController],
      providers: [
        MercadoLivreService,
        {
          provide: PrismaService,
          useValue: {
            marketplaceIntegration: {
              findUnique: jest.fn(),
              upsert: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'INTEGRATION_ENCRYPTION_KEY')
                return '12345678901234567890123456789012';
              return null;
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<MercadoLivreController>(MercadoLivreController);
    service = module.get<MercadoLivreService>(MercadoLivreService);
    prisma = module.get<PrismaService>(PrismaService);

    process.env.MELI_CLIENT_ID = 'TEST_CLIENT_ID';
    process.env.MELI_CLIENT_SECRET = 'TEST_CLIENT_SECRET';
    process.env.MELI_REDIRECT_URI = 'http://localhost:3000/callback';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should NEVER return tokens or encrypted secrets in getIntegration', async () => {
    jest.spyOn(prisma.marketplaceIntegration, 'findUnique').mockResolvedValue({
      id: 'integration-id',
      tenantId: 'tenant-123',
      provider: 'MERCADO_LIVRE',
      publicIdentifier: 'meli-user-id',
      encryptedSecret: 'some-encrypted-access-token',
      iv: 'iv-value',
      authTag: 'auth-tag-value',
      encryptedRefreshToken: 'some-encrypted-refresh-token',
      refreshIv: 'refresh-iv',
      refreshAuthTag: 'refresh-tag',
      expiresAt: new Date(),
      keyVersion: 1,
      status: 'CONNECTED',
      lastSyncAt: new Date(),
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const result = await controller.getIntegration({
      user: { tenantId: 'tenant-123' },
    });

    expect(result.status).toBe('CONNECTED');
    expect(result.meliUserId).toBe('meli-user-id');

    // Security check
    expect((result as any).encryptedSecret).toBeUndefined();
    expect((result as any).encryptedRefreshToken).toBeUndefined();
    expect((result as any).access_token).toBeUndefined();
    expect((result as any).refresh_token).toBeUndefined();

    const jsonStr = JSON.stringify(result);
    expect(jsonStr).not.toContain('some-encrypted-access-token');
    expect(jsonStr).not.toContain('some-encrypted-refresh-token');
  });

  it('should throw BadRequestException if state is invalid or expired', async () => {
    jest.spyOn(service['redis'], 'getdel').mockResolvedValue(null);

    const req = { query: { state: 'invalid-state', code: 'some-code' } };

    const res = {
      redirect: jest.fn(),
    } as any;

    await controller.callback('invalid-state', 'some-code', res);

    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining('status=error'),
    );
  });

  describe('refreshAccessToken (OAuth Atomic Refresh)', () => {
    it('should throw if concurrent refresh is in progress', async () => {
      jest.spyOn(service['redis'], 'set').mockResolvedValue(null);

      await expect(service.refreshAccessToken('tenant-123')).rejects.toThrow(
        'Concurrent refresh in progress, try again later.',
      );
    });

    it('should set NEEDS_REAUTH if refresh token responds with invalid_grant', async () => {
      jest.spyOn(service['redis'], 'set').mockResolvedValue('OK');
      jest.spyOn(service['redis'], 'eval').mockResolvedValue(1);

      jest
        .spyOn(prisma.marketplaceIntegration, 'findUnique')
        .mockResolvedValue({
          id: 'integration-id',
          tenantId: 'tenant-123',
          provider: 'MERCADO_LIVRE',
          encryptedRefreshToken: 'some-encrypted-refresh-token',
          refreshIv: 'refresh-iv',
          refreshAuthTag: 'refresh-tag',
        } as any);

      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: jest.fn().mockResolvedValue({ error: 'invalid_grant' }),
        text: jest.fn().mockResolvedValue('invalid_grant'),
      });
      global.fetch = fetchMock;

      jest.mock('@lia/integrations', () => ({
        decryptSecret: jest.fn().mockReturnValue('old-refresh-token'),
        encryptSecret: jest.fn(),
      }));

      await expect(service.refreshAccessToken('tenant-123')).rejects.toThrow(
        'Refresh token failed',
      );

      expect(prisma.marketplaceIntegration.update).toHaveBeenCalledWith({
        where: { id: 'integration-id' },
        data: { status: 'NEEDS_REAUTH', lastError: 'invalid_grant' },
      });
    });

    it('should NOT set NEEDS_REAUTH if error is not invalid_grant (e.g. transient 500)', async () => {
      jest.spyOn(service['redis'], 'set').mockResolvedValue('OK');
      jest.spyOn(service['redis'], 'eval').mockResolvedValue(1);

      jest
        .spyOn(prisma.marketplaceIntegration, 'findUnique')
        .mockResolvedValue({
          id: 'integration-id',
          tenantId: 'tenant-123',
          provider: 'MERCADO_LIVRE',
          encryptedRefreshToken: 'some-encrypted-refresh-token',
          refreshIv: 'refresh-iv',
          refreshAuthTag: 'refresh-tag',
        } as any);

      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn().mockRejectedValue(new Error('Internal Server Error')),
      });
      global.fetch = fetchMock;

      jest.mock('@lia/integrations', () => ({
        decryptSecret: jest.fn().mockReturnValue('old-refresh-token'),
        encryptSecret: jest.fn(),
      }));

      await expect(service.refreshAccessToken('tenant-123')).rejects.toThrow(
        'Refresh token failed',
      );

      // Update should NOT have been called with NEEDS_REAUTH
      expect(prisma.marketplaceIntegration.update).not.toHaveBeenCalled();
    });
  });
});
