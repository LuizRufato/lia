import {
  BadRequestException,
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PublicationsService } from './publications.service';

@Controller('publications')
@UseGuards(JwtAuthGuard)
export class PublicationsController {
  private readonly logger = new Logger(PublicationsController.name);

  constructor(private readonly publicationsService: PublicationsService) {}

  @Get('options')
  async options(@Req() req: any) {
    try {
      return await this.publicationsService.options(req.user.tenantId);
    } catch {
      this.logger.error('Publication filter options query failed.');
      throw new InternalServerErrorException(
        'Não foi possível carregar os filtros de publicações.',
      );
    }
  }

  @Get()
  async list(@Req() req: any, @Query() query: Record<string, string>) {
    try {
      return await this.publicationsService.list(req.user.tenantId, query);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error('Publication history query failed.');
      throw new InternalServerErrorException(
        'Não foi possível carregar o histórico de publicações.',
      );
    }
  }
}
