import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('realtime')
  async getRealtimeMetrics(@Request() req: any) {
    const tenantId = req.user.tenantId;
    return this.analyticsService.getRealtimeMetrics(tenantId);
  }

  @Get('overview')
  async getOverview(@Request() req: any) {
    const tenantId = req.user.tenantId;
    return this.analyticsService.getOverview(tenantId);
  }

  @Get('conversions')
  async getConversions(@Request() req: any, @Query() query: any) {
    return this.analyticsService.getSales(req.user.tenantId, query);
  }

  @Get('report')
  async getReport(@Request() req: any, @Query() query: any) {
    return this.analyticsService.getReport(req.user.tenantId, query);
  }
}
