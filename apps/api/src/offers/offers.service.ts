import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ConfigService } from '@nestjs/config';
import {
  ShopeeAffiliateClient,
  decryptSecret,
  getEncryptionKey,
} from '@lia/integrations';
import { firstHttpsImageUrl } from '@lia/core';
import * as crypto from 'crypto';

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getOffersForTenant(tenantId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [total, offers] = await Promise.all([
      this.prisma.offer.count({ where: { tenantId } }),
      this.prisma.offer.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          observations: {
            orderBy: { observedAt: 'desc' },
            take: 1,
            include: {
              evaluations: {
                orderBy: { evaluatedAt: 'desc' },
                take: 1,
                include: {
                  candidate: true,
                },
              },
            },
          },
          monetization: true,
        },
      }),
    ]);

    // Format for frontend
    const items = offers.map((offer) => {
      const latestObservation = offer.observations[0];
      const latestEvaluation = latestObservation?.evaluations?.[0];
      const latestCandidate = latestEvaluation?.candidate;

      let rawObservationData: any = {};
      let canonicalPayload: any = {};

      if (latestObservation) {
        if (
          typeof latestObservation.canonicalPayload === 'object' &&
          latestObservation.canonicalPayload !== null
        ) {
          canonicalPayload = latestObservation.canonicalPayload;
        }
        if (canonicalPayload.rawObservation) {
          rawObservationData = canonicalPayload.rawObservation;
        }
      }

      return {
        id: offer.id,
        title: offer.title,
        marketplace: offer.marketplaceId,
        price: offer.price, // cents
        priceMax: rawObservationData.priceMax || null, // cents
        discountBps: canonicalPayload.pricing?.discountBps || 0,
        commission: offer.commission, // cents
        liaScore: latestEvaluation?.score
          ? latestEvaluation.score.toNumber()
          : null,
        monetizationStatus: offer.monetization?.status || 'NOT_VERIFIED',
        decision: latestEvaluation?.decision || 'PENDING',
        imageUrl:
          offer.imageUrl ||
          firstHttpsImageUrl(canonicalPayload.product?.images) ||
          null,
        url: offer.url,
      };
    });

    return {
      data: items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async verifyMonetization(tenantId: string, offerId: string) {
    // 1. Validate Offer and Tenant A vs Tenant B security
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: {
        observations: {
          orderBy: { observedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!offer || offer.tenantId !== tenantId) {
      throw new BadRequestException(
        'Offer not found or belongs to another tenant.',
      );
    }

    // 2. Fetch Origin URL from observation
    const latestObservation = offer.observations[0];
    if (!latestObservation) {
      throw new BadRequestException('No observation found for this offer.');
    }

    let canonicalPayload: any = {};
    if (
      typeof latestObservation.canonicalPayload === 'object' &&
      latestObservation.canonicalPayload !== null
    ) {
      canonicalPayload = latestObservation.canonicalPayload;
    }

    const originUrl = canonicalPayload.canonicalUrl || offer.url;
    if (!originUrl) {
      throw new BadRequestException('Product origin URL not found.');
    }

    // 3. Idempotency & Optimistic Locking
    const context = 'OFFER_VERIFICATION';

    let affiliateLink = await this.prisma.affiliateLink.findUnique({
      where: {
        offerId_context_contextId: {
          offerId,
          context,
          contextId: '',
        },
      },
    });

    if (affiliateLink && affiliateLink.status === 'VERIFIED') {
      // Keep the canonical monetization record in sync with an already
      // verified link. This also repairs links verified before this field was
      // persisted, so the Autopilot can reuse them without creating a second
      // affiliate link.
      await this.prisma.monetizationRecord.upsert({
        where: { offerId },
        update: {
          status: 'VERIFIED',
          destinationUrl: affiliateLink.affiliateUrl,
          commissionAmountCents: offer.commission,
          verifiedAt: affiliateLink.verifiedAt || new Date(),
        },
        create: {
          offerId,
          status: 'VERIFIED',
          provider: 'SHOPEE',
          source: 'shopee_open_api',
          destinationUrl: affiliateLink.affiliateUrl,
          commissionAmountCents: offer.commission,
          verifiedAt: affiliateLink.verifiedAt || new Date(),
        },
      });
      return { status: 'VERIFIED', affiliateUrl: affiliateLink.affiliateUrl };
    }

    if (affiliateLink && affiliateLink.status === 'VERIFYING') {
      throw new BadRequestException(
        'Verificação já está em andamento para esta oferta.',
      );
    }

    const attributionKey = crypto.randomBytes(16).toString('hex');

    // Concurrency control: Update to VERIFYING atomically only if not VERIFIED/VERIFYING
    if (!affiliateLink) {
      try {
        affiliateLink = await this.prisma.affiliateLink.create({
          data: {
            tenantId,
            offerId,
            provider: 'SHOPEE',
            attributionKey,
            context,
            contextId: '',
            status: 'VERIFYING',
          },
        });
      } catch (e) {
        // Unique constraint violation means another request created it first
        throw new BadRequestException(
          'Verificação já iniciada concorrentemente.',
        );
      }
    } else {
      const updateResult = await this.prisma.affiliateLink.updateMany({
        where: {
          id: affiliateLink.id,
          status: { in: ['UNVERIFIED', 'FAILED'] },
        },
        data: {
          status: 'VERIFYING',
          attributionKey, // rotate key on retry just to be safe
        },
      });

      if (updateResult.count === 0) {
        throw new BadRequestException(
          'Verificação já iniciada concorrentemente ou status inválido.',
        );
      }

      // refresh
      affiliateLink = (await this.prisma.affiliateLink.findUnique({
        where: { id: affiliateLink.id },
      })) as any;
    }

    if (!affiliateLink) {
      throw new BadRequestException('Falha ao iniciar verificação.');
    }

    try {
      // 4. Fetch Credentials and Master Key
      const integration = await this.prisma.marketplaceIntegration.findUnique({
        where: { tenantId_provider: { tenantId, provider: 'SHOPEE' } },
      });

      if (
        !integration ||
        !integration.publicIdentifier ||
        !integration.encryptedSecret ||
        !integration.iv ||
        !integration.authTag
      ) {
        throw new BadRequestException(
          'Shopee integration not fully configured.',
        );
      }

      // Validates and strips quotes cleanly
      const masterKey = getEncryptionKey();

      // Parameter order fixed: encryptedSecret, iv, authTag, masterKey
      const appSecret = decryptSecret(
        integration.encryptedSecret,
        integration.iv,
        integration.authTag,
        masterKey,
      );

      // 5. Call Shopee API
      const client = new ShopeeAffiliateClient(
        integration.publicIdentifier,
        appSecret,
      );
      const response = await client.generateShortLink(originUrl, [
        'lia',
        affiliateLink.attributionKey,
      ]);

      const shortLink = response.data?.generateShortLink?.shortLink;

      if (!shortLink || !shortLink.startsWith('https://')) {
        throw new Error(
          'Failed to generate verified affiliate link from Shopee.',
        );
      }

      // 6. Persist Result
      await this.prisma.$transaction(async (tx) => {
        await tx.affiliateLink.update({
          where: { id: affiliateLink!.id },
          data: {
            status: 'VERIFIED',
            affiliateUrl: shortLink,
            verifiedAt: new Date(),
          },
        });

        await tx.monetizationRecord.upsert({
          where: { offerId },
          update: {
            status: 'VERIFIED',
            destinationUrl: shortLink,
            commissionAmountCents: offer.commission,
            verifiedAt: new Date(),
          },
          create: {
            offerId,
            status: 'VERIFIED',
            provider: 'SHOPEE',
            source: 'shopee_open_api',
            destinationUrl: shortLink,
            commissionAmountCents: offer.commission,
            verifiedAt: new Date(),
          },
        });
      });

      return { status: 'VERIFIED', affiliateUrl: shortLink };
    } catch (error: any) {
      // Rollback status to FAILED in case of ANY error (decryption, API, serialization, network)
      console.error('Error verifying monetization for offer', offerId, error);
      await this.prisma.affiliateLink.update({
        where: { id: affiliateLink.id },
        data: { status: 'FAILED' },
      });
      throw new BadRequestException(
        error.message || 'Falha na verificação de monetização.',
      );
    }
  }
}
