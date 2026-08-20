import {
  Controller,
  Get,
  Post,
  Delete,
  Req,
  Body,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import { MercadoLivreService } from './mercadolivre.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Public } from '../auth/public.decorator';
import type { Response } from 'express';

@Controller('integrations/mercadolivre')
export class MercadoLivreController {
  constructor(private readonly meliService: MercadoLivreService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async getIntegration(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.meliService.getIntegration(tenantId);
  }

  @Get('auth-url')
  @UseGuards(JwtAuthGuard)
  async getAuthUrl(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.meliService.generateAuthUrl(tenantId);
  }

  // No JwtAuthGuard here because it's a callback from Meli!
  @Public()
  @Get('callback')
  async callback(
    @Query('state') state: string,
    @Query('code') code: string,
    @Res() res: Response,
  ) {
    try {
      await this.meliService.handleCallback(state, code);
      const webUrl = process.env.WEB_URL || 'http://localhost:3001';
      return res.redirect(`${webUrl}/integrations/mercadolivre?status=success`);
    } catch (err) {
      console.error('Meli callback error:', err);
      const webUrl = process.env.WEB_URL || 'http://localhost:3001';
      return res.redirect(`${webUrl}/integrations/mercadolivre?status=error`);
    }
  }

  @Delete()
  @UseGuards(JwtAuthGuard)
  async disconnect(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.meliService.disconnect(tenantId);
  }
}
