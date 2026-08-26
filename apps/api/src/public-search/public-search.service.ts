import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { OffersService } from '../offers/offers.service';
import {
  identifyProduct,
  normalizeSearchText,
  PublicSearchInputError,
  ProductIdentity,
  tokenizeSearchText,
} from './product-identification';
import { rankPublicCandidates } from './ranking';
import { randomBytes } from 'node:crypto';

const MAX_CANDIDATES = 100;
const PUBLIC_SEARCH_SOURCE = 'PUBLIC_SEARCH';

type LocalCandidate = {
  id: string;
  title: string;
  priceCents: number;
  originalPriceCents: number | null;
  discountBps: number | null;
  rating: number | null;
  salesCount: number | null;
  liaScore: number | null;
  matchedTokens: number;
  queryTokens: number;
  imageUrl: string | null;
  marketplace: string;
  url: string;
  affiliateUrl?: string | null;
};

@Injectable()
export class PublicSearchService {
  private readonly logger = new Logger(PublicSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly offersService: OffersService,
  ) {}

  async search(query: string) {
    const startedAt = Date.now();
    let identity: ProductIdentity;

    try {
      identity = await identifyProduct(query);
    } catch (error) {
      if (error instanceof PublicSearchInputError) {
        return { status: 'INPUT_ERROR', message: error.message };
      }
      throw error;
    }

    const tenantId = await this.resolvePublicTenantId();
    const candidates = await this.findExactCandidates(tenantId, identity);

    if (!candidates.length) {
      this.logger.log(
        `Public search found no exact Shopee catalog match (source=${identity.source}, durationMs=${Date.now() - startedAt}).`,
      );
      return {
        status: 'NO_EXACT_MATCH',
        message:
          'A LIA identificou o produto, mas ainda não encontrou uma correspondência exata nas fontes disponíveis.',
        identification: this.publicIdentity(identity),
        source: 'LOCAL_CATALOG_FALLBACK',
        realtimeSearchAvailable: false,
      };
    }

    const ranked = rankPublicCandidates(candidates).slice(0, 3);
    const best = ranked[0];
    let monetized: { affiliateUrl?: string | null };

    try {
      monetized = await this.offersService.verifyMonetization(
        tenantId,
        best.id,
      );
    } catch (error: any) {
      this.logger.warn(
        `Public search monetization failed for an exact Shopee match (durationMs=${Date.now() - startedAt}): ${error?.message || 'unknown error'}`,
      );
      return {
        status: 'MARKETPLACE_UNAVAILABLE',
        message:
          'A LIA encontrou o produto, mas não conseguiu preparar um link seguro para compra agora. Tente novamente em instantes.',
        identification: this.publicIdentity(identity),
        source: 'LOCAL_CATALOG_FALLBACK',
        realtimeSearchAvailable: false,
      };
    }

    if (
      !monetized?.affiliateUrl ||
      !/^https:\/\//i.test(monetized.affiliateUrl)
    ) {
      return {
        status: 'MARKETPLACE_UNAVAILABLE',
        message:
          'A LIA encontrou o produto, mas não conseguiu preparar um link seguro para compra agora.',
        identification: this.publicIdentity(identity),
        source: 'LOCAL_CATALOG_FALLBACK',
        realtimeSearchAvailable: false,
      };
    }

    const affiliateLink = await this.prisma.affiliateLink.findUnique({
      where: {
        offerId_context_contextId: {
          offerId: best.id,
          context: 'OFFER_VERIFICATION',
          contextId: '',
        },
      },
      select: { id: true },
    });
    const token = randomBytes(18).toString('base64url');
    const publicLink = await this.prisma.publicTrackedLink.create({
      data: {
        tenantId,
        offerId: best.id,
        affiliateLinkId: affiliateLink?.id,
        token,
        source: PUBLIC_SEARCH_SOURCE,
        destinationUrl: monetized.affiliateUrl,
        updatedAt: new Date(),
      },
    });

    const trackerBase = (
      process.env.TRACKER_PUBLIC_BASE_URL || 'https://go.botlia.com.br'
    ).replace(/\/$/, '');

    this.logger.log(
      `Public search selected a verified Shopee offer (offerId=${best.id}, source=${identity.source}, durationMs=${Date.now() - startedAt}).`,
    );

    return {
      status: 'FOUND',
      message: 'A LIA encontrou a melhor oportunidade para você.',
      identification: this.publicIdentity(identity),
      source: 'LOCAL_CATALOG_FALLBACK',
      realtimeSearchAvailable: false,
      limitation:
        'A busca direcionada por palavra-chave ainda não está disponível na API Shopee habilitada para esta conta; a recomendação usa o catálogo Shopee persistido mais recente.',
      recommendation: this.publicOffer(
        best,
        `${trackerBase}/${publicLink.token}`,
        true,
      ),
      alternatives: ranked
        .slice(1)
        .map((candidate) => this.publicOffer(candidate, null, false)),
    };
  }

  async featured() {
    const tenantId = await this.resolvePublicTenantId();
    const offers = await this.prisma.offer.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        marketplace: { type: 'SHOPEE' },
        monetization: { status: 'VERIFIED', destinationUrl: { not: null } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 8,
      include: {
        marketplace: { select: { type: true } },
        monetization: { select: { destinationUrl: true } },
        priceHistories: {
          orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }],
          take: 1,
        },
        publicTrackedLinks: {
          where: { active: true, source: PUBLIC_SEARCH_SOURCE },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { token: true },
        },
      },
    });
    const trackerBase = (
      process.env.TRACKER_PUBLIC_BASE_URL || 'https://go.botlia.com.br'
    ).replace(/\/$/, '');

    return {
      data: offers.map((offer) => {
        const history = offer.priceHistories[0];
        const hasRealOriginalPrice =
          history?.originalPriceCents != null &&
          history.originalPriceCents > offer.price;
        const token = offer.publicTrackedLinks[0]?.token;
        return {
          title: offer.title,
          imageUrl: offer.imageUrl,
          marketplace: offer.marketplace.type,
          priceCents: offer.price,
          ...(hasRealOriginalPrice
            ? { originalPriceCents: history?.originalPriceCents }
            : {}),
          ...(hasRealOriginalPrice && history?.discountBps != null
            ? { discountBps: history.discountBps }
            : {}),
          ...(history?.rating != null ? { rating: history.rating } : {}),
          ...(history?.salesCount != null
            ? { salesCount: history.salesCount }
            : {}),
          trackedUrl: token ? `${trackerBase}/${token}` : null,
          searchQuery: offer.title,
        };
      }),
    };
  }

  private async resolvePublicTenantId(): Promise<string> {
    const configured = process.env.PUBLIC_SEARCH_TENANT_ID?.trim();
    if (configured) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: configured },
        select: { id: true },
      });
      if (tenant) return tenant.id;
      throw new InternalServerErrorException(
        'Public search tenant is invalid.',
      );
    }

    const tenants = await this.prisma.tenant.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 2,
      select: { id: true },
    });
    if (tenants.length !== 1) {
      throw new InternalServerErrorException(
        'Public search tenant is not configured safely.',
      );
    }
    return tenants[0].id;
  }

  private async findExactCandidates(
    tenantId: string,
    identity: ProductIdentity,
  ) {
    const queryTokens = tokenizeSearchText(
      [identity.name, identity.brand, identity.model].filter(Boolean).join(' '),
    );
    const anchor = [...queryTokens].sort((a, b) => b.length - a.length)[0];
    if (!anchor) return [];

    const offers = await this.prisma.offer.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        marketplace: { type: 'SHOPEE' },
        title: { contains: anchor, mode: 'insensitive' },
      },
      orderBy: { updatedAt: 'desc' },
      take: MAX_CANDIDATES,
      include: {
        observations: {
          orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          include: {
            evaluations: {
              orderBy: { evaluatedAt: 'desc' },
              take: 1,
            },
          },
        },
        priceHistories: {
          orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }],
          take: 1,
        },
        marketplace: { select: { type: true } },
      },
    });

    return offers.flatMap((offer) => {
      const titleTokens = tokenizeSearchText(offer.title);
      const matchedTokens = queryTokens.filter((token) =>
        titleTokens.includes(token),
      ).length;

      // Exact matching is deliberately strict. A partial match must never be
      // presented as the same product.
      if (matchedTokens !== queryTokens.length) return [];

      const observation = offer.observations[0];
      const evaluation = observation?.evaluations[0];
      const history = offer.priceHistories[0];
      const payload = (observation?.canonicalPayload || {}) as Record<
        string,
        any
      >;
      const metrics = payload.metrics || {};
      const imageUrl = offer.imageUrl || payload.product?.images?.[0] || null;

      return [
        {
          id: offer.id,
          title: offer.title,
          priceCents: offer.price,
          originalPriceCents: history?.originalPriceCents ?? null,
          discountBps: history?.discountBps ?? null,
          rating: history?.rating ?? metrics.rating ?? null,
          salesCount:
            history?.salesCount ?? metrics.marketplaceSalesCount ?? null,
          liaScore: evaluation?.score?.toNumber() ?? null,
          matchedTokens,
          queryTokens: queryTokens.length,
          imageUrl,
          marketplace: offer.marketplace.type,
          url: offer.url,
        } satisfies LocalCandidate,
      ];
    });
  }

  private publicIdentity(identity: ProductIdentity) {
    return {
      name: identity.name,
      ...(identity.brand ? { brand: identity.brand } : {}),
      ...(identity.model ? { model: identity.model } : {}),
      source: identity.source,
    };
  }

  private publicOffer(
    offer: LocalCandidate,
    trackedUrl: string | null,
    recommended: boolean,
  ) {
    const hasRealOriginalPrice =
      Number.isInteger(offer.originalPriceCents) &&
      (offer.originalPriceCents || 0) > offer.priceCents;

    return {
      title: offer.title,
      imageUrl: offer.imageUrl,
      marketplace: offer.marketplace,
      priceCents: offer.priceCents,
      ...(hasRealOriginalPrice
        ? { originalPriceCents: offer.originalPriceCents }
        : {}),
      ...(hasRealOriginalPrice && offer.discountBps
        ? { discountBps: offer.discountBps }
        : {}),
      ...(offer.rating != null ? { rating: offer.rating } : {}),
      ...(offer.salesCount != null ? { salesCount: offer.salesCount } : {}),
      ...(offer.liaScore != null ? { liaScore: offer.liaScore } : {}),
      recommendation: recommended
        ? 'Correspondência exata entre as opções Shopee disponíveis no catálogo analisado, com link afiliado verificado.'
        : 'Outra correspondência exata encontrada no catálogo Shopee analisado.',
      trackedUrl,
    };
  }
}
