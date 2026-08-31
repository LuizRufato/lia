import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job, UnrecoverableError, DelayedError } from 'bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { randomBytes } from 'crypto';
import {
  PublishCandidateJobData,
  findProductCooldown,
  getCanonicalProductFingerprint,
  randomSendDelayMs,
  validateSendPacing,
} from '@lia/core';
import { WhatsAppPublisher } from './whatsapp.publisher';
import { WhatsAppSafetyGovernor } from './whatsapp-safety-governor';
import { AdminAlertEventsService } from '../admin-alerts/admin-alert-events.service';

@Processor('publisher', {
  concurrency: 1, // To avoid telegram rate limits and race conditions
})
@Injectable()
export class PublisherProcessor extends WorkerHost {
  private readonly logger = new Logger(PublisherProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramService: TelegramService,
    private readonly whatsappPublisher: WhatsAppPublisher,
    private readonly whatsappSafetyGovernor: WhatsAppSafetyGovernor,
    @Optional() private readonly adminAlertEvents?: AdminAlertEventsService,
  ) {
    super();
  }

  async process(job: Job<PublishCandidateJobData, any, string>): Promise<any> {
    if (job.name === 'controlled-one-shot') {
      return this.processControlledOneShot(job as Job<any, any, string>);
    }

    const { candidateId, channelId } = job.data;

    if (!channelId) {
      throw new UnrecoverableError(
        'Publication requires the channel selected by an Autopilot decision.',
      );
    }

    // 1. Load Candidate and Offer
    const candidate = await this.prisma.publicationCandidate.findUnique({
      where: { id: candidateId },
      include: {
        evaluation: {
          include: {
            observation: {
              include: {
                offer: {
                  include: {
                    monetization: true,
                    marketplace: true,
                    product: true,
                    priceHistories: {
                      orderBy: { observedAt: 'desc' },
                      take: 20,
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!candidate) {
      throw new UnrecoverableError(`Candidate ${candidateId} not found`);
    }

    const offer = candidate.evaluation.observation.offer;

    // A queued job is valid only while AUTO is active and the selected channel
    // remains explicitly authorized. This is checked before any link is created.
    const config = await this.prisma.autopilotConfig.findUnique({
      where: { tenantId: offer.tenantId },
      include: { enabledChannels: true, enabledMarketplaces: true },
    });
    const channel = await this.prisma.channel.findFirst({
      where: {
        id: channelId,
        tenantId: offer.tenantId,
        enabled: true,
        provider: { in: ['TELEGRAM', 'WHATSAPP'] },
      },
      include: { tenant: { include: { channelIntegrations: true } } },
    });
    const isConfigured = Boolean(
      config &&
      config.mode === 'AUTO' &&
      config.enabledChannels.some((item) => item.channelId === channelId) &&
      config.enabledMarketplaces.some(
        (item) => item.marketplaceId === offer.marketplaceId,
      ),
    );
    if (!channel || !isConfigured) {
      await this.prisma.publicationCandidate.update({
        where: { id: candidateId },
        data: { status: 'SKIPPED' },
      });
      return { skipped: true, reason: 'AUTOPILOT_AUTHORIZATION_REVOKED' };
    }

    // Claim the candidate atomically. A retried/concurrent job must not enter
    // affiliate-link creation or an external provider call twice.
    const claimed = await this.prisma.publicationCandidate.updateMany({
      where: { id: candidateId, status: { in: ['QUEUED', 'PUBLISHING'] } },
      data: { status: 'PUBLISHING' },
    });
    if (!claimed.count) {
      return { skipped: true, reason: 'CANDIDATE_ALREADY_CLAIMED' };
    }

    let result: any;
    try {
      result = await this.processChannel(
        job,
        candidate,
        offer,
        channel,
        (job.data as any)?.pacingLeader !== false,
        config?.timezone,
      );
    } catch (error: any) {
      if (error instanceof DelayedError) {
        await this.refreshCandidateStatus(
          candidateId,
          (job.data as any)?.fanoutChannelIds?.length,
        );
      } else {
        await this.refreshCandidateStatus(
          candidateId,
          (job.data as any)?.fanoutChannelIds?.length,
        );
      }
      throw error;
    }

    if (result.failed) {
      const fanoutChannelIds = (job.data as any)?.fanoutChannelIds || [];
      const retryableBeforePublication =
        result.reason === 'REJECTED_MONETIZATION' ||
        result.reason === 'SAFETY_GOVERNOR';
      if (retryableBeforePublication && fanoutChannelIds.length > 1) {
        await this.refreshCandidateStatus(candidateId, fanoutChannelIds.length);
        const retryAt = result.retryAt || new Date(Date.now() + 15 * 60_000);
        await job.moveToDelayed(retryAt.getTime(), job.token!);
        throw new DelayedError();
      }
      if (retryableBeforePublication) {
        await this.prisma.publicationCandidate.update({
          where: { id: candidateId },
          data: {
            status: 'DEFERRED',
            deferredReason: result.deferredReason || result.reason,
            retryAt: result.retryAt || new Date(Date.now() + 15 * 60_000),
          },
        });
        return { results: [result] };
      }
      await this.refreshCandidateStatus(candidateId, fanoutChannelIds.length);
      await this.reportPublicationFailure(job, offer, channel, result.reason);
    } else if (result.published) {
      await this.refreshCandidateStatus(
        candidateId,
        (job.data as any)?.fanoutChannelIds?.length,
      );
    }

    return { results: [result] };
  }

  /**
   * Execute one explicitly selected candidate/channel. This path is never
   * selected by the scheduler and does not require AUTO, but it repeats the
   * safety checks before entering the same real Publisher pipeline.
   */
  private async processControlledOneShot(job: Job<any, any, string>) {
    const { tenantId, candidateId, channelId, confirmation } = job.data || {};
    if (
      confirmation !== 'CONTROLLED_ONE_SHOT_REAL' ||
      typeof tenantId !== 'string' ||
      typeof candidateId !== 'string' ||
      typeof channelId !== 'string'
    ) {
      throw new UnrecoverableError('Invalid controlled one-shot request.');
    }

    const candidate = await this.prisma.publicationCandidate.findUnique({
      where: { id: candidateId },
      include: {
        evaluation: {
          include: {
            observation: {
              include: {
                offer: {
                  include: {
                    monetization: true,
                    marketplace: true,
                    product: true,
                    priceHistories: {
                      orderBy: { observedAt: 'desc' },
                      take: 20,
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (
      !candidate ||
      candidate.evaluation.observation.offer.tenantId !== tenantId
    ) {
      throw new UnrecoverableError('Controlled one-shot candidate not found.');
    }

    const offer = candidate.evaluation.observation.offer;

    if (offer.marketplace.type === 'MERCADO_LIVRE') {
      await this.prisma.publicationCandidate.update({
        where: { id: candidateId },
        data: {
          status: 'SKIPPED',
          deferredReason: 'MERCADO_LIVRE_PUBLICATION_BLOCKED',
        },
      });
      return { skipped: true, reason: 'MERCADO_LIVRE_PUBLICATION_BLOCKED' };
    }
    const config = await this.prisma.autopilotConfig.findUnique({
      where: { tenantId },
      include: { enabledMarketplaces: true },
    });
    const marketplaceIntegration =
      await this.prisma.marketplaceIntegration.findUnique({
        where: {
          tenantId_provider: {
            tenantId,
            provider: offer.marketplace.type,
          },
        },
        select: { status: true },
      });
    const channel = await this.prisma.channel.findFirst({
      where: {
        id: channelId,
        tenantId,
        provider: { in: ['TELEGRAM', 'WHATSAPP'] },
      },
      include: { tenant: { include: { channelIntegrations: true } } },
    });

    const blocker = !config
      ? 'AUTOPILOT_CONFIG_NOT_FOUND'
      : candidate.status !== 'PENDING' && candidate.status !== 'DEFERRED'
        ? 'CANDIDATE_NOT_PENDING'
        : candidate.evaluation.decision !== 'ELIGIBLE'
          ? 'EVALUATION_NOT_ELIGIBLE'
          : offer.status !== 'ACTIVE'
            ? 'OFFER_NOT_ACTIVE'
            : (candidate.evaluation.score?.toNumber() ?? 0) <
                config.minScore.toNumber()
              ? 'SCORE_BELOW_MINIMUM'
              : !config.enabledMarketplaces.some(
                    (item) => item.marketplaceId === offer.marketplaceId,
                  )
                ? 'MARKETPLACE_NOT_ENABLED'
                : marketplaceIntegration?.status !== 'CONNECTED'
                  ? 'MARKETPLACE_INTEGRATION_UNHEALTHY'
                  : !offer.monetization ||
                      offer.monetization.status !== 'VERIFIED' ||
                      !offer.monetization.destinationUrl?.startsWith('https://')
                    ? 'MONETIZATION_NOT_VERIFIED'
                    : !channel
                      ? 'CHANNEL_NOT_FOUND'
                      : !channel.enabled
                        ? 'CHANNEL_DISABLED'
                        : channel.provider !== 'WHATSAPP'
                          ? 'CHANNEL_PROVIDER_UNSUPPORTED'
                          : undefined;
    if (blocker) return { blocked: true, reason: blocker };

    const claimed = await this.prisma.publicationCandidate.updateMany({
      where: { id: candidateId, status: { in: ['PENDING', 'DEFERRED'] } },
      data: { status: 'PUBLISHING', deferredReason: null, retryAt: null },
    });
    if (!claimed.count) {
      return { skipped: true, reason: 'CANDIDATE_ALREADY_CLAIMED' };
    }

    let result: any;
    try {
      result = await this.processChannel(
        job,
        candidate,
        offer,
        channel,
        true,
        config?.timezone,
      );
    } catch (error: any) {
      await this.prisma.publicationCandidate.update({
        where: { id: candidateId },
        data: { status: 'FAILED', deferredReason: error.message },
      });
      throw error;
    }

    if (result.failed) {
      await this.prisma.publicationCandidate.update({
        where: { id: candidateId },
        data:
          result.reason === 'REJECTED_MONETIZATION' ||
          result.reason === 'SAFETY_GOVERNOR'
            ? {
                status: 'DEFERRED',
                deferredReason: result.deferredReason || result.reason,
                retryAt: result.retryAt || new Date(Date.now() + 15 * 60_000),
              }
            : { status: 'FAILED', deferredReason: result.reason || null },
      });
    } else if (result.published) {
      await this.prisma.publicationCandidate.update({
        where: { id: candidateId },
        data: { status: 'PUBLISHED' },
      });
    }

    const publication = await this.prisma.publication.findUnique({
      where: { candidateId_channelId: { candidateId, channelId } },
      select: { id: true, status: true },
    });
    await this.prisma.autopilotAudit.create({
      data: {
        tenantId,
        candidateId,
        evaluationId: candidate.evaluation.id,
        channelId,
        decision: result.published
          ? 'APPROVED'
          : result.reason === 'DELIVERY_UNKNOWN'
            ? 'DELIVERY_UNKNOWN'
            : 'SKIPPED_PERMANENT_POLICY',
        liaScore: candidate.evaluation.score || 0,
        details: {
          executionMode: 'CONTROLLED_ONE_SHOT_REAL',
          candidateId,
          offerId: offer.id,
          channelId,
          tenantId,
          publicationId: publication?.id || null,
          publicationStatus: publication?.status || null,
        },
      },
    });

    return { results: [result], publicationId: publication?.id || null };
  }

  private async processChannel(
    job: Job,
    candidate: any,
    offer: any,
    channel: any,
    manageGlobalPacing = true,
    timezone?: string,
  ) {
    const existing = await this.prisma.publication.findUnique({
      where: {
        candidateId_channelId: {
          candidateId: candidate.id,
          channelId: channel.id,
        },
      },
      select: {
        id: true,
        status: true,
        externalMessageId: true,
        trackedLink: { select: { id: true, slug: true, destinationUrl: true } },
      },
    });
    if (existing) {
      // No external retry is safe once a provider call may have happened.
      if (existing.status === 'PUBLISHED') {
        return {
          skipped: true,
          published: true,
          reason: 'PUBLICATION_ALREADY_PUBLISHED',
        };
      }
      if (existing.status === 'DELIVERY_UNKNOWN') {
        return { failed: true, reason: 'DELIVERY_UNKNOWN' };
      }
      if (existing.status !== 'PENDING' && existing.status !== 'RETRYABLE') {
        return { skipped: true, reason: 'PUBLICATION_ALREADY_EXISTS' };
      }
    }

    // 2.5 Every WhatsApp send must pass the Safety Governor immediately before
    // any affiliate/tracker side effect is created.
    if (channel.provider === 'WHATSAPP') {
      const whatsappIntegration = channel.tenant.channelIntegrations.find(
        (integration: any) => integration.provider === 'WHATSAPP',
      );
      const safety = await this.whatsappSafetyGovernor.evaluate({
        tenantId: offer.tenantId,
        channelId: channel.id,
        channel,
        integration: whatsappIntegration,
        offer,
        observedAt: candidate.evaluation.observation.observedAt,
        score: candidate.evaluation.score
          ? Number(candidate.evaluation.score)
          : 0,
        category: candidate.evaluation.observation.category,
        sellerId:
          (candidate.evaluation.observation.canonicalPayload as any)?.seller
            ?.externalId || null,
        timezone,
      });
      if (!safety.allowed) {
        return {
          failed: true,
          reason: 'SAFETY_GOVERNOR',
          deferredReason: safety.reason,
          retryAt: safety.retryAt,
        };
      }
    }

    // 2.6 Ensure Verified Affiliate Link for this specific channel
    let affiliateUrl: string;
    try {
      affiliateUrl = await this.ensureVerifiedAffiliateLink(offer, channel);
    } catch (e: any) {
      this.logger.warn(
        `Failed to verify affiliate link for channel ${channel.id}: ${e.message}`,
      );
      // Reject publication immediately
      await this.prisma.autopilotAudit.create({
        data: {
          tenantId: offer.tenantId,
          candidateId: candidate.id,
          evaluationId: candidate.evaluation.id,
          decision: 'REJECTED_MONETIZATION',
          liaScore: candidate.evaluation.score || 0,
          details: `Monetização falhou ou não pôde ser gerada para o canal ${channel.id}: ${e.message}`,
        },
      });
      return {
        failed: true,
        reason: 'REJECTED_MONETIZATION',
        error: e.message,
      };
    }

    if (
      !affiliateUrl ||
      offer.marketplace.type !== 'SHOPEE' ||
      (!affiliateUrl.includes('shopee') && !affiliateUrl.includes('shope.ee'))
    ) {
      throw new Error(
        'Bloqueio Crítico: Tentativa de injetar productLink bruto no rastreador. É exigido AffiliateUrl verificado.',
      );
    }

    if (manageGlobalPacing) {
      const sendLease = await this.claimSendLease(
        offer.tenantId,
        channel.id,
        new Date(),
      );
      if (!sendLease.acquired) {
        return {
          failed: true,
          reason: 'SAFETY_GOVERNOR',
          deferredReason: 'SEND_PACING',
          retryAt: sendLease.retryAt,
        };
      }
    }

    const productCooldown = await this.findProductCooldown(
      offer,
      channel.id,
      candidate.evaluation.observation.canonicalPayload,
      new Date(),
    );
    if (productCooldown.active) {
      if (manageGlobalPacing) await this.releaseSendLease(offer.tenantId);
      return {
        failed: true,
        reason: 'SAFETY_GOVERNOR',
        deferredReason: 'PRODUCT_COOLDOWN',
        retryAt: productCooldown.until || new Date(Date.now() + 60_000),
      };
    }

    // 3. Idempotent Publication Creation
    let publication: any = existing;
    if (!publication)
      try {
        publication = await this.prisma.publication.create({
          data: {
            candidateId: candidate.id,
            channelId: channel.id,
            status: 'PUBLISHING',
          },
        });
      } catch (error: any) {
        if (error.code === 'P2002') {
          this.logger.warn(
            `Publication already exists for candidate ${candidate.id} and channel ${channel.id}. Skipping to prevent duplication.`,
          );
          if (manageGlobalPacing) await this.releaseSendLease(offer.tenantId);
          return { skipped: true, reason: 'Duplicate' };
        }
        throw error;
      }

    // 4. Create TrackedLink
    // Slug generation with retry on collision (P2002)
    let slug = publication.trackedLink?.slug || '';
    let linkId = publication.trackedLink?.id || '';
    let retryCount = 0;
    while (!linkId && retryCount < 3) {
      slug = randomBytes(5).toString('hex');
      try {
        const link = await this.prisma.trackedLink.create({
          data: {
            slug,
            publicationId: publication.id,
            offerId: offer.id,
            destinationUrl: affiliateUrl,
            active: true,
          },
        });
        linkId = link.id;
        break;
      } catch (error: any) {
        if (error.code === 'P2002') {
          retryCount++;
          continue;
        }
        throw error;
      }
    }

    if (!linkId) {
      await this.prisma.publication.update({
        where: { id: publication.id },
        data: {
          status: 'FAILED',
          errorReason: 'Failed to generate unique slug',
        },
      });
      throw new Error('Failed to generate unique slug after 3 attempts');
    }

    // 5. Send to Channel
    const trackerBaseUrl =
      process.env.TRACKER_PUBLIC_BASE_URL ||
      process.env.TRACKER_BASE_URL ||
      'http://localhost:3002';
    const finalUrl = `${trackerBaseUrl}/${slug}`;

    const { CopyEngine } = require('@lia/core');

    const caption = CopyEngine.generate({
      title: offer.title,
      priceCents: offer.price,
      originalPriceCents:
        (offer as any).priceHistories?.[0]?.priceCents || null, // Optional, safe bypass
      currency: 'BRL',
      locale: 'pt-BR',
      discountPercentage: null, // Depending on where discount is
      couponCode: null,
      freeShipping: null,
      finalLink: finalUrl,
    });

    try {
      let messageId: string | null = null;

      if (channel.provider === 'TELEGRAM') {
        messageId = await this.telegramService.sendOfferMessage({
          chatId: channel.externalChatId,
          caption,
          imageUrl: null,
          link: finalUrl,
        });
      } else if (channel.provider === 'WHATSAPP') {
        // Obter desconto
        const discountBps = offer.priceHistories?.[0]?.discountBps || null;
        messageId = await this.whatsappPublisher.publish(
          offer.id,
          publication.id,
          channel.id,
          finalUrl,
          offer.title,
          offer.price,
          discountBps,
          {
            currentOriginalPriceCents:
              offer.priceHistories?.[0]?.originalPriceCents ?? null,
            currentObservedAt: candidate.evaluation.observation.observedAt,
            previousPrices: (offer.priceHistories || [])
              .slice(1)
              .map((history: any) => ({
                priceCents: history.priceCents,
                observedAt: history.observedAt,
              })),
            salesCount: offer.priceHistories?.[0]?.salesCount ?? null,
            rating: offer.priceHistories?.[0]?.rating ?? null,
            marketplace:
              offer.marketplace?.name || offer.marketplace?.type || 'Shopee',
            category: candidate.evaluation.observation.category,
          },
        );
      } else {
        throw new Error(`Provider ${channel.provider} not supported`);
      }

      // A provider response without an id is not proof of delivery. Keep the
      // publication conservative and never promote the candidate to PUBLISHED.
      if (!messageId) {
        await this.prisma.publication.update({
          where: { id: publication.id },
          data: {
            status: 'DELIVERY_UNKNOWN',
            errorReason:
              'Provider não retornou messageId; entrega desconhecida.',
          },
        });
        if (manageGlobalPacing) await this.releaseSendLease(offer.tenantId);
        return { failed: true, reason: 'DELIVERY_UNKNOWN' };
      }

      // 6. Success -> Save messageId
      const sentAt = new Date();
      await this.prisma.publication.update({
        where: { id: publication.id },
        data: {
          status: 'PUBLISHED',
          externalMessageId: messageId,
          publishedAt: sentAt,
        },
      });

      // Any successful fan-out channel may close the single offer-slot
      // pacing lease. The conditional update in completeSendLease makes this
      // idempotent, so only the first successful channel sets the next slot.
      await this.completeSendLease(offer.tenantId, sentAt);

      if (channel.provider === 'WHATSAPP') {
        await this.whatsappSafetyGovernor.recordSuccess(channel.tenantId);
      }

      return { success: true, published: true, messageId };
    } catch (error: any) {
      // 7. Error Handling
      if (channel.provider === 'WHATSAPP') {
        await this.whatsappSafetyGovernor.recordFailure(channel.tenantId);
      }
      if (manageGlobalPacing) await this.releaseSendLease(offer.tenantId);
      const isRateLimit = error.status === 429;
      const isNetworkTimeout =
        error.code === 'ECONNABORTED' || (error.request && !error.response);

      if (isRateLimit) {
        const retryAfter = error.response?.retryAfter || 60;
        await this.prisma.publication.update({
          where: { id: publication.id },
          data: {
            status: 'RETRYABLE',
            errorReason: `Rate limit. Retry after ${retryAfter}s`,
          },
        });

        // Use BullMQ delay
        await job.moveToDelayed(Date.now() + retryAfter * 1000, job.token!);
        throw new DelayedError();
      } else if (
        isNetworkTimeout ||
        error.message?.includes('Ambíguo') ||
        error.message?.toLowerCase().includes('ambiguous')
      ) {
        // Delivery Unknown - NEVER retry automatically to avoid duplicate spam
        await this.prisma.publication.update({
          where: { id: publication.id },
          data: {
            status: 'DELIVERY_UNKNOWN',
            errorReason: 'Timeout ambíguo após envio da requisição',
          },
        });

        return { failed: true, reason: 'DELIVERY_UNKNOWN' };
      } else {
        await this.prisma.publication.update({
          where: { id: publication.id },
          data: { status: 'FAILED', errorReason: error.message },
        });

        return { failed: true, reason: error.message };
      }
    }
  }

  private async refreshCandidateStatus(
    candidateId: string,
    expectedPublicationCount?: number,
  ) {
    const publications = await this.prisma.publication.findMany({
      where: { candidateId },
      select: { status: true },
    });
    if (
      expectedPublicationCount &&
      publications.length < expectedPublicationCount
    ) {
      await this.prisma.publicationCandidate.updateMany({
        where: { id: candidateId, status: { in: ['QUEUED', 'PUBLISHING'] } },
        data: { status: 'PUBLISHING' },
      });
      return;
    }
    const allPublished =
      publications.length > 0 &&
      publications.every((item) => item.status === 'PUBLISHED');
    const hasPendingWork = publications.some((item) =>
      ['PENDING', 'PUBLISHING', 'RETRYABLE', 'WAITING_CONNECTION'].includes(
        item.status,
      ),
    );
    await this.prisma.publicationCandidate.updateMany({
      where: { id: candidateId, status: { in: ['QUEUED', 'PUBLISHING'] } },
      data: allPublished
        ? { status: 'PUBLISHED', deferredReason: null, retryAt: null }
        : hasPendingWork
          ? { status: 'PUBLISHING' }
          : { status: 'FAILED' },
    });
  }

  private async claimSendLease(tenantId: string, channelId: string, now: Date) {
    const current = await this.prisma.autopilotConfig.findUnique({
      where: { tenantId },
      select: { id: true, nextEligibleSendAt: true, intervalMinutes: true },
    });
    if (!current) return { acquired: true, retryAt: null as Date | null };
    let retryAt = current.nextEligibleSendAt;
    if (!retryAt && current.intervalMinutes > 0) {
      const lastPublication = await this.prisma.publication.findFirst({
        where: { channel: { tenantId }, status: 'PUBLISHED' },
        orderBy: { publishedAt: 'desc' },
        select: { publishedAt: true, createdAt: true },
      });
      if (lastPublication) {
        const lastSentAt =
          lastPublication.publishedAt || lastPublication.createdAt;
        retryAt = new Date(
          lastSentAt.getTime() + current.intervalMinutes * 60_000,
        );
      }
    }
    if (retryAt && retryAt > now) {
      return { acquired: false, retryAt };
    }

    const leaseUntil = new Date(now.getTime() + 5 * 60_000);
    const claimed = await this.prisma.autopilotConfig.updateMany({
      where: {
        id: current.id,
        AND: [
          {
            OR: [
              { nextEligibleSendAt: null },
              { nextEligibleSendAt: { lte: now } },
            ],
          },
          {
            OR: [{ sendLeaseUntil: null }, { sendLeaseUntil: { lte: now } }],
          },
        ],
      },
      data: { sendLeaseUntil: leaseUntil },
    });
    return {
      acquired: claimed.count === 1,
      retryAt: claimed.count ? null : new Date(now.getTime() + 60_000),
    };
  }

  private async releaseSendLease(tenantId: string) {
    await this.prisma.autopilotConfig.updateMany({
      where: { tenantId },
      data: { sendLeaseUntil: null },
    });
  }

  private async completeSendLease(tenantId: string, sentAt: Date) {
    const config = await this.prisma.autopilotConfig.findUnique({
      where: { tenantId },
      select: {
        minSendIntervalMinutes: true,
        maxSendIntervalMinutes: true,
        intervalMinutes: true,
      },
    });
    let nextEligibleSendAt: Date | null = null;
    if (
      config?.minSendIntervalMinutes != null &&
      config.maxSendIntervalMinutes != null
    ) {
      const pacing = validateSendPacing(
        config.minSendIntervalMinutes,
        config.maxSendIntervalMinutes,
      );
      nextEligibleSendAt = new Date(
        sentAt.getTime() + randomSendDelayMs(pacing),
      );
    } else if (config && config.intervalMinutes > 0) {
      nextEligibleSendAt = new Date(
        sentAt.getTime() + config.intervalMinutes * 60_000,
      );
    }
    await this.prisma.autopilotConfig.updateMany({
      where: {
        tenantId,
        OR: [
          { nextEligibleSendAt: null },
          { nextEligibleSendAt: { lte: sentAt } },
        ],
      },
      data: { nextEligibleSendAt, sendLeaseUntil: null },
    });
  }

  private async findProductCooldown(
    offer: any,
    channelId: string,
    canonicalPayload: any,
    now: Date,
  ) {
    const policy = await this.prisma.autopilotCatalogPolicy.findFirst({
      where: { autopilotConfig: { tenantId: offer.tenantId } },
      select: { productCooldownHours: true },
    });
    if (policy?.productCooldownHours == null) {
      return { active: false, until: null as Date | null };
    }

    const from = new Date(
      now.getTime() - policy.productCooldownHours * 60 * 60 * 1000,
    );
    const publications = await this.prisma.publication.findMany({
      where: {
        channelId,
        status: 'PUBLISHED',
        createdAt: { lte: now },
        OR: [{ createdAt: { gte: from } }, { publishedAt: { gte: from } }],
      },
      select: {
        channelId: true,
        status: true,
        createdAt: true,
        publishedAt: true,
        candidate: {
          select: {
            evaluation: {
              select: {
                observation: {
                  select: {
                    canonicalPayload: true,
                    offer: {
                      select: {
                        externalId: true,
                        marketplace: { select: { type: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const records = publications.map((publication: any) => ({
      tenantId: offer.tenantId,
      channelId: publication.channelId,
      externalId:
        publication.candidate?.evaluation?.observation?.offer?.externalId || '',
      productIdentity: this.getProductIdentity(
        publication.candidate?.evaluation?.observation?.offer,
        publication.candidate?.evaluation?.observation?.canonicalPayload,
      ),
      category: null,
      status: publication.status,
      createdAt: publication.createdAt,
      publishedAt: publication.publishedAt,
    }));
    return findProductCooldown(records, {
      tenantId: offer.tenantId,
      channelId,
      externalId: offer.externalId,
      productIdentity: this.getProductIdentity(offer, canonicalPayload),
      now,
      cooldownHours: policy.productCooldownHours,
    });
  }

  private getProductIdentity(offer: any, canonicalPayload: any): string {
    const provider = offer?.marketplace?.type || 'UNKNOWN';
    return getCanonicalProductFingerprint(
      provider,
      canonicalPayload,
      canonicalPayload?.externalProductId || offer?.externalId || null,
    );
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, error: Error) {
    this.logger.error(`Publisher job ${job?.id} failed: ${error.message}`);
    if (!job || job.name === 'controlled-one-shot') return;
    const attempts = Number(job.opts.attempts || 1);
    if ((job.attemptsMade || 0) + 1 < attempts) return;
    const candidateId = (job.data as any)?.candidateId;
    const channelId = (job.data as any)?.channelId;
    if (!candidateId || !channelId) return;
    const candidate = await this.prisma.publicationCandidate.findUnique({
      where: { id: candidateId },
      select: {
        evaluation: {
          select: {
            observation: {
              select: { offer: { select: { tenantId: true, title: true } } },
            },
          },
        },
      },
    });
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { displayName: true },
    });
    if (candidate) {
      await this.reportPublicationFailure(
        job,
        candidate.evaluation.observation.offer,
        channel,
        error.message,
      );
    }
  }

  private async reportPublicationFailure(
    job: Job,
    offer: { tenantId: string; title?: string | null },
    channel: { displayName?: string | null } | null,
    error?: string | null,
  ) {
    if (!this.adminAlertEvents) return;
    try {
      await this.adminAlertEvents.createPublicationFailureAlert({
        tenantId: offer.tenantId,
        jobId: job.id ? String(job.id) : null,
        product: offer.title || null,
        channel: channel?.displayName || null,
        error,
      });
    } catch (alertError: any) {
      this.logger.error(
        `ADMIN_ALERT_PUBLICATION_FAILURE_FAILED: ${alertError?.message || alertError}`,
      );
    }
  }

  private async ensureVerifiedAffiliateLink(
    offer: any,
    channel: any,
  ): Promise<string> {
    const context = 'PUBLICATION';
    const contextId = channel.id;

    let affiliateLink = await this.prisma.affiliateLink.findUnique({
      where: {
        offerId_context_contextId: {
          offerId: offer.id,
          context,
          contextId,
        },
      },
    });

    if (
      affiliateLink &&
      affiliateLink.status === 'VERIFIED' &&
      affiliateLink.affiliateUrl
    ) {
      return affiliateLink.affiliateUrl;
    }

    if (affiliateLink && affiliateLink.status === 'VERIFYING') {
      throw new Error('Verificação já está em andamento para este canal.');
    }

    const attributionKey = randomBytes(16).toString('hex');

    if (!affiliateLink) {
      try {
        affiliateLink = await this.prisma.affiliateLink.create({
          data: {
            tenantId: offer.tenantId,
            offerId: offer.id,
            provider: 'SHOPEE',
            attributionKey,
            context,
            contextId,
            status: 'VERIFYING',
          },
        });
      } catch (e) {
        throw new Error('Verificação já iniciada concorrentemente.');
      }
    } else {
      const updateResult = await this.prisma.affiliateLink.updateMany({
        where: {
          id: affiliateLink.id,
          OR: [
            { status: { in: ['UNVERIFIED', 'FAILED'] } },
            { status: 'VERIFIED', affiliateUrl: null },
          ],
        },
        data: { status: 'VERIFYING', attributionKey },
      });
      if (updateResult.count === 0)
        throw new Error('Falha ao iniciar verificação concorrente.');
      affiliateLink = (await this.prisma.affiliateLink.findUnique({
        where: { id: affiliateLink.id },
      })) as any;
    }

    try {
      const integration = await this.prisma.marketplaceIntegration.findUnique({
        where: {
          tenantId_provider: { tenantId: offer.tenantId, provider: 'SHOPEE' },
        },
      });

      if (
        !integration ||
        !integration.publicIdentifier ||
        !integration.encryptedSecret ||
        !integration.iv ||
        !integration.authTag
      ) {
        throw new Error('Integração Shopee incompleta.');
      }

      // Imported dynamically or globally
      const {
        getEncryptionKey,
        decryptSecret,
        ShopeeAffiliateClient,
      } = require('@lia/integrations');
      const masterKey = getEncryptionKey();
      const appSecret = decryptSecret(
        integration.encryptedSecret,
        integration.iv,
        integration.authTag,
        masterKey,
      );
      const client = new ShopeeAffiliateClient(
        integration.publicIdentifier,
        appSecret,
      );

      const originUrl = offer.url; // Use original offer URL
      const response = await client.generateShortLink(originUrl, [
        'lia',
        affiliateLink!.attributionKey,
      ]);
      const shortLink = response.data?.generateShortLink?.shortLink;

      if (
        !shortLink ||
        (!shortLink.startsWith('https://s.shopee') &&
          !shortLink.startsWith('https://shope.ee'))
      ) {
        throw new Error('Shopee não retornou shortLink válido.');
      }

      await this.prisma.affiliateLink.update({
        where: { id: affiliateLink!.id },
        data: {
          status: 'VERIFIED',
          affiliateUrl: shortLink,
          verifiedAt: new Date(),
        },
      });

      await this.prisma.monetizationRecord.upsert({
        where: { offerId: offer.id },
        update: {
          provider: 'SHOPEE',
          source: 'shopee_short_link',
          status: 'VERIFIED',
          destinationUrl: shortLink,
          commissionAmountCents: offer.commission ?? null,
          verifiedAt: new Date(),
        },
        create: {
          offerId: offer.id,
          provider: 'SHOPEE',
          source: 'shopee_short_link',
          status: 'VERIFIED',
          destinationUrl: shortLink,
          commissionAmountCents: offer.commission ?? null,
          verifiedAt: new Date(),
        },
      });

      return shortLink;
    } catch (error: any) {
      await this.prisma.affiliateLink.update({
        where: { id: affiliateLink!.id },
        data: { status: 'FAILED' },
      });
      throw new Error(
        error.message || 'Falha na comunicação com a API de monetização.',
      );
    }
  }
}
