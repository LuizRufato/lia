import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminAlertsService } from './admin-alerts.service';
import {
  AddAdminAlertRecipientDto,
  SetAdminAlertRecipientDto,
  UpdateAdminAlertConfigDto,
} from './dto/update-admin-alert-config.dto';

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

  @Post('recipients')
  addRecipient(@Req() req: any, @Body() body: AddAdminAlertRecipientDto) {
    return this.adminAlertsService.addRecipient(
      req.user.tenantId,
      req.user.role,
      body.recipient,
    );
  }

  @Patch('recipients/:recipientId')
  setRecipientEnabled(
    @Req() req: any,
    @Param('recipientId') recipientId: string,
    @Body() body: SetAdminAlertRecipientDto,
  ) {
    return this.adminAlertsService.setRecipientEnabled(
      req.user.tenantId,
      req.user.role,
      recipientId,
      body.enabled,
    );
  }

  @Delete('recipients/:recipientId')
  removeRecipient(@Req() req: any, @Param('recipientId') recipientId: string) {
    return this.adminAlertsService.removeRecipient(
      req.user.tenantId,
      req.user.role,
      recipientId,
    );
  }

  @Post('simulate')
  simulate(@Req() req: any) {
    return this.adminAlertsService.sendSimulation(
      req.user.tenantId,
      req.user.role,
    );
  }
}
