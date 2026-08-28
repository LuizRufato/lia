import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { assertAdsAdmin } from './ads.utils';

@Injectable()
export class AdsSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(tenantId: string) {
    const config = await this.prisma.adsConfig.findUnique({
      where: { tenantId },
    });
    return {
      adsEnabled: config?.adsEnabled ?? false,
      adsPublicSearchEnabled: config?.adsPublicSearchEnabled ?? false,
      adsBillingEnabled: config?.adsBillingEnabled ?? false,
      deliveryEnabled: false,
    };
  }

  async update(tenantId: string, role: string, body: any) {
    assertAdsAdmin(role);
    const config = await this.prisma.adsConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        adsEnabled: body.adsEnabled === true,
        adsPublicSearchEnabled: body.adsPublicSearchEnabled === true,
        adsBillingEnabled: body.adsBillingEnabled === true,
      },
      update: {
        ...(typeof body.adsEnabled === 'boolean' && {
          adsEnabled: body.adsEnabled,
        }),
        ...(typeof body.adsPublicSearchEnabled === 'boolean' && {
          adsPublicSearchEnabled: body.adsPublicSearchEnabled,
        }),
        ...(typeof body.adsBillingEnabled === 'boolean' && {
          adsBillingEnabled: body.adsBillingEnabled,
        }),
      },
    });
    return {
      adsEnabled: config.adsEnabled,
      adsPublicSearchEnabled: config.adsPublicSearchEnabled,
      adsBillingEnabled: config.adsBillingEnabled,
      deliveryEnabled: false,
    };
  }
}
