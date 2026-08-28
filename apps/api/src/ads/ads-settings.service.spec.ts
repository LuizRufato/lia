import { AdsSettingsService } from './ads-settings.service';

describe('AdsSettingsService', () => {
  it('returns all feature flags off when no config exists', async () => {
    const prisma: any = {
      adsConfig: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new AdsSettingsService(prisma);

    await expect(service.get('tenant-a')).resolves.toEqual({
      adsEnabled: false,
      adsPublicSearchEnabled: false,
      adsBillingEnabled: false,
      deliveryEnabled: false,
    });
  });

  it('persists only the three approved flags and never enables delivery', async () => {
    const prisma: any = {
      adsConfig: {
        upsert: jest
          .fn()
          .mockResolvedValue({
            adsEnabled: true,
            adsPublicSearchEnabled: true,
            adsBillingEnabled: true,
          }),
      },
    };
    const service = new AdsSettingsService(prisma);

    await expect(
      service.update('tenant-a', 'ADMIN', {
        adsEnabled: true,
        adsPublicSearchEnabled: true,
        adsBillingEnabled: true,
      }),
    ).resolves.toMatchObject({ deliveryEnabled: false });
    expect(prisma.adsConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          adsEnabled: true,
          adsPublicSearchEnabled: true,
          adsBillingEnabled: true,
        }),
      }),
    );
  });
});
