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
    @Body() body: {
      enabled?: boolean;
      safetyMaxPerHour?: number;
      safetyMaxPerDay?: number;
      safetyMinIntervalSeconds?: number;
      safetyWindowStartMinute?: number | null;
      safetyWindowEndMinute?: number | null;
    },
  ) {
    const tenantId = req.user.tenantId;
    // ensure tenant ownership
    const channel = await this.prisma.channel.findFirst({
      where: { id, tenantId },
    });
    if (!channel) throw new Error('Channel not found');
    const bounded = (value: unknown, fallback: number, max: number) => {
      const parsed = Number(value);
      return Number.isFinite(parsed)
        ? Math.min(max, Math.max(0, Math.round(parsed)))
        : fallback;
    };

    return this.prisma.channel.update({
      where: { id },
      data: {
        ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
        ...(body.safetyMaxPerHour !== undefined
          ? { safetyMaxPerHour: Math.max(1, bounded(body.safetyMaxPerHour, channel.safetyMaxPerHour, 1000)) }
          : {}),
        ...(body.safetyMaxPerDay !== undefined
          ? { safetyMaxPerDay: Math.max(1, bounded(body.safetyMaxPerDay, channel.safetyMaxPerDay, 10000)) }
          : {}),
        ...(body.safetyMinIntervalSeconds !== undefined
          ? { safetyMinIntervalSeconds: Math.max(1, bounded(body.safetyMinIntervalSeconds, channel.safetyMinIntervalSeconds, 86400)) }
          : {}),
        ...(body.safetyWindowStartMinute !== undefined
          ? { safetyWindowStartMinute: body.safetyWindowStartMinute == null ? null : bounded(body.safetyWindowStartMinute, 0, 1439) }
          : {}),
        ...(body.safetyWindowEndMinute !== undefined
          ? { safetyWindowEndMinute: body.safetyWindowEndMinute == null ? null : bounded(body.safetyWindowEndMinute, 1439, 1439) }
          : {}),
      },
    });
  }
}
