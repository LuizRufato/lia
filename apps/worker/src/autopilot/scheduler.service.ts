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
import { getRedisConfig } from '@lia/core';
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
  getMinutesSinceMidnight,
  startOfLocalDay,
  nextLocalDay,
  nextScheduleStart,
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
    this.redis = new Redis(getRedisConfig().url);
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
    await this.recoverStalePublishing();
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

    // Select a due candidate before schedule checks so temporary blockers are
    // persisted as DEFERRED instead of silently disappearing.
    const eligibleEvaluation = await this.prisma.offerEvaluation.findFirst({
      where: {
        observation: {
          offer: {
            tenantId,
            marketplaceId: { in: configSnapshot.enabledMarketplaceIds },
          },
        },
        score: { gte: configSnapshot.minScore },
        decision: 'ELIGIBLE',
        candidate: {
          is: {
            status: { in: ['PENDING', 'DEFERRED'] },
            OR: [{ retryAt: null }, { retryAt: { lte: now } }],
          },
        },
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
    const candidate = eligibleEvaluation.candidate!;

    const clock: Clock = {
      now: () => now,
      getMinutesSinceMidnight: (tz: string) => getMinutesSinceMidnight(now, tz),
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
      if (configSnapshot.mode === AutopilotMode.DRY_RUN) {
        await this.createAudit(
          tenantId,
          candidate,
          eligibleEvaluation.id,
          'DEFERRED_OUTSIDE_SCHEDULE',
          eligibleEvaluation.score ? eligibleEvaluation.score.toNumber() : 0,
          undefined,
          'Fora da janela de publicação do tenant.',
        );
        return;
      }
      await this.deferCandidate(
        dbConfig,
        candidate,
        'DEFERRED_OUTSIDE_SCHEDULE',
        nextScheduleStart(
          now,
          configSnapshot.timezone,
          configSnapshot.allowedStartMinute,
          configSnapshot.allowedEndMinute,
        ),
        'Fora da janela de publicação do tenant.',
        eligibleEvaluation.id,
        0,
      );
      return;
    }

    // Build context
    // 1. lastPublicationAt. Unknown/in-flight delivery is conservative.
    const lastPub = await this.prisma.publication.findFirst({
      where: {
        channel: { tenantId },
        status: { in: ['PUBLISHED', 'PUBLISHING', 'DELIVERY_UNKNOWN'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { publishedAt: true, createdAt: true },
    });

    // 2. postsToday, bounded by the tenant's local midnight.
    const localDayStart = startOfLocalDay(now, configSnapshot.timezone);
    const postsToday = await this.prisma.publication.count({
      where: {
        channel: { tenantId },
        status: { in: ['PUBLISHED', 'PUBLISHING', 'DELIVERY_UNKNOWN'] },
        createdAt: { gte: localDayStart },
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
      lastPublicationAt: lastPub
        ? (lastPub.publishedAt ?? lastPub.createdAt)
        : undefined,
      channelStatus,
      integrationHealth,
    };

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
      // DRY_RUN is intentionally read-only for candidates/publications and
      // never verifies links or enqueues a publisher job.
      if (configSnapshot.mode === AutopilotMode.DRY_RUN) {
        await this.createAudit(tenantId, candidate, eligibleEvaluation.id, decision.reason, offer.score, decision.channelId, decision.details);
        return;
      }

      const claimed = await this.prisma.publicationCandidate.updateMany({
        where: { id: candidate.id, status: { in: ['PENDING', 'DEFERRED'] } },
        data: { status: 'QUEUED', deferredReason: null, retryAt: null },
      });
      if (!claimed.count) return;
      await this.createAudit(tenantId, candidate, eligibleEvaluation.id, decision.reason, offer.score, decision.channelId, decision.details);
      await this.publisherQueue.add(
        'publish-candidate',
        { candidateId: candidate.id, channelId: decision.channelId! },
        { jobId: `publish-${candidate.id}` },
      );
    } else {
      const temporary = new Set([
        'REJECTED_DAILY_LIMIT',
        'REJECTED_INTERVAL',
        'REJECTED_OUTSIDE_SCHEDULE',
        'REJECTED_INTEGRATION_UNHEALTHY',
        'REJECTED_MONETIZATION',
      ]);
      if (temporary.has(decision.reason)) {
        const retryAt = decision.reason === 'REJECTED_DAILY_LIMIT'
          ? nextLocalDay(now, configSnapshot.timezone)
          : decision.reason === 'REJECTED_INTERVAL' && lastPub
            ? new Date((lastPub.publishedAt ?? lastPub.createdAt).getTime() + configSnapshot.intervalMinutes * 60_000)
            : new Date(now.getTime() + 15 * 60_000);
        const auditReason = decision.reason === 'REJECTED_DAILY_LIMIT'
          ? 'DEFERRED_DAILY_LIMIT'
          : decision.reason === 'REJECTED_INTERVAL'
            ? 'DEFERRED_INTERVAL'
            : decision.reason === 'REJECTED_OUTSIDE_SCHEDULE'
              ? 'DEFERRED_OUTSIDE_SCHEDULE'
              : decision.reason === 'REJECTED_INTEGRATION_UNHEALTHY'
                ? 'DEFERRED_INTEGRATION_UNHEALTHY'
                : 'DEFERRED_MONETIZATION';
        if (configSnapshot.mode === AutopilotMode.DRY_RUN) {
          await this.createAudit(tenantId, candidate, eligibleEvaluation.id, auditReason, offer.score, decision.channelId, decision.details);
        } else {
          await this.deferCandidate(dbConfig, candidate, auditReason, retryAt, decision.details, eligibleEvaluation.id, offer.score);
        }
      } else {
        if (configSnapshot.mode === AutopilotMode.DRY_RUN) {
          await this.createAudit(tenantId, candidate, eligibleEvaluation.id, 'SKIPPED_PERMANENT_POLICY', offer.score, decision.channelId, `${decision.reason}: ${decision.details || ''}`);
          return;
        }
        await this.prisma.publicationCandidate.updateMany({
          where: { id: candidate.id, status: { in: ['PENDING', 'DEFERRED'] } },
          data: { status: 'SKIPPED', deferredReason: decision.reason, retryAt: null },
        });
        await this.createAudit(tenantId, candidate, eligibleEvaluation.id, 'SKIPPED_PERMANENT_POLICY', offer.score, decision.channelId, `${decision.reason}: ${decision.details || ''}`);
      }
    }
  }

  private async createAudit(
    tenantId: string,
    candidate: any,
    evaluationId: string,
    decision: any,
    score: number,
    channelId?: string,
    details?: string,
  ) {
    await this.prisma.autopilotAudit.create({
      data: { tenantId, candidateId: candidate.id, evaluationId, channelId, decision, liaScore: score, details },
    });
  }

  private async deferCandidate(
    dbConfig: any,
    candidate: any,
    reason: any,
    retryAt: Date,
    details: string | undefined,
    evaluationId: string,
    score: number,
  ) {
    const result = await this.prisma.publicationCandidate.updateMany({
      where: { id: candidate.id, status: { in: ['PENDING', 'DEFERRED'] } },
      data: { status: 'DEFERRED', deferredReason: reason, retryAt },
    });
    if (result.count) {
      await this.createAudit(dbConfig.tenantId, candidate, evaluationId, reason, score, undefined, details);
    }
  }

  private async recoverStalePublishing() {
    const cutoff = new Date(Date.now() - 15 * 60_000);
    const stale = await this.prisma.publication.findMany({
      where: { status: 'PUBLISHING', updatedAt: { lt: cutoff } },
      select: {
        id: true,
        candidateId: true,
        candidate: { select: { evaluationId: true } },
        channel: { select: { tenantId: true } },
      },
    });
    for (const publication of stale) {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.publication.updateMany({
          where: { id: publication.id, status: 'PUBLISHING' },
          data: {
            status: 'DELIVERY_UNKNOWN',
            errorReason: 'Publicação stale recuperada de forma conservadora.',
          },
        });
        if (updated.count) {
          await tx.publicationCandidate.updateMany({
            where: { id: publication.candidateId, status: { in: ['PUBLISHING', 'QUEUED'] } },
            data: { status: 'FAILED', deferredReason: 'DELIVERY_UNKNOWN' },
          });
          await tx.autopilotAudit.create({
            data: {
              tenantId: publication.channel.tenantId,
              candidateId: publication.candidateId,
              evaluationId: publication.candidate.evaluationId,
              decision: 'DELIVERY_UNKNOWN',
              liaScore: 0,
              details: 'Recuperação conservadora de publicação stale.',
            },
          });
        }
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
