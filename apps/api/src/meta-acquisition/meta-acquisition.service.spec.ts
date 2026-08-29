import {
  GroupProvisioningService,
  GroupRouterService,
  MetaAcquisitionService,
} from './meta-acquisition.service';

describe('Meta acquisition foundation', () => {
  it('keeps provisioning in shadow mode', async () => {
    const result = await new GroupProvisioningService().plan(
      'tenant-1',
      900,
      900,
    );
    expect(result).toEqual(
      expect.objectContaining({
        mode: 'SHADOW',
        shouldProvision: true,
        executed: false,
      }),
    );
  });

  it('routes only to an official active group below the threshold', async () => {
    const prisma = {
      metaAcquisitionConfig: {
        findUnique: jest.fn().mockResolvedValue({
          liaAdsGroupRoutingEnabled: true,
          groupRoutingThreshold: 1000,
        }),
      },
      liaWhatsAppGroup: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'group-1',
          name: 'LIA Achou 1',
          inviteUrl: 'https://chat.whatsapp.com/opaque',
          memberCount: 20,
          capacity: 1024,
        }),
      },
    } as any;
    await expect(
      new GroupRouterService(prisma).resolve('tenant-1'),
    ).resolves.toEqual(
      expect.objectContaining({
        available: true,
        group: expect.objectContaining({ id: 'group-1' }),
      }),
    );
  });

  it('returns an explicit no-group result instead of an invalid redirect', async () => {
    const prisma = {
      metaAcquisitionConfig: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ liaAdsGroupRoutingEnabled: true }),
      },
      liaWhatsAppGroup: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any;
    await expect(
      new GroupRouterService(prisma).resolve('tenant-1'),
    ).resolves.toEqual({
      available: false,
      reason: 'NO_ELIGIBLE_GROUP',
      pool: 'LIA_ACHOU',
    });
  });

  it('creates and consumes a CSRF-protected Meta OAuth state without exposing a token', () => {
    const originalAppId = process.env.META_APP_ID;
    const originalRedirect = process.env.META_REDIRECT_URI;
    process.env.META_APP_ID = 'test-app';
    process.env.META_REDIRECT_URI =
      'https://botlia.com.br/api/ads/meta/callback';
    const service = new MetaAcquisitionService({} as any);
    const result = service.beginMetaOAuth('tenant-1');
    expect(result.configured).toBe(true);
    expect(result.authorizationUrl).toContain('scope=ads_read');
    expect(result.authorizationUrl).not.toContain('access_token');
    const state = new URL(result.authorizationUrl!).searchParams.get('state')!;
    expect(service.consumeMetaOAuthState(state)).toEqual({
      valid: true,
      tenantId: 'tenant-1',
    });
    expect(() => service.consumeMetaOAuthState(state)).toThrow(
      'Estado OAuth inválido ou expirado.',
    );
    if (originalAppId === undefined) delete process.env.META_APP_ID;
    else process.env.META_APP_ID = originalAppId;
    if (originalRedirect === undefined) delete process.env.META_REDIRECT_URI;
    else process.env.META_REDIRECT_URI = originalRedirect;
  });
});
