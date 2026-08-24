import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminAlertsService } from './admin-alerts.service';
import { UpdateAdminAlertConfigDto } from './dto/update-admin-alert-config.dto';

@Controller('admin-alerts/config')
@UseGuards(JwtAuthGuard)
export class AdminAlertsController {
  constructor(private readonly adminAlertsService: AdminAlertsService) {}

  @Get()
  getConfig(@Req() req: any) {
    return this.adminAlertsService.getConfig(req.user.tenantId, req.user.role);
  }

  @Patch()
  updateConfig(@Req() req: any, @Body() body: UpdateAdminAlertConfigDto) {
    return this.adminAlertsService.updateConfig(
      req.user.tenantId,
      req.user.role,
      body,
    );
  }

  @Post('test')
  sendTest(@Req() req: any) {
    return this.adminAlertsService.sendTestMessage(
      req.user.tenantId,
      req.user.role,
    );
  }
}
