import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Logger } from "@nestjs/common";
import { RpaService } from "./rpa.service";
import { PrismaService } from "./prisma.service";

export interface GenerateMeliAffiliateLinkData {
  tenantId: string;
  offerId: string;
  productUrl: string;
  channelId: string;
  attributionContext: string;
}

@Processor("meli-affiliate-rpa-queue", {
  concurrency: 1, // Rate control: Strict concurrency=1 per worker instance
})
export class RpaProcessor extends WorkerHost {
  private readonly logger = new Logger(RpaProcessor.name);

  constructor(
    private readonly rpaService: RpaService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<GenerateMeliAffiliateLinkData>): Promise<any> {
    this.logger.log(`Processing job ${job.id} for offer ${job.data.offerId}`);

    // Idempotency check via db
    const existing = await this.prisma.affiliateLink.findUnique({
      where: {
        offerId_context_contextId: {
          offerId: job.data.offerId,
          context: "PUBLICATION",
          contextId: job.data.channelId,
        },
      },
    });

    if (existing && existing.status === "VERIFIED" && existing.affiliateUrl) {
      this.logger.log(
        `Affiliate link already verified for offer ${job.data.offerId}`,
      );
      return { success: true, affiliateUrl: existing.affiliateUrl };
    }

    try {
      const affiliateUrl = await this.rpaService.generateAffiliateLink(
        job.data.tenantId,
        job.data.offerId,
        job.data.productUrl,
        job.data.attributionContext,
      );

      // Persist the verified link
      await this.prisma.affiliateLink.upsert({
        where: {
          offerId_context_contextId: {
            offerId: job.data.offerId,
            context: "PUBLICATION",
            contextId: job.data.channelId,
          },
        },
        create: {
          tenantId: job.data.tenantId,
          offerId: job.data.offerId,
          provider: "MERCADO_LIVRE",
          attributionKey: job.data.attributionContext,
          context: "PUBLICATION",
          contextId: job.data.channelId,
          status: "VERIFIED",
          affiliateUrl,
          verifiedAt: new Date(),
        },
        update: {
          status: "VERIFIED",
          affiliateUrl,
          verifiedAt: new Date(),
        },
      });

      return { success: true, affiliateUrl };
    } catch (e: any) {
      this.logger.error(`Failed job ${job.id}: ${e.message}`);

      // Update AffiliateLink to FAILED if not already
      if (existing) {
        await this.prisma.affiliateLink.update({
          where: { id: existing.id },
          data: { status: "FAILED" },
        });
      }

      throw e;
    }
  }
}
