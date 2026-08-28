import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import {
  AdsDashboardController,
  AdsFinancialController,
  AdsSettingsController,
  AdvertisersController,
  CampaignsController,
} from './ads.controller';
import { AdsAuditService } from './ads-audit.service';
import { AdsFinancialService } from './ads-financial.service';
import { AdsSettingsService } from './ads-settings.service';
import { AdvertisersService } from './advertisers.service';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    AdsDashboardController,
    AdvertisersController,
    CampaignsController,
    AdsFinancialController,
    AdsSettingsController,
  ],
  providers: [
    AdsAuditService,
    AdsFinancialService,
    AdsSettingsService,
    AdvertisersService,
    CampaignsService,
  ],
})
export class AdsModule {}
