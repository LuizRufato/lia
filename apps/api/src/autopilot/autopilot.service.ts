import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma.service';
import {
  AutopilotBrain,
  AutopilotMode,
  IntegrationStatus,
  MonetizationStatus,
  getMinutesSinceMidnight,
} from '@lia/core';

export const CONTROLLED_ONE_SHOT_CONFIRMATION = 'CONTROLLED_ONE_SHOT_REAL';

export interface OneShotRequest {
  candidateId?: string;
  channelId?: string;
  confirmation?: string;
}

@Injectable()
export class AutopilotService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('publisher') private readonly publisherQueue: Queue,
  ) {}

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

  /**
   * Validate one explicitly selected candidate/channel without changing
   * Autopilot mode, creating a publication, or contacting a provider.
   */
  async preflightOneShot(
    tenantId: string,
    role: string,
    request: OneShotRequest,
  ) {
    this.assertAdmin(role);
    const blockers: string[] = [];
    const candidateId = request.candidateId?.trim();
    const channelId = request.channelId?.trim();

    if (request.confirmation !== CONTROLLED_ONE_SHOT_CONFIRMATION) {
      blockers.push('EXPLICIT_CONFIRMATION_REQUIRED');
    }
    if (!candidateId) blockers.push('CANDIDATE_ID_REQUIRED');
    if (!channelId) blockers.push('CHANNEL_ID_REQUIRED');
    if (!candidateId || !channelId) {
      return { ready: false, blockers };
    }

    const [candidate, channel, config, safetyConfig, integration] =
      await Promise.all([
        this.prisma.publicationCandidate.findUnique({
          where: { id: candidateId },
          include: {
            evaluation: {
              include: {
                observation: {
                  include: {
                    offer: {
                      include: {
                        marketplace: true,
                        monetization: true,
                        priceHistories: {
                          orderBy: { createdAt: 'desc' },
                          take: 1,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
        this.prisma.channel.findFirst({
          where: { id: channelId, tenantId },
        }),
        this.prisma.autopilotConfig.findUnique({
          where: { tenantId },
          include: { enabledMarketplaces: true },
        }),
        this.prisma.whatsAppSafetyConfig.findUnique({
          where: { tenantId },
        }),
        this.prisma.marketplaceIntegration.findUnique({
          where: { tenantId_provider: { tenantId, provider: 'SHOPEE' } },
          select: { status: true },
        }),
      ]);

    if (!candidate) blockers.push('CANDIDATE_NOT_FOUND');
    if (!channel) blockers.push('CHANNEL_NOT_FOUND');
    if (!config) blockers.push('AUTOPILOT_CONFIG_NOT_FOUND');

    const offer = candidate?.evaluation.observation.offer;
    const score = candidate?.evaluation.score?.toNumber() ?? null;

    if (candidate && !['PENDING', 'DEFERRED'].includes(candidate.status)) {
      blockers.push('CANDIDATE_NOT_PENDING');
    }
    if (candidate?.evaluation.decision !== 'ELIGIBLE') {
      blockers.push('EVALUATION_NOT_ELIGIBLE');
    }
    if (offer?.status !== 'ACTIVE') blockers.push('OFFER_NOT_ACTIVE');
    if (config && (score === null || score < config.minScore.toNumber())) {
      blockers.push('SCORE_BELOW_MINIMUM');
    }
    if (integration?.status !== 'CONNECTED') {
      blockers.push('SHOPEE_INTEGRATION_UNHEALTHY');
    }
    if (
      config &&
      offer &&
      !config.enabledMarketplaces.some(
        (item) => item.marketplaceId === offer.marketplaceId,
      )
    ) {
      blockers.push('MARKETPLACE_NOT_ENABLED');
    }
    if (offer?.monetization?.status !== MonetizationStatus.VERIFIED) {
      blockers.push('MONETIZATION_NOT_VERIFIED');
    }
    if (
      !offer?.monetization?.destinationUrl ||
      !offer.monetization.destinationUrl.startsWith('https://')
    ) {
      blockers.push('AFFILIATE_URL_INVALID');
    }

    if (offer) {
      const maxAge = (safetyConfig?.maxObservationAgeMinutes ?? 1440) * 60_000;
      if (
        Date.now() - candidate!.evaluation.observation.observedAt.getTime() >
        maxAge
      ) {
        blockers.push('TTL_EXPIRED');
      }
    }

    if (safetyConfig?.enabled === false || safetyConfig?.killSwitch) {
      blockers.push('WHATSAPP_KILL_SWITCH');
    }
    if (safetyConfig?.circuitState === 'OPEN') {
      blockers.push('WHATSAPP_CIRCUIT_OPEN');
    }
    if (
      safetyConfig &&
      score !== null &&
      score < safetyConfig.minQualityScore
    ) {
      blockers.push('QUALITY_SCORE_BELOW_MINIMUM');
    }

    if (channel) {
      if (!channel.enabled) blockers.push('CHANNEL_DISABLED');
      if (channel.provider !== 'WHATSAPP') {
        blockers.push('CHANNEL_PROVIDER_UNSUPPORTED');
      }
    }

    const existingPublication = await this.prisma.publication.findUnique({
      where: {
        candidateId_channelId: { candidateId, channelId },
      },
      select: { id: true, status: true },
    });
    if (existingPublication) blockers.push('PUBLICATION_ALREADY_EXISTS');

    if (offer?.marketplace?.type === 'MERCADO_LIVRE') {
      blockers.push('MERCADO_LIVRE_PUBLICATION_BLOCKED');
    }

    // Reuse the real decision brain for schedule, interval, commission,
    // integration and channel-policy checks. The one-shot is explicit, so it
    // uses an ephemeral AUTO snapshot and never persists that mode.
    if (candidate && offer && channel && config && integration) {
      const lastPublication = await this.prisma.publication.findFirst({
        where: {
          channel: { tenantId },
          status: { in: ['PUBLISHED', 'PUBLISHING', 'DELIVERY_UNKNOWN'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { publishedAt: true, createdAt: true },
      });
      const postsToday = await this.prisma.publication.count({
        where: {
          channel: { tenantId },
          status: { in: ['PUBLISHED', 'PUBLISHING', 'DELIVERY_UNKNOWN'] },
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      });
      const decision = AutopilotBrain.evaluate(
        {
          id: offer.id,
          marketplaceId: offer.marketplaceId,
          marketplaceType: offer.marketplace.type,
          score: score ?? 0,
        },
        {
          mode: AutopilotMode.AUTO,
          allowedStartMinute: config.allowedStartMinute,
          allowedEndMinute: config.allowedEndMinute,
          timezone: config.timezone,
          minScore: config.minScore.toNumber(),
          minimumCommissionCents: config.minimumCommissionCents,
          maxDailyPosts: config.maxDailyPosts,
          intervalMinutes: config.intervalMinutes,
          enabledChannelIds: [channel.id],
          enabledMarketplaceIds: [offer.marketplaceId],
        },
        {
          status: offer.monetization?.status as MonetizationStatus,
          destinationUrl: offer.monetization?.destinationUrl,
          estimatedCommissionCents:
            offer.monetization?.commissionAmountCents ?? offer.commission,
        },
        {
          postsToday,
          lastPublicationAt: lastPublication
            ? lastPublication.publishedAt ?? lastPublication.createdAt
            : undefined,
          channelStatus: {
            [channel.id]: {
              enabled: channel.enabled,
              visibility: channel.visibility,
            },
          },
          integrationHealth: {
            [offer.marketplace.type]: integration.status as IntegrationStatus,
          },
        },
        {
          now: () => new Date(),
          getMinutesSinceMidnight: (timezone: string) =>
            getMinutesSinceMidnight(new Date(), timezone),
        },
      );
      if (!decision.approved) {
        const mapped =
          !channel.enabled && decision.reason === 'REJECTED_CHANNEL_POLICY'
            ? 'CHANNEL_DISABLED'
            : `AUTOPILOT_${decision.reason}`;
        blockers.push(mapped);
      }
    }

    return {
      ready: blockers.length === 0,
      blockers: [...new Set(blockers)],
      candidateId,
      channelId,
      score,
      autopilotMode: config?.mode ?? null,
    };
  }

  async executeOneShot(
    tenantId: string,
    role: string,
    request: OneShotRequest,
  ) {
    const preflight = await this.preflightOneShot(tenantId, role, request);
    if (!preflight.ready) {
      return { status: 'BLOCKED', ...preflight };
    }

    const job = await this.publisherQueue.add(
      'controlled-one-shot',
      {
        tenantId,
        candidateId: preflight.candidateId,
        channelId: preflight.channelId,
        confirmation: request.confirmation,
      },
      {
        jobId: `controlled-one-shot-${preflight.candidateId}-${preflight.channelId}`,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    return {
      status: 'QUEUED',
      jobId: job.id,
      candidateId: preflight.candidateId,
      channelId: preflight.channelId,
      autopilotMode: preflight.autopilotMode,
    };
  }

  private assertAdmin(role: string) {
    if (role !== 'OWNER' && role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem executar one-shot.');
    }
  }
}
