import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PublishClickJobData } from '@lia/core';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { getRedisConfig } from '@lia/core';

@Processor('clicks-queue', {
  concurrency: 5,
})
@Injectable()
export class ClickProcessor extends WorkerHost {
  private readonly logger = new Logger(ClickProcessor.name);
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    super();
    this.redis = new Redis(getRedisConfig().url);
  }

  async process(job: Job<PublishClickJobData, any, string>): Promise<any> {
    const {
      eventId,
      linkId,
      tenantId,
      clickedAt,
      classification,
      classificationReason,
      visitorHash,
      userAgentFamily,
      operatingSystem,
      deviceType,
      referrer,
      intelligenceClass,
    } = job.data;

    // 1. Idempotent Database Insert
    try {
      await this.prisma.clickEvent.create({
        data: {
          eventId,
          linkId,
          clickedAt: new Date(clickedAt),
          classification: classification as any, // mapping to enum
          classificationReason,
          intelligenceClass: intelligenceClass as any,
          visitorHash,
          userAgentFamily,
          operatingSystem,
          deviceType,
          referrer,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        this.logger.debug(`ClickEvent ${eventId} already exists. Skipping.`);
        return { skipped: true, reason: 'Duplicate' };
      }
      throw error;
    }

    // 2. Real-time Analytics (Redis)
    // Only count VALID clicks for the main dashboard metrics
    if (classification === 'VALID') {
      try {
        const dateObj = new Date(clickedAt);
        const yyyy = dateObj.getUTCFullYear();
        const MM = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getUTCDate()).padStart(2, '0');
        const HH = String(dateObj.getUTCHours()).padStart(2, '0');
        const mm = String(dateObj.getUTCMinutes()).padStart(2, '0');

        const bucket = `${yyyy}${MM}${dd}${HH}${mm}`; // YYYYMMDDHHmm

        const totalKey = `clicks:rt:${tenantId}:${bucket}`;
        const uniqueKey = `clicks:rt:unique:${tenantId}:${bucket}`;
        const offerKey = `clicks:rt:offer:${linkId}:${bucket}`;

        const pipeline = this.redis.pipeline();

        // Total clicks per minute
        pipeline.incr(totalKey);
        pipeline.expire(totalKey, 60 * 60 * 24); // 24h TTL

        // Clicks per offer
        pipeline.incr(offerKey);
        pipeline.expire(offerKey, 60 * 60 * 24);

        // Unique clicks
        if (visitorHash) {
          pipeline.sadd(uniqueKey, visitorHash);
          pipeline.expire(uniqueKey, 60 * 60 * 24);
        }

        await pipeline.exec();
      } catch (redisError: any) {
        // Analytics failure in Redis shouldn't crash the job (it's already in Postgres)
        this.logger.error(
          `Failed to update Redis metrics for event ${eventId}: ${redisError.message}`,
        );
      }
    }

    return { success: true };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    this.logger.error(`Click job ${job?.id} failed: ${error.message}`);
  }
}
