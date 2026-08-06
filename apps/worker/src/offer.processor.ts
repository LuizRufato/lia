import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { OfferService } from './offer.service';

@Processor('offer-processing')
export class OfferProcessor extends WorkerHost {
  private readonly logger = new Logger(OfferProcessor.name);

  constructor(private readonly offerService: OfferService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(
      `Processing job ${job.id} for observation ${job.data.observationId}`,
    );

    try {
      await this.offerService.processObservation(job.data.observationId);
    } catch (error) {
      this.logger.error(
        `Failed to process observation ${job.data.observationId}`,
        error,
      );
      throw error;
    }

    return { success: true };
  }
}
