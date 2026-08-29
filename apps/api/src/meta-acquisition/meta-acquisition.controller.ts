import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma.service';
import {
  GroupRouterService,
  MetaAcquisitionService,
} from './meta-acquisition.service';

@Controller('ads/acquisition')
@UseGuards(JwtAuthGuard)
export class MetaAcquisitionController {
  constructor(private readonly service: MetaAcquisitionService) {}

  @Get('overview')
  overview(@Req() req: any) {
    return this.service.overview(req.user.tenantId);
  }

  @Get('campaigns')
  campaigns(@Req() req: any) {
    return this.service.listCampaigns(req.user.tenantId);
  }

  @Get('groups')
  groups(@Req() req: any) {
    return this.service.groups(req.user.tenantId);
  }

  @Post('campaigns')
  createCampaign(@Req() req: any, @Body() body: any) {
    return this.service.createCampaign(
      req.user.tenantId,
      req.user.id,
      req.user.role,
      body,
    );
  }

  @Post('tracking-links')
  createTrackingLink(@Req() req: any, @Body() body: any) {
    return this.service.createTrackingLink(
      req.user.tenantId,
      req.user.role,
      body,
    );
  }

  @Post('campaigns/:id/submit')
  submitCampaign(@Req() req: any, @Param('id') id: string) {
    return this.service.submitCampaign(req.user.tenantId, req.user.role, id);
  }

  @Post('campaigns/:id/approve')
  approveCampaign(@Req() req: any, @Param('id') id: string) {
    return this.service.approveCampaign(
      req.user.tenantId,
      req.user.id,
      req.user.role,
      id,
    );
  }

  @Get('creatives')
  creatives(@Req() req: any) {
    return this.service.listCreatives(req.user.tenantId);
  }

  @Post('creatives')
  createCreative(@Req() req: any, @Body() body: any) {
    return this.service.createCreative(req.user.tenantId, req.user.role, body);
  }

  @Post('creatives/:id/approve')
  approveCreative(@Req() req: any, @Param('id') id: string) {
    return this.service.approveCreative(
      req.user.tenantId,
      req.user.id,
      req.user.role,
      id,
    );
  }

  @Post('creatives/:id/reject')
  rejectCreative(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.rejectCreative(
      req.user.tenantId,
      req.user.role,
      id,
      body.reason,
    );
  }

  @Get('analytics')
  analytics(@Req() req: any) {
    return this.service.analytics(req.user.tenantId);
  }

  @Get('suggestions')
  suggestions(@Req() req: any) {
    return this.service.suggestions(req.user.tenantId);
  }
}

@Controller('ads/meta')
@UseGuards(JwtAuthGuard)
export class MetaConnectionController {
  constructor(private readonly service: MetaAcquisitionService) {}

  @Get('status')
  status(@Req() req: any) {
    return this.service.metaStatus(req.user.tenantId);
  }

  @Get('connect')
  connect(@Req() req: any) {
    return this.service.beginMetaOAuth(req.user.tenantId);
  }

  @Get('callback')
  @Public()
  callback(@Query('state') state: string) {
    return this.service.consumeMetaOAuthState(String(state || ''));
  }
}

@Controller('public/acquisition/group')
@Public()
export class PublicAcquisitionGroupController {
  constructor(
    private readonly router: GroupRouterService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':token')
  async landing(@Param('token') token: string) {
    const link = await this.prisma.acquisitionTrackingLink.findUnique({
      where: { token },
      select: {
        token: true,
        active: true,
        expiresAt: true,
        destinationGroupPool: true,
        campaignId: true,
        creativeId: true,
        tenantId: true,
      },
    });
    if (
      !link ||
      !link.active ||
      (link.expiresAt && link.expiresAt <= new Date())
    ) {
      return { available: false, reason: 'INVALID_TRACKING_TOKEN' };
    }
    const route = await this.router.resolve(
      link.tenantId,
      link.destinationGroupPool,
    );
    return {
      token: link.token,
      campaignId: link.campaignId,
      creativeId: link.creativeId,
      ...route,
    };
  }

  @Post(':token/events')
  async event(@Param('token') token: string, @Body() body: any) {
    const link = await this.prisma.acquisitionTrackingLink.findUnique({
      where: { token },
      select: {
        id: true,
        tenantId: true,
        campaignId: true,
        creativeId: true,
        active: true,
        expiresAt: true,
      },
    });
    if (
      !link ||
      !link.active ||
      (link.expiresAt && link.expiresAt <= new Date())
    ) {
      return { accepted: false, reason: 'INVALID_TRACKING_TOKEN' };
    }
    const type = [
      'LANDING_VIEW',
      'JOIN_CTA_CLICK',
      'WHATSAPP_REDIRECT',
    ].includes(body.type)
      ? body.type
      : null;
    if (!type) return { accepted: false, reason: 'UNSUPPORTED_EVENT' };
    const eventId = String(body.eventId || '').trim();
    if (!eventId || eventId.length > 120)
      return { accepted: false, reason: 'INVALID_EVENT_ID' };
    await this.prisma.acquisitionEvent.upsert({
      where: { eventId },
      create: {
        tenantId: link.tenantId,
        eventId,
        type,
        trackingLinkId: link.id,
        campaignId: link.campaignId,
        creativeId: link.creativeId,
        visitorHash: /^[a-f0-9]{64}$/i.test(String(body.visitorHash || ''))
          ? body.visitorHash
          : undefined,
        sessionHash: /^[a-f0-9]{64}$/i.test(String(body.sessionHash || ''))
          ? body.sessionHash
          : undefined,
        referrer: String(body.referrer || '').slice(0, 500) || undefined,
        utmSource: String(body.utmSource || '').slice(0, 100) || undefined,
        utmMedium: String(body.utmMedium || '').slice(0, 100) || undefined,
        utmCampaign: String(body.utmCampaign || '').slice(0, 100) || undefined,
        utmContent: String(body.utmContent || '').slice(0, 100) || undefined,
        deviceClass: String(body.deviceClass || '').slice(0, 40) || undefined,
      },
      update: {},
    });
    return { accepted: true };
  }
}
