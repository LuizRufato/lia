import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CanonicalOfferSchema, CanonicalOffer } from '@lia/core';

export interface IngestionPayload {
  correlationId: string;
  schemaVersion: string;
  tenantId: string;
  data: unknown;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('offer-processing')
    private readonly offerProcessingQueue: Queue,
  ) {}

  async processIncomingOffer(payload: IngestionPayload): Promise<void> {
    const { correlationId, schemaVersion, tenantId, data } = payload;

    // 1. Zod Validation
    let canonicalOffer: CanonicalOffer;
    try {
      canonicalOffer = CanonicalOfferSchema.parse(data);
    } catch (e) {
      this.logger.error(
        `Validation failed for correlationId ${correlationId}`,
        e,
      );
      return; // Skip invalid offers
    }

    // 2. Check Idempotency
    const existingObservation = await this.prisma.offerObservation.findUnique({
      where: { correlationId },
    });

    if (existingObservation) {
      this.logger.log(`Skipping duplicate observation: ${correlationId}`);
      return;
    }

    // 3. Persist Offer & Observation
    let offerId: string;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Upsert Marketplace idempotently
        const marketplace = await tx.marketplace.upsert({
          where: { type: canonicalOffer.marketplace as any },
          update: {},
          create: {
            name: canonicalOffer.marketplace,
            type: canonicalOffer.marketplace as any,
          },
        });
        const marketplaceId = marketplace.id;

        // Upsert Offer
        const offer = await tx.offer.upsert({
          where: {
            tenantId_marketplaceId_externalId: {
              tenantId,
              marketplaceId: marketplaceId,
              externalId: canonicalOffer.externalOfferId,
            },
          },
          create: {
            tenantId,
            marketplaceId: marketplaceId,
            externalId: canonicalOffer.externalOfferId,
            title: canonicalOffer.product.title,
            price: canonicalOffer.pricing.currentPriceCents,
            commission: canonicalOffer.commission.estimatedAmountCents ?? null,
            url: canonicalOffer.canonicalUrl,
          },
          update: {
            title: canonicalOffer.product.title,
            url: canonicalOffer.canonicalUrl,
          },
        });

        // Insert Observation
        const observation = await tx.offerObservation.create({
          data: {
            offerId: offer.id,
            correlationId,
            schemaVersion,
            canonicalPayload: canonicalOffer as any,
            category:
              canonicalOffer.product.normalizedCategory ||
              canonicalOffer.product.sourceCategory ||
              null,
            observedAt: canonicalOffer.discoveredAt,
          },
        });

        return { offerId: offer.id, observationId: observation.id };
      });

      offerId = result.offerId;

      // 4. Enqueue Job for processing
      await this.offerProcessingQueue.add(
        'evaluate-offer',
        {
          schemaVersion,
          correlationId,
          tenantId,
          observationId: result.observationId,
          action: 'evaluate',
        },
        {
          jobId: correlationId, // Ensures idempotency in BullMQ
          attempts: 5,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: true,
        },
      );

      this.logger.log(
        `Enqueued evaluation for observation ${result.observationId}`,
      );
    } catch (e) {
      this.logger.error(`Failed to ingest offer ${correlationId}`, e);
      throw e;
    }
  }
}
