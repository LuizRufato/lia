import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AnalyticsService } from './analytics.service';

@Controller('sales')
@UseGuards(JwtAuthGuard)
export class SalesController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get()
  getSales(@Request() req: any, @Query() query: any) {
    return this.analyticsService.getSales(req.user.tenantId, query);
  }

  @Get('summary')
  async getSummary(@Request() req: any, @Query() query: any) {
    const result = await this.analyticsService.getSales(
      req.user.tenantId,
      query,
    );
    return { period: result.period, summary: result.summary };
  }
}
