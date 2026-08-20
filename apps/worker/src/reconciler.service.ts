import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class ReconcilerService {
  private readonly logger = new Logger(ReconcilerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('offer-processing')
    private readonly offerProcessingQueue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcilePendingObservations() {
    this.logger.log('Running reconciliation for unprocessed observations...');

    // Find observations older than 5 minutes that have NO evaluations
    const threshold = new Date(Date.now() - 5 * 60 * 1000);

    const unprocessed = await this.prisma.offerObservation.findMany({
      where: {
        createdAt: { lte: threshold },
        evaluations: { none: {} },
      },
      take: 100,
      include: { offer: true },
    });

    for (const obs of unprocessed) {
      const jobId = obs.correlationId;
      const job = await this.offerProcessingQueue.getJob(jobId);

      if (!job) {
        this.logger.log(`Reconciling Observation ${obs.id}. Pushing to queue.`);
        await this.offerProcessingQueue.add(
          'evaluate-offer',
          {
            schemaVersion: obs.schemaVersion,
            correlationId: obs.correlationId,
            tenantId: obs.offer.tenantId,
            observationId: obs.id,
            action: 'evaluate',
          },
          {
            jobId,
          },
        );
      }
    }
  }
}
