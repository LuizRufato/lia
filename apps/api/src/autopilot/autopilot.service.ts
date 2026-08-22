import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

    const connectedProviders = (
      await this.prisma.marketplaceIntegration.findMany({
        where: { tenantId, status: 'CONNECTED' },
        select: { provider: true },
      })
    ).map((integration) => integration.provider);

    return {
      mode: config.mode,
      config: {
        allowedStartMinute: config.allowedStartMinute,
        allowedEndMinute: config.allowedEndMinute,
        intervalMinutes: config.intervalMinutes,
        minScore: config.minScore.toNumber(),
        minimumCommissionCents: config.minimumCommissionCents,
        maxDailyPosts: config.maxDailyPosts,
        channels: config.enabledChannels.map((c) => ({
          id: c.channelId,
          displayName: c.channel.displayName,
        })),
        marketplaces: config.enabledMarketplaces.map((m) => ({
          id: m.marketplaceId,
          name: m.marketplace.name,
          type: m.marketplace.type,
        })),
        timezone: config.timezone,
      },
      availableChannels: await this.prisma.channel.findMany({
        where: { tenantId, enabled: true },
        select: { id: true, displayName: true, provider: true },
        orderBy: { displayName: 'asc' },
      }),
      availableMarketplaces: await this.prisma.marketplace.findMany({
        where: { type: { in: connectedProviders } },
        select: { id: true, name: true, type: true },
        orderBy: { name: 'asc' },
      }),
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
      minimumCommissionCents,
      maxDailyPosts,
      timezone,
      enabledChannelIds,
      enabledMarketplaceIds,
    } = payload;

    if (
      !Object.values(['OFF', 'MANUAL', 'DRY_RUN', 'AUTO']).includes(mode) ||
      !Number.isInteger(allowedStartMinute) ||
      !Number.isInteger(allowedEndMinute) ||
      !Number.isInteger(intervalMinutes) ||
      !Number.isFinite(minScore) ||
      !Number.isInteger(minimumCommissionCents) ||
      !Number.isInteger(maxDailyPosts) ||
      allowedStartMinute < 0 || allowedStartMinute > 1439 ||
      allowedEndMinute < 0 || allowedEndMinute > 1439 ||
      intervalMinutes < 1 || maxDailyPosts < 0 || minScore < 0 || minScore > 100 ||
      minimumCommissionCents < 0
    ) {
      throw new BadRequestException('Configuração do Autopilot inválida.');
    }

    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    } catch {
      throw new BadRequestException('Fuso horário IANA inválido.');
    }

    const channelIds = Array.isArray(enabledChannelIds) ? enabledChannelIds : [];
    const marketplaceIds = Array.isArray(enabledMarketplaceIds)
      ? enabledMarketplaceIds
      : [];
    if (
      !channelIds.every((id) => typeof id === 'string') ||
      !marketplaceIds.every((id) => typeof id === 'string')
    ) {
      throw new BadRequestException('Canais e marketplaces inválidos.');
    }

    const connectedProviders = (
      await this.prisma.marketplaceIntegration.findMany({
        where: { tenantId, status: 'CONNECTED' },
        select: { provider: true },
      })
    ).map((integration) => integration.provider);
    const [channels, marketplaces] = await Promise.all([
      this.prisma.channel.findMany({
        where: { tenantId, enabled: true, id: { in: channelIds } },
        select: { id: true },
      }),
      this.prisma.marketplace.findMany({
        where: { id: { in: marketplaceIds }, type: { in: connectedProviders } },
        select: { id: true },
      }),
    ]);
    if (channels.length !== new Set(channelIds).size || marketplaces.length !== new Set(marketplaceIds).size) {
      throw new BadRequestException('Selecione apenas canais ativos e marketplaces conectados.');
    }

    const config = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.autopilotConfig.upsert({
        where: { tenantId },
        update: {
          mode, allowedStartMinute, allowedEndMinute, intervalMinutes,
          minScore, minimumCommissionCents, maxDailyPosts, timezone,
        },
        create: {
          tenantId, mode, allowedStartMinute, allowedEndMinute,
          intervalMinutes, minScore, minimumCommissionCents, maxDailyPosts, timezone,
        },
      });
      await tx.autopilotChannelConfig.deleteMany({ where: { autopilotConfigId: saved.id } });
      await tx.autopilotMarketplaceConfig.deleteMany({ where: { autopilotConfigId: saved.id } });
      if (channelIds.length) {
        await tx.autopilotChannelConfig.createMany({
          data: channelIds.map((channelId) => ({ autopilotConfigId: saved.id, channelId })),
        });
      }
      if (marketplaceIds.length) {
        await tx.autopilotMarketplaceConfig.createMany({
          data: marketplaceIds.map((marketplaceId) => ({ autopilotConfigId: saved.id, marketplaceId })),
        });
      }
      return saved;
    });

    return { success: true, config };
  }
}
