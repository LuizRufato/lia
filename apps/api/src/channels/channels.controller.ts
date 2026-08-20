import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('channels')
@UseGuards(JwtAuthGuard)
export class ChannelsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getChannels(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.prisma.channel.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Patch(':id')
  async updateChannel(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { enabled: boolean },
  ) {
    const tenantId = req.user.tenantId;
    // ensure tenant ownership
    const channel = await this.prisma.channel.findFirst({
      where: { id, tenantId },
    });
    if (!channel) throw new Error('Channel not found');

    return this.prisma.channel.update({
      where: { id },
      data: { enabled: body.enabled },
    });
  }
}
