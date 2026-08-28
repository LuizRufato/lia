import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdsFinancialService } from './ads-financial.service';
import { AdsSettingsService } from './ads-settings.service';
import { AdvertisersService } from './advertisers.service';
import { CampaignsService } from './campaigns.service';
import {
  AddCreditDto,
  CreateAdvertiserDto,
  CreateCampaignDto,
  RejectCampaignDto,
  UpdateAdvertiserDto,
  UpdateAdsSettingsDto,
  UpdateCampaignDto,
} from './dto/ads.dto';

@UseGuards(JwtAuthGuard)
@Controller('ads')
export class AdsDashboardController {
  constructor(private readonly financial: AdsFinancialService) {}

  @Get('dashboard')
  dashboard(@Req() req: any) {
    return this.financial.dashboard(req.user.tenantId);
  }
}

@UseGuards(JwtAuthGuard)
@Controller('ads/advertisers')
export class AdvertisersController {
  constructor(private readonly advertisers: AdvertisersService) {}

  @Get()
  list(@Req() req: any) {
    return this.advertisers.list(req.user.tenantId);
  }

  @Post()
  create(@Req() req: any, @Body() body: CreateAdvertiserDto) {
    return this.advertisers.create(
      req.user.tenantId,
      req.user.id,
      req.user.role,
      body,
    );
  }

  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.advertisers.get(req.user.tenantId, id);
  }

  @Patch(':id')
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: UpdateAdvertiserDto,
  ) {
    return this.advertisers.update(
      req.user.tenantId,
      req.user.id,
      req.user.role,
      id,
      body,
    );
  }
}

@UseGuards(JwtAuthGuard)
@Controller('ads/campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  list(@Req() req: any, @Query() query: Record<string, string>) {
    return this.campaigns.list(req.user.tenantId, query);
  }

  @Post()
  create(@Req() req: any, @Body() body: CreateCampaignDto) {
    return this.campaigns.create(
      req.user.tenantId,
      req.user.id,
      req.user.role,
      body,
    );
  }

  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.campaigns.get(req.user.tenantId, id);
  }

  @Patch(':id')
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: UpdateCampaignDto,
  ) {
    return this.campaigns.update(
      req.user.tenantId,
      req.user.id,
      req.user.role,
      id,
      body,
    );
  }

  @Post(':id/submit')
  submit(@Req() req: any, @Param('id') id: string) {
    return this.campaigns.submit(
      req.user.tenantId,
      req.user.id,
      req.user.role,
      id,
    );
  }

  @Post(':id/approve')
  approve(@Req() req: any, @Param('id') id: string) {
    return this.campaigns.approve(
      req.user.tenantId,
      req.user.id,
      req.user.role,
      id,
    );
  }

  @Post(':id/reject')
  reject(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: RejectCampaignDto,
  ) {
    return this.campaigns.reject(
      req.user.tenantId,
      req.user.id,
      req.user.role,
      id,
      body,
    );
  }

  @Post(':id/pause')
  pause(@Req() req: any, @Param('id') id: string) {
    return this.campaigns.pause(
      req.user.tenantId,
      req.user.id,
      req.user.role,
      id,
    );
  }

  @Post(':id/resume')
  resume(@Req() req: any, @Param('id') id: string) {
    return this.campaigns.resume(
      req.user.tenantId,
      req.user.id,
      req.user.role,
      id,
    );
  }
}

@UseGuards(JwtAuthGuard)
@Controller('ads')
export class AdsFinancialController {
  constructor(private readonly financial: AdsFinancialService) {}

  @Get('ledger')
  ledger(@Req() req: any, @Query() query: Record<string, string>) {
    return this.financial.ledger(req.user.tenantId, query);
  }

  @Post('advertisers/:id/credits')
  credit(@Req() req: any, @Param('id') id: string, @Body() body: AddCreditDto) {
    return this.financial.addCredit(
      req.user.tenantId,
      req.user.id,
      req.user.role,
      id,
      body,
    );
  }
}

@UseGuards(JwtAuthGuard)
@Controller('ads/settings')
export class AdsSettingsController {
  constructor(private readonly settings: AdsSettingsService) {}

  @Get()
  get(@Req() req: any) {
    return this.settings.get(req.user.tenantId);
  }

  @Patch()
  update(@Req() req: any, @Body() body: UpdateAdsSettingsDto) {
    return this.settings.update(req.user.tenantId, req.user.role, body);
  }
}
