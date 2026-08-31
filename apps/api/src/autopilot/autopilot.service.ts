import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../prisma.service';
import {
  AutopilotBrain,
  AutopilotMode,
  IntegrationStatus,
  MonetizationStatus,
  COMMERCIAL_CATEGORIES,
  classifyCommercialCategory,
  getMinutesSinceMidnight,
  normalizeCatalogList,
  normalizeCatalogText,
  getRedisConfig,
  validateSendPacing,
} from '@lia/core';

export const CONTROLLED_ONE_SHOT_CONFIRMATION = 'CONTROLLED_ONE_SHOT_REAL';

const DEFAULT_CATALOG_POLICY = {
  mode: 'OPEN' as const,
  allowedCategories: [] as string[],
  blockedCategories: [] as string[],
  blockedKeywords: [] as string[],
  minSalesCount: null as number | null,
  minRating: null as number | null,
  productCooldownHours: null as number | null,
  maxPerCategoryPerDay: null as number | null,
};

const DECISION_LABELS: Record<string, string> = {
  REJECTED_CATEGORY: 'Categoria não permitida',
  REJECTED_BLOCKED_CATEGORY: 'Categoria bloqueada',
  REJECTED_BLOCKED_KEYWORD: 'Palavra-chave bloqueada',
  REJECTED_MIN_SALES: 'Vendas abaixo do mínimo',
  REJECTED_MIN_RATING: 'Avaliação abaixo do mínimo',
  REJECTED_PRODUCT_COOLDOWN: 'Produto publicado recentemente',
  REJECTED_CATEGORY_DAILY_LIMIT: 'Limite diário desta categoria atingido',
};

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

  private async getWorkerHeartbeat() {
    const redis = new Redis(getRedisConfig().url);
    try {
      const ttlMilliseconds = await redis.pttl('worker:heartbeat');
      if (ttlMilliseconds <= 0) {
        return { active: false, ageSeconds: null };
      }

      const ageSeconds = Math.max(
        0,
        Math.min(15, Math.round((15_000 - ttlMilliseconds) / 1_000)),
      );
      return { active: true, ageSeconds };
    } catch {
      return { active: false, ageSeconds: null };
    } finally {
      redis.disconnect();
    }
  }

  async getStatus(tenantId: string) {
    const config = await this.prisma.autopilotConfig.findUnique({
      where: { tenantId },
      select: { mode: true },
    });

    return { mode: config?.mode || 'OFF' };
  }

  async getDashboard(tenantId: string) {
    let config = await this.prisma.autopilotConfig.findUnique({
      where: { tenantId },
      include: {
        enabledChannels: { include: { channel: true } },
        enabledMarketplaces: { include: { marketplace: true } },
        catalogPolicy: true,
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
          catalogPolicy: true,
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
      label: DECISION_LABELS[f.decision] || f.decision,
      createdAt: f.createdAt,
    }));

    const connectedProviders = (
      await this.prisma.marketplaceIntegration.findMany({
        where: { tenantId, status: 'CONNECTED' },
        select: { provider: true },
      })
    ).map((integration) => integration.provider);

    const enabledMarketplaceIds = config.enabledMarketplaces.map(
      (marketplace) => marketplace.marketplaceId,
    );
    const minScore = config.minScore.toNumber();
    const [
      shopeeIntegration,
      eligibleCandidates,
      workerHeartbeat,
      lastEvaluation,
    ] = await Promise.all([
      this.prisma.marketplaceIntegration.findFirst({
        where: { tenantId, provider: 'SHOPEE' },
        select: { lastDiscoveryAt: true },
      }),
      this.prisma.offerEvaluation.count({
        where: {
          observation: {
            offer: {
              tenantId,
              marketplaceId: { in: enabledMarketplaceIds },
            },
          },
          score: { gte: minScore },
          decision: 'ELIGIBLE',
          candidate: {
            is: {
              status: { in: ['PENDING', 'DEFERRED'] },
              OR: [{ retryAt: null }, { retryAt: { lte: new Date() } }],
            },
          },
        },
      }),
      this.getWorkerHeartbeat(),
      this.prisma.offerEvaluation.findFirst({
        where: {
          observation: {
            offer: {
              tenantId,
              marketplace: { type: 'SHOPEE' },
            },
          },
        },
        orderBy: { evaluatedAt: 'desc' },
        select: { evaluatedAt: true },
      }),
    ]);

    return {
      mode: config.mode,
      config: {
        allowedStartMinute: config.allowedStartMinute,
        allowedEndMinute: config.allowedEndMinute,
        intervalMinutes: config.intervalMinutes,
        minSendIntervalMinutes: config.minSendIntervalMinutes,
        maxSendIntervalMinutes: config.maxSendIntervalMinutes,
        nextEligibleSendAt: config.nextEligibleSendAt,
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
        catalogPolicy: this.serializeCatalogPolicy(config.catalogPolicy),
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
      operationalStatus: {
        worker: workerHeartbeat,
        lastShopeeDiscoveryAt: shopeeIntegration?.lastDiscoveryAt || null,
        eligibleCandidates,
        lastEvaluationAt: lastEvaluation?.evaluatedAt || null,
        lastDecisionAt: feedRaw[0]?.createdAt || null,
        nextOpportunity:
          eligibleCandidates > 0
            ? 'Oferta elegível disponível'
            : 'Aguardando nova oferta com score mínimo',
      },
      feed,
    };
  }

  async getCatalogCategories(tenantId: string) {
    const offers = await this.prisma.offer.findMany({
      where: { tenantId },
      select: {
        title: true,
        observations: {
          orderBy: { observedAt: 'desc' },
          take: 1,
          select: { category: true },
        },
      },
    });

    const observedCounts = new Map<string, number>();
    for (const offer of offers) {
      const slug = classifyCommercialCategory({
        title: offer.title,
        rawCategory: offer.observations[0]?.category || null,
      });
      observedCounts.set(slug, (observedCounts.get(slug) || 0) + 1);
    }

    const publications = await this.prisma.publication.findMany({
      where: { status: 'PUBLISHED', channel: { tenantId } },
      select: {
        candidate: {
          select: {
            evaluation: {
              select: {
                observation: {
                  select: {
                    category: true,
                    offer: { select: { title: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    const publishedCounts = new Map<string, number>();
    for (const publication of publications) {
      const observation = publication.candidate?.evaluation?.observation;
      if (!observation) continue;
      const slug = classifyCommercialCategory({
        title: observation.offer.title,
        rawCategory: observation.category,
      });
      publishedCounts.set(slug, (publishedCounts.get(slug) || 0) + 1);
    }

    return {
      categories: COMMERCIAL_CATEGORIES.map(({ slug, label }) => ({
        slug,
        label,
        observedCount: observedCounts.get(slug) || 0,
        publishedCount: publishedCounts.get(slug) || 0,
      })),
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
      minSendIntervalMinutes,
      maxSendIntervalMinutes,
      minScore,
      minimumCommissionCents,
      maxDailyPosts,
      timezone,
      enabledChannelIds,
      enabledMarketplaceIds,
      catalogPolicy,
    } = payload;

    if (
      !Object.values(['OFF', 'MANUAL', 'DRY_RUN', 'AUTO']).includes(mode) ||
      !Number.isInteger(allowedStartMinute) ||
      !Number.isInteger(allowedEndMinute) ||
      !Number.isInteger(intervalMinutes) ||
      !Number.isFinite(minScore) ||
      !Number.isInteger(minimumCommissionCents) ||
      !Number.isInteger(maxDailyPosts) ||
      allowedStartMinute < 0 ||
      allowedStartMinute > 1439 ||
      allowedEndMinute < 0 ||
      allowedEndMinute > 1439 ||
      intervalMinutes < 1 ||
      maxDailyPosts < 0 ||
      minScore < 0 ||
      minScore > 100 ||
      minimumCommissionCents < 0
    ) {
      throw new BadRequestException('Configuração do Autopilot inválida.');
    }

    const pacingProvided =
      minSendIntervalMinutes !== undefined ||
      maxSendIntervalMinutes !== undefined;
    let pacingPatch: {
      minSendIntervalMinutes?: number | null;
      maxSendIntervalMinutes?: number | null;
    } = {};
    if (pacingProvided) {
      if (minSendIntervalMinutes === null && maxSendIntervalMinutes === null) {
        pacingPatch = {
          minSendIntervalMinutes: null,
          maxSendIntervalMinutes: null,
        };
      } else {
        try {
          const pacing = validateSendPacing(
            minSendIntervalMinutes,
            maxSendIntervalMinutes,
          );
          pacingPatch = {
            minSendIntervalMinutes: pacing.minMinutes,
            maxSendIntervalMinutes: pacing.maxMinutes,
          };
        } catch {
          throw new BadRequestException('Cadência de envio inválida.');
        }
      }
    }

    const normalizedCatalogPolicy =
      catalogPolicy === undefined
        ? null
        : this.validateCatalogPolicy(catalogPolicy);

    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    } catch {
      throw new BadRequestException('Fuso horário IANA inválido.');
    }

    const channelIds = Array.isArray(enabledChannelIds)
      ? enabledChannelIds
      : [];
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
    if (
      channels.length !== new Set(channelIds).size ||
      marketplaces.length !== new Set(marketplaceIds).size
    ) {
      throw new BadRequestException(
        'Selecione apenas canais ativos e marketplaces conectados.',
      );
    }

    const config = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.autopilotConfig.upsert({
        where: { tenantId },
        update: {
          mode,
          allowedStartMinute,
          allowedEndMinute,
          intervalMinutes,
          minScore,
          minimumCommissionCents,
          maxDailyPosts,
          timezone,
          ...pacingPatch,
        },
        create: {
          tenantId,
          mode,
          allowedStartMinute,
          allowedEndMinute,
          intervalMinutes,
          minScore,
          minimumCommissionCents,
          maxDailyPosts,
          timezone,
          ...pacingPatch,
        },
      });
      await tx.autopilotChannelConfig.deleteMany({
        where: { autopilotConfigId: saved.id },
      });
      await tx.autopilotMarketplaceConfig.deleteMany({
        where: { autopilotConfigId: saved.id },
      });
      if (channelIds.length) {
        await tx.autopilotChannelConfig.createMany({
          data: channelIds.map((channelId) => ({
            autopilotConfigId: saved.id,
            channelId,
          })),
        });
      }
      if (marketplaceIds.length) {
        await tx.autopilotMarketplaceConfig.createMany({
          data: marketplaceIds.map((marketplaceId) => ({
            autopilotConfigId: saved.id,
            marketplaceId,
          })),
        });
      }
      if (normalizedCatalogPolicy) {
        await tx.autopilotCatalogPolicy.upsert({
          where: { autopilotConfigId: saved.id },
          update: normalizedCatalogPolicy,
          create: { autopilotConfigId: saved.id, ...normalizedCatalogPolicy },
        });
      }
      return saved;
    });

    return {
      success: true,
      config,
      catalogPolicy: normalizedCatalogPolicy || DEFAULT_CATALOG_POLICY,
    };
  }

  private serializeCatalogPolicy(policy: any) {
    return {
      mode: policy?.mode || DEFAULT_CATALOG_POLICY.mode,
      allowedCategories: policy?.allowedCategories || [],
      blockedCategories: policy?.blockedCategories || [],
      blockedKeywords: policy?.blockedKeywords || [],
      minSalesCount: policy?.minSalesCount ?? null,
      minRating: policy?.minRating ?? null,
      productCooldownHours: policy?.productCooldownHours ?? null,
      maxPerCategoryPerDay: policy?.maxPerCategoryPerDay ?? null,
    };
  }

  private validateCatalogPolicy(value: any) {
    if (!value || typeof value !== 'object') {
      throw new BadRequestException('Política de catálogo inválida.');
    }
    const mode =
      value.mode === 'SELECTED_CATEGORIES'
        ? value.mode
        : value.mode === 'OPEN'
          ? value.mode
          : null;
    if (!mode)
      throw new BadRequestException('Estratégia de catálogo inválida.');

    const list = (input: unknown, max: number, label: string) => {
      if (input !== undefined && !Array.isArray(input)) {
        throw new BadRequestException(`${label} inválido.`);
      }
      const normalized = normalizeCatalogList(input || []);
      if (normalized.length > max) {
        throw new BadRequestException(`${label} excede o limite permitido.`);
      }
      return normalized;
    };
    const nullableInteger = (input: unknown, label: string, max: number) => {
      if (input === null || input === undefined || input === '') return null;
      if (
        !Number.isInteger(input) ||
        Number(input) < 0 ||
        Number(input) > max
      ) {
        throw new BadRequestException(`${label} inválido.`);
      }
      return Number(input);
    };
    const minRating =
      value.minRating === null ||
      value.minRating === undefined ||
      value.minRating === ''
        ? null
        : Number(value.minRating);
    if (
      minRating !== null &&
      (!Number.isFinite(minRating) || minRating < 0 || minRating > 5)
    ) {
      throw new BadRequestException('Avaliação mínima inválida.');
    }

    return {
      mode,
      allowedCategories: list(
        value.allowedCategories,
        500,
        'Categorias permitidas',
      ),
      blockedCategories: list(
        value.blockedCategories,
        500,
        'Categorias bloqueadas',
      ),
      blockedKeywords: list(value.blockedKeywords, 50, 'Palavras bloqueadas'),
      minSalesCount: nullableInteger(
        value.minSalesCount,
        'Vendas mínimas',
        2_000_000_000,
      ),
      minRating,
      productCooldownHours: nullableInteger(
        value.productCooldownHours,
        'Cooldown',
        8_760,
      ),
      maxPerCategoryPerDay: nullableInteger(
        value.maxPerCategoryPerDay,
        'Limite diário por categoria',
        100_000,
      ),
    };
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
            ? (lastPublication.publishedAt ?? lastPublication.createdAt)
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
      throw new ForbiddenException(
        'Apenas administradores podem executar one-shot.',
      );
    }
  }
}
