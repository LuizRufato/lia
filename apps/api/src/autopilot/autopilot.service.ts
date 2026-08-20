import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class AutopilotService {
  constructor(private prisma: PrismaService) {}

  async getDashboard(tenantId: string) {
    let config = await this.prisma.autopilotConfig.findUnique({
      where: { tenantId },
      include: {
        enabledChannels: { include: { channel: true } },
        enabledMarketplaces: { include: { marketplace: true } },
      },
    });

    if (!config) {
      config = await this.prisma.autopilotConfig.create({
        data: {
          tenantId,
          mode: 'OFF',
          allowedStartMinute: 480,
          allowedEndMinute: 1380,
          intervalMinutes: 15,
          minScore: 50,
          maxDailyPosts: 10,
          timezone: 'America/Campo_Grande',
        },
        include: {
          enabledChannels: { include: { channel: true } },
          enabledMarketplaces: { include: { marketplace: true } },
        },
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const postsToday = await this.prisma.publication.count({
      where: {
        channel: { tenantId },
        status: 'PUBLISHED',
        publishedAt: { gte: today },
      },
    });

    const lastPublication = await this.prisma.publication.findFirst({
      where: { channel: { tenantId }, status: 'PUBLISHED' },
      orderBy: { publishedAt: 'desc' },
    });

    const feedRaw = await this.prisma.autopilotAudit.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        candidate: {
          include: {
            evaluation: {
              include: {
                observation: {
                  include: { offer: true },
                },
              },
            },
          },
        },
      },
    });

    const feed = feedRaw.map((f) => ({
      id: f.id,
      decision: f.decision,
      offerTitle:
        f.candidate?.evaluation?.observation?.offer?.title ||
        'Oferta Desconhecida',
      score: f.liaScore.toNumber(),
      details: f.details,
      createdAt: f.createdAt,
    }));

    return {
      mode: config.mode,
      config: {
        allowedStartMinute: config.allowedStartMinute,
        allowedEndMinute: config.allowedEndMinute,
        intervalMinutes: config.intervalMinutes,
        minScore: config.minScore.toNumber(),
        maxDailyPosts: config.maxDailyPosts,
        channels: config.enabledChannels.map((c) => c.channel.displayName),
        marketplaces: config.enabledMarketplaces.map((m) => m.marketplace.name),
        timezone: config.timezone,
      },
      stats: {
        postsToday,
        lastPublicationAt: lastPublication?.publishedAt || null,
      },
      feed,
    };
  }

  async setEmergencyPause(tenantId: string) {
    let config = await this.prisma.autopilotConfig.findUnique({
      where: { tenantId },
    });

    if (!config) {
      throw new NotFoundException('Configuração não encontrada.');
    }

    await this.prisma.autopilotConfig.update({
      where: { id: config.id },
      data: { mode: 'OFF' },
    });

    return { success: true };
  }

  async saveConfig(tenantId: string, payload: any) {
    const {
      mode,
      allowedStartMinute,
      allowedEndMinute,
      intervalMinutes,
      minScore,
      maxDailyPosts,
      timezone,
    } = payload;

    // UPSERT the config
    const config = await this.prisma.autopilotConfig.upsert({
      where: { tenantId },
      update: {
        mode,
        allowedStartMinute,
        allowedEndMinute,
        intervalMinutes,
        minScore,
        maxDailyPosts,
        timezone,
      },
      create: {
        tenantId,
        mode,
        allowedStartMinute,
        allowedEndMinute,
        intervalMinutes,
        minScore,
        maxDailyPosts,
        timezone,
      },
    });

    // We skip channels and marketplaces relations in this checkpoint to keep it simple and safe.

    return { success: true, config };
  }
}
