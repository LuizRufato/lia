import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';

const RECONCILE_ATTEMPTS = 5;
const RECONCILE_BACKOFF = { type: 'exponential' as const, delay: 1000 };

type ReconciliationState =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed'
  | 'prioritized'
  | 'paused'
  | 'stalled'
  | 'inconsistent'
  | 'absent';

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

    const threshold = new Date(Date.now() - 5 * 60 * 1000);
    const unprocessed = await this.prisma.offerObservation.findMany({
      where: {
        createdAt: { lte: threshold },
        evaluations: { none: {} },
      },
      take: 100,
      include: { offer: true },
    });

    for (const observation of unprocessed) {
      await this.reconcileObservation(observation);
    }
  }

  async reconcileObservation(observation: any): Promise<ReconciliationState> {
    const current = await this.prisma.offerObservation.findUnique({
      where: { id: observation.id },
      select: { evaluations: { take: 1, select: { id: true } } },
    });

    if (current?.evaluations?.length) return 'completed';

    const job = await this.offerProcessingQueue.getJob(
      observation.correlationId,
    );

    if (!job) {
      await this.enqueueObservation(observation);
      return 'absent';
    }

    const state = (await job.getState()) as ReconciliationState;

    switch (state) {
      case 'waiting':
      case 'active':
      case 'delayed':
      case 'prioritized':
      case 'paused':
        // Never add a second job while a worker may still own this one.
        return state;
      case 'failed':
        if (job.attemptsMade >= RECONCILE_ATTEMPTS) {
          this.logger.error(
            `Observation ${observation.id} reached the retry limit; leaving failed job for inspection.`,
          );
          return 'failed';
        }
        await this.retryJob(job, 'failed', observation.id);
        return 'failed';
      case 'completed':
        // A completed job without an OfferEvaluation is inconsistent. Retry
        // it while preserving its BullMQ job id and idempotency.
        await this.retryJob(job, 'completed', observation.id);
        return 'inconsistent';
      default:
        // Unknown/stalled state: remove only this orphaned job and recreate it
        // with bounded retries. The observation remains in PostgreSQL.
        await job.remove();
        await this.enqueueObservation(observation);
        return 'stalled';
    }
  }

  private async retryJob(
    job: Job,
    state: 'failed' | 'completed',
    observationId: string,
  ) {
    try {
      await job.retry(state);
      this.logger.warn(
        `Requeued ${state} job ${job.id} for observation ${observationId}.`,
      );
    } catch (error) {
      this.logger.error(
        `Could not retry ${state} job ${job.id} for observation ${observationId}.`,
        error,
      );
    }
  }

  private async enqueueObservation(observation: any) {
    const jobId = observation.correlationId;
    this.logger.log(
      `Reconciling Observation ${observation.id}. Pushing to queue.`,
    );

    try {
      await this.offerProcessingQueue.add(
        'evaluate-offer',
        {
          schemaVersion: observation.schemaVersion,
          correlationId: observation.correlationId,
          tenantId: observation.offer.tenantId,
          observationId: observation.id,
          action: 'evaluate',
        },
        {
          jobId,
          attempts: RECONCILE_ATTEMPTS,
          backoff: RECONCILE_BACKOFF,
          removeOnComplete: true,
        },
      );
    } catch (error) {
      // A concurrent producer may have recreated the same job. Leave the
      // observation for the next reconciliation pass instead of looping.
      this.logger.warn(
        `Observation ${observation.id} was not enqueued in this pass.`,
      );
      this.logger.debug(error);
    }
  }
}
