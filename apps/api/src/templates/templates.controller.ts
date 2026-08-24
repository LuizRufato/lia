import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TemplatesService } from './templates.service';

@Controller('templates')
@UseGuards(JwtAuthGuard)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  list(@Req() req: any) {
    return this.templatesService.list(req.user.tenantId);
  }

  @Get('preview')
  preview(@Req() req: any) {
    return this.templatesService.preview(req.user.tenantId);
  }

  @Post()
  create(@Req() req: any, @Body() body: any) {
    return this.templatesService.create(req.user.tenantId, body);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.templatesService.update(req.user.tenantId, id, body);
  }
}
