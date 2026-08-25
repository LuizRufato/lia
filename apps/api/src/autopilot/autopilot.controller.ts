import {
  Controller,
  Get,
  Post,
  UseGuards,
  Request,
  Body,
} from '@nestjs/common';
import { AutopilotService } from './autopilot.service';
import type { OneShotRequest } from './autopilot.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('autopilot')
@UseGuards(JwtAuthGuard)
export class AutopilotController {
  constructor(private autopilotService: AutopilotService) {}

  @Get('dashboard')
  async getDashboard(@Request() req: any) {
    const tenantId = req.user.tenantId;
    return this.autopilotService.getDashboard(tenantId);
  }

  @Get('status')
  async getStatus(@Request() req: any) {
    return this.autopilotService.getStatus(req.user.tenantId);
  }

  @Get('catalog/categories')
  async getCatalogCategories(@Request() req: any) {
    return this.autopilotService.getCatalogCategories(req.user.tenantId);
  }

  @Post('emergency-pause')
  async emergencyPause(@Request() req: any) {
    const tenantId = req.user.tenantId;
    return this.autopilotService.setEmergencyPause(tenantId);
  }

  @Post('config')
  async saveConfig(@Request() req: any) {
    const tenantId = req.user.tenantId;
    return this.autopilotService.saveConfig(tenantId, req.body);
  }

  @Post('one-shot/preflight')
  async preflightOneShot(@Request() req: any, @Body() body: OneShotRequest) {
    return this.autopilotService.preflightOneShot(
      req.user.tenantId,
      req.user.role,
      body,
    );
  }

  @Post('one-shot')
  async executeOneShot(@Request() req: any, @Body() body: OneShotRequest) {
    return this.autopilotService.executeOneShot(
      req.user.tenantId,
      req.user.role,
      body,
    );
  }
}
