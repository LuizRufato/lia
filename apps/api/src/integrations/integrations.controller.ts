import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { MercadoLivreSyncService } from './mercadolivre-sync.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('integrations')
@UseGuards(JwtAuthGuard)
export class IntegrationsController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly mercadoLivreSyncService: MercadoLivreSyncService,
  ) {}

  @Get('shopee')
  async getShopee(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.integrationsService.getShopeeIntegration(tenantId);
  }

  @Post('shopee')
  async connectShopee(
    @Req() req: any,
    @Body() body: { appId: string; appSecret: string },
  ) {
    const tenantId = req.user.tenantId;
    return this.integrationsService.connectShopee(
      tenantId,
      body.appId,
      body.appSecret,
    );
  }

  @Delete('shopee')
  async disconnectShopee(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.integrationsService.disconnectShopee(tenantId);
  }

  @Post('shopee/test')
  async testShopeeConnection(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.integrationsService.testShopeeConnection(tenantId);
  }

  @Post('shopee/sync')
  async syncShopeeNow(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.integrationsService.syncShopeeNow(tenantId);
  }

  @Post('shopee/sync-conversions')
  async syncShopeeConversions(
    @Req() req: any,
    @Body() body: { days?: number },
  ) {
    const tenantId = req.user.tenantId;
    return this.integrationsService.syncShopeeConversions(
      tenantId,
      body.days || 7,
    );
  }

  // --- WHATSAPP CLOUD API ---

  @Get('whatsapp')
  async getWhatsApp(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.integrationsService.getWhatsAppIntegration(tenantId);
  }

  @Post('whatsapp')
  async connectWhatsApp(
    @Req() req: any,
    @Body()
    body: { wabaId: string; phoneNumberId: string; accessToken: string },
  ) {
    const tenantId = req.user.tenantId;
    return this.integrationsService.connectWhatsApp(
      tenantId,
      body.wabaId,
      body.phoneNumberId,
      body.accessToken,
    );
  }

  @Delete('whatsapp')
  async disconnectWhatsApp(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.integrationsService.disconnectWhatsApp(tenantId);
  }

  @Post('whatsapp/test')
  async testWhatsAppConnection(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.integrationsService.testWhatsAppConnection(tenantId);
  }

  // --- WHATSAPP EVOLUTION API (WEB UNOFFICIAL) ---

  @Post('whatsapp/evolution/connect')
  async connectWhatsAppEvolution(
    @Req() req: any,
    @Body() body: { phoneNumber?: string },
  ) {
    const tenantId = req.user.tenantId;
    return this.integrationsService.connectWhatsAppEvolution(
      tenantId,
      body?.phoneNumber,
    );
  }

  @Post('mercadolivre/sync')
  async syncMercadoLivre(@Req() req: any) {
    return this.mercadoLivreSyncService.syncNow(req.user.tenantId);
  }

  @Get('whatsapp/safety')
  async getWhatsAppSafety(@Req() req: any) {
    return this.integrationsService.getWhatsAppSafety(req.user.tenantId);
  }

  @Patch('whatsapp/safety')
  async updateWhatsAppSafety(@Req() req: any, @Body() body: Record<string, unknown>) {
    return this.integrationsService.updateWhatsAppSafety(req.user.tenantId, body);
  }

  @Get('whatsapp/evolution/groups')
  async getWhatsAppEvolutionGroups(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.integrationsService.getWhatsAppEvolutionGroups(tenantId);
  }

  /**
   * Sends a fixed, non-commercial message to one enabled WhatsApp group.
   * This is intentionally separate from publication: no offer, affiliate link,
   * tracking URL or Autopilot mode is involved.
   */
  @Post('whatsapp/evolution/test-message')
  async sendWhatsAppEvolutionTestMessage(
    @Req() req: any,
    @Body() body: { channelId?: string },
  ) {
    const tenantId = req.user.tenantId;
    return this.integrationsService.sendWhatsAppEvolutionTestMessage(
      tenantId,
      body.channelId,
    );
  }
}
