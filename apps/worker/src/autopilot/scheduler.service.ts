import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomBytes } from 'crypto';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import {
  AutopilotBrain,
  AutopilotMode,
  AutopilotConfigSnapshot,
  MonetizationContext,
  AutopilotRuntimeContext,
  Clock,
  MonetizationStatus,
  IntegrationStatus,
  ScoredOffer,
} from '@lia/core';
import {
  decryptSecret,
  getEncryptionKey,
  ShopeeAffiliateClient,
} from '@lia/integrations';

@Injectable()
export class AutopilotSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AutopilotSchedulerService.name);
  private heartbeatInterval: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @InjectQueue('publisher') private readonly publisherQueue: Queue,
  ) {
    this.redis = new Redis(
      this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379',
    );
  }

  private redis: Redis;

  onModuleInit() {
    void this.redis.set('worker:heartbeat', '1', 'EX', 15);
    this.heartbeatInterval = setInterval(() => {
      void this.redis.set('worker:heartbeat', '1', 'EX', 15);
    }, 5000);
  }

  onModuleDestroy() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    void this.redis.quit();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async runScheduler() {
    // 1. Fetch active configs
    const configs = await this.prisma.autopilotConfig.findMany({
      where: { mode: { in: ['AUTO', 'DRY_RUN'] } },
      include: {
        enabledChannels: { include: { channel: true } },
        enabledMarketplaces: true,
      },
    });

    if (configs.length === 0) return;

    for (const dbConfig of configs) {
      await this.processConfig(dbConfig);
    }
  }

  private async processConfig(dbConfig: any) {
    const tenantId = dbConfig.tenantId;
    const lockKey = `autopilot:scheduler:lock:${tenantId}`;
    const ownerToken = randomBytes(16).toString('hex');

    // Acquire lock for 55 seconds (since cron runs every 60s)
    const lockAcquired = await this.redis.set(
      lockKey,
      ownerToken,
      'EX',
      55,
      'NX',
    );
    if (!lockAcquired) {
      this.logger.debug(`Scheduler already running for tenant ${tenantId}`);
      return;
    }

    try {
      await this.evaluateForTenant(dbConfig, tenantId);
    } catch (e: any) {
      this.logger.error(
        `Error in scheduler for tenant ${tenantId}: ${e.message}`,
        e.stack,
      );
    } finally {
      // Safe release using Lua compare-and-delete
      const luaScript = `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          return redis.call('DEL', KEYS[1])
        else
          return 0
        end
      `;
      await this.redis.eval(luaScript, 1, lockKey, ownerToken);
    }
  }

  private async evaluateForTenant(dbConfig: any, tenantId: string) {
    const now = new Date();

    // Convert to AutopilotConfigSnapshot
    const configSnapshot: AutopilotConfigSnapshot = {
      mode: dbConfig.mode as AutopilotMode,
      allowedStartMinute: dbConfig.allowedStartMinute,
      allowedEndMinute: dbConfig.allowedEndMinute,
      timezone: dbConfig.timezone,
      minScore: dbConfig.minScore.toNumber(),
      minimumCommissionCents: dbConfig.minimumCommissionCents,
      maxDailyPosts: dbConfig.maxDailyPosts,
      intervalMinutes: dbConfig.intervalMinutes,
      enabledChannelIds: dbConfig.enabledChannels.map((c: any) => c.channelId),
      enabledMarketplaceIds: dbConfig.enabledMarketplaces.map(
        (m: any) => m.marketplaceId,
      ),
    };

    // Quick short-circuit check on Schedule before fetching offers
    const clock: Clock = {
      now: () => now,
      getMinutesSinceMidnight: (tz: string) => {
        const options: Intl.DateTimeFormatOptions = {
          timeZone: tz,
          hour: 'numeric',
          minute: 'numeric',
          hourCycle: 'h23',
        };
        const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(
          now,
        );
        const hour = parseInt(
          parts.find((p) => p.type === 'hour')?.value || '0',
          10,
        );
        const minute = parseInt(
          parts.find((p) => p.type === 'minute')?.value || '0',
          10,
        );
        return hour * 60 + minute;
      },
    };

    const currentMinute = clock.getMinutesSinceMidnight(
      configSnapshot.timezone,
    );
    let withinSchedule = false;
    if (configSnapshot.allowedStartMinute <= configSnapshot.allowedEndMinute) {
      withinSchedule =
        currentMinute >= configSnapshot.allowedStartMinute &&
        currentMinute <= configSnapshot.allowedEndMinute;
    } else {
      withinSchedule =
        currentMinute >= configSnapshot.allowedStartMinute ||
        currentMinute <= configSnapshot.allowedEndMinute;
    }

    if (!withinSchedule) {
      return; // Save DB queries
    }

    // Build context
    // 1. lastPublicationAt
    const lastPub = await this.prisma.publication.findFirst({
      where: { channel: { tenantId }, status: 'PUBLISHED' },
      orderBy: { publishedAt: 'desc' },
      select: { publishedAt: true },
    });

    // 2. postsToday
    // Assuming 'today' is in the tenant timezone
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const postsToday = await this.prisma.publication.count({
      where: {
        channel: { tenantId },
        status: 'PUBLISHED',
        publishedAt: { gte: startOfDay },
      },
    });

    // 3. channelStatus & integrations
    const channelStatus: Record<string, { enabled: boolean; visibility: any }> =
      {};
    for (const ec of dbConfig.enabledChannels) {
      channelStatus[ec.channelId] = {
        enabled: ec.channel.enabled,
        visibility: ec.channel.visibility,
      };
    }

    const integrations = await this.prisma.marketplaceIntegration.findMany({
      where: { tenantId },
    });
    const integrationHealth: Record<string, IntegrationStatus> = {};
    for (const intg of integrations) {
      integrationHealth[intg.provider] = intg.status as IntegrationStatus;
    }

    const context: AutopilotRuntimeContext = {
      postsToday,
      lastPublicationAt: lastPub?.publishedAt,
      channelStatus,
      integrationHealth,
    };

    // Eligible evaluations already receive a PENDING candidate from OfferService.
    // The scheduler is the only component allowed to move it toward publication.
    const eligibleEvaluation = await this.prisma.offerEvaluation.findFirst({
      where: {
        observation: {
          offer: {
            tenantId,
            marketplaceId: { in: configSnapshot.enabledMarketplaceIds },
          },
        },
        score: { gte: configSnapshot.minScore },
        decision: 'ELIGIBLE', // Make sure they are eligible
        candidate: { is: { status: 'PENDING' } },
      },
      orderBy: { score: 'desc' },
      include: {
        candidate: true,
        observation: {
          include: {
            offer: { include: { monetization: true, marketplace: true } },
          },
        },
      },
    });

    if (!eligibleEvaluation) return;

    const dbOffer = eligibleEvaluation.observation.offer;
    const offer: ScoredOffer = {
      id: dbOffer.id,
      marketplaceId: dbOffer.marketplaceId,
      marketplaceType: dbOffer.marketplace.type,
      score: eligibleEvaluation.score ? eligibleEvaluation.score.toNumber() : 0,
    };

    let monCtx: MonetizationContext = {
      status:
        (dbOffer.monetization?.status as MonetizationStatus) ||
        MonetizationStatus.UNAVAILABLE,
      destinationUrl: dbOffer.monetization?.destinationUrl,
      estimatedCommissionCents:
        dbOffer.monetization?.commissionAmountCents ?? dbOffer.commission,
    };

    // In AUTO, generate/verify the Shopee affiliate link *before* the Brain
    // applies its VERIFIED rule. DRY_RUN remains side-effect free.
    if (configSnapshot.mode === AutopilotMode.AUTO) {
      monCtx = await this.ensureVerifiedMonetization(dbOffer, monCtx);
    }

    const decision = AutopilotBrain.evaluate(
      offer,
      configSnapshot,
      monCtx,
      context,
      clock,
    );

    if (decision.approved) {
      const candidate = eligibleEvaluation.candidate!;
      await this.prisma.publicationCandidate.update({
        where: { id: candidate.id },
        data: { status: configSnapshot.mode === 'AUTO' ? 'QUEUED' : 'SKIPPED' },
      });

      await this.prisma.autopilotAudit.create({
        data: {
          tenantId,
          candidateId: candidate.id,
          evaluationId: eligibleEvaluation.id,
          channelId: decision.channelId,
          decision: decision.reason,
          liaScore: offer.score,
          details: decision.details,
        },
      });

      if (configSnapshot.mode === 'AUTO') {
        await this.publisherQueue.add(
          'publish-candidate',
          { candidateId: candidate.id, channelId: decision.channelId! },
          {
            jobId: `publish-${candidate.id}`,
          },
        );
      }
    } else {
      const candidate = eligibleEvaluation.candidate!;
      await this.prisma.publicationCandidate.update({
        where: { id: candidate.id },
        data: { status: 'SKIPPED' },
      });

      await this.prisma.autopilotAudit.create({
        data: {
          tenantId,
          candidateId: candidate.id,
          evaluationId: eligibleEvaluation.id,
          decision: decision.reason,
          liaScore: offer.score,
          details: decision.details,
        },
      });
    }
  }

  private async ensureVerifiedMonetization(
    offer: any,
    current: MonetizationContext,
  ): Promise<MonetizationContext> {
    if (
      current.status === MonetizationStatus.VERIFIED &&
      current.destinationUrl
    ) {
      return current;
    }

    if (offer.marketplace.type !== 'SHOPEE') return current;

    const context = 'AUTOPILOT_VERIFICATION';
    const contextId = 'autopilot';
    let link = await this.prisma.affiliateLink.findUnique({
      where: { offerId_context_contextId: { offerId: offer.id, context, contextId } },
    });

    if (link?.status === 'VERIFIED' && link.affiliateUrl) {
      await this.prisma.monetizationRecord.upsert({
        where: { offerId: offer.id },
        update: { status: 'VERIFIED', destinationUrl: link.affiliateUrl, verifiedAt: link.verifiedAt ?? new Date() },
        create: {
          offerId: offer.id,
          provider: 'SHOPEE',
          source: 'shopee_short_link',
          status: 'VERIFIED',
          destinationUrl: link.affiliateUrl,
          commissionAmountCents: offer.commission,
          verifiedAt: link.verifiedAt ?? new Date(),
        },
      });
      return { ...current, status: MonetizationStatus.VERIFIED, destinationUrl: link.affiliateUrl };
    }

    try {
      const integration = await this.prisma.marketplaceIntegration.findUnique({
        where: { tenantId_provider: { tenantId: offer.tenantId, provider: 'SHOPEE' } },
      });
      if (!integration?.publicIdentifier || !integration.encryptedSecret || !integration.iv || !integration.authTag) {
        return current;
      }

      link = await this.prisma.affiliateLink.upsert({
        where: { offerId_context_contextId: { offerId: offer.id, context, contextId } },
        update: { status: 'VERIFYING' },
        create: {
          tenantId: offer.tenantId,
          offerId: offer.id,
          provider: 'SHOPEE',
          attributionKey: randomBytes(16).toString('hex'),
          context,
          contextId,
          status: 'VERIFYING',
        },
      });

      const appSecret = decryptSecret(
        integration.encryptedSecret,
        integration.iv,
        integration.authTag,
        getEncryptionKey(),
      );
      const client = new ShopeeAffiliateClient(integration.publicIdentifier, appSecret);
      const response = await client.generateShortLink(offer.url, ['lia', link.attributionKey]);
      const affiliateUrl = response.data?.generateShortLink?.shortLink;
      if (!affiliateUrl || !/^https:\/\/(s\.shopee|shope\.ee)/.test(affiliateUrl)) {
        throw new Error('Shopee não retornou shortLink válido.');
      }

      const verifiedAt = new Date();
      await this.prisma.$transaction([
        this.prisma.affiliateLink.update({
          where: { id: link.id },
          data: { status: 'VERIFIED', affiliateUrl, verifiedAt },
        }),
        this.prisma.monetizationRecord.upsert({
          where: { offerId: offer.id },
          update: {
            status: 'VERIFIED', destinationUrl: affiliateUrl,
            commissionAmountCents: offer.commission, verifiedAt,
          },
          create: {
            offerId: offer.id, provider: 'SHOPEE', source: 'shopee_short_link',
            status: 'VERIFIED', destinationUrl: affiliateUrl,
            commissionAmountCents: offer.commission, verifiedAt,
          },
        }),
      ]);
      return { ...current, status: MonetizationStatus.VERIFIED, destinationUrl: affiliateUrl };
    } catch (error: any) {
      if (link) {
        await this.prisma.affiliateLink.update({
          where: { id: link.id }, data: { status: 'FAILED' },
        });
      }
      this.logger.warn(`Autopilot monetization failed for ${offer.id}: ${error.message}`);
      return current;
    }
  }
}
