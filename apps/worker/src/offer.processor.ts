import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { OfferService } from './offer.service';
import { EvaluateOfferJobSchema } from '@lia/core';

@Processor('offer-processing')
export class OfferProcessor extends WorkerHost {
  private readonly logger = new Logger(OfferProcessor.name);

  constructor(private readonly offerService: OfferService) {
    super();
  }
  async process(job: Job<any, any, string>): Promise<any> {
    const parsedData = EvaluateOfferJobSchema.safeParse(job.data);

    if (!parsedData.success) {
      this.logger.error(
        `Invalid job payload for job ${job.id}`,
        parsedData.error,
      );
      throw new Error(`Invalid job payload: ${parsedData.error.message}`);
    }

    const { observationId } = parsedData.data;

    this.logger.log(
      `Processing job ${job.id} for observation ${observationId}`,
    );

    try {
      await this.offerService.processObservation(observationId);
    } catch (error) {
      this.logger.error(
        `Failed to process observation ${observationId}`,
        error,
      );
      throw error;
    }

    return { success: true };
  }
}
