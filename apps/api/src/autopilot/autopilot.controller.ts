import { Controller, Get, Post, UseGuards, Request } from '@nestjs/common';
import { AutopilotService } from './autopilot.service';
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
}
