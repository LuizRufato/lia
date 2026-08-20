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
  AutopilotDecisionReason,
  ScoredOffer,
} from '@lia/core';

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
    this.heartbeatInterval = setInterval(() => {
      this.redis.set('worker:heartbeat', '1', 'EX', 15);
    }, 5000);
  }

  onModuleDestroy() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
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
    const tzOffsetMs = 0; // Proper timezone handling for "start of day" is complex, simplifying here
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

    // Fetch candidate evaluations that haven't been audited today?
    // Or just top N unused evaluations.
    // For simplicity, find the top 1 evaluation > minScore that has no PublicationCandidate.
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
        candidate: null, // Not yet turned into a candidate
      },
      orderBy: { score: 'desc' },
      include: {
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

    const monCtx: MonetizationContext = {
      status:
        (dbOffer.monetization?.status as MonetizationStatus) ||
        MonetizationStatus.UNAVAILABLE,
      destinationUrl: dbOffer.monetization?.destinationUrl,
    };

    const decision = AutopilotBrain.evaluate(
      offer,
      configSnapshot,
      monCtx,
      context,
      clock,
    );

    if (decision.approved) {
      // Create Candidate and Audit
      const candidate = await this.prisma.publicationCandidate.create({
        data: {
          evaluationId: eligibleEvaluation.id,
          status: 'QUEUED',
        },
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
          { candidateId: candidate.id },
          {
            jobId: `publish-${candidate.id}`,
          },
        );
      }
    } else {
      // Discard and audit so we don't evaluate again
      // Wait, we need to associate an Audit without creating a Candidate?
      // But AutopilotAudit requires a Candidate!
      // This means we might need to create a Candidate with status SKIPPED just to log it.
      const candidate = await this.prisma.publicationCandidate.create({
        data: {
          evaluationId: eligibleEvaluation.id,
          status: 'SKIPPED',
        },
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
}
