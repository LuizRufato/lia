import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OffersService } from './offers.service';

@Controller('offers')
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  @Get()
  async getOffers(
    @Req() req: any,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const tenantId = req.user.tenantId;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20)); // Max 100 safe limit

    return this.offersService.getOffersForTenant(tenantId, pageNum, limitNum);
  }

  @Post(':id/verify-monetization')
  async verifyMonetization(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.offersService.verifyMonetization(tenantId, id);
  }
}
