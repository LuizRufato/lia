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
    @InjectQueue('publisher') private readonly publisherQueue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async reconcilePendingPublications() {
    this.logger.log('Running reconciliation for PENDING publications...');

    // Find candidates PENDING for more than 2 minutes
    const threshold = new Date(Date.now() - 2 * 60 * 1000);

    const pendings = await this.prisma.publicationCandidate.findMany({
      where: {
        status: 'PENDING',
        updatedAt: { lte: threshold },
      },
      take: 100,
    });

    for (const candidate of pendings) {
      // Check if job exists in Redis
      const jobId = `pub-${candidate.id}`;
      const job = await this.publisherQueue.getJob(jobId);

      if (!job) {
        this.logger.log(
          `Reconciling Candidate ${candidate.id}. Pushing to queue.`,
        );
        await this.publisherQueue.add(
          'publish',
          { candidateId: candidate.id },
          { jobId },
        );
      }

      // Update status to QUEUED
      await this.prisma.publicationCandidate.update({
        where: { id: candidate.id },
        data: { status: 'QUEUED' },
      });
    }
  }
}
