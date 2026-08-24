import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { getRedisConfig } from '@lia/core';
import {
  MercadoLivreAdapter,
  MercadoLivreAdapterOverrides,
} from '@lia/integrations';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma.service';
import {
  MercadoLivreApiError,
  MercadoLivreClient,
} from './mercadolivre.client';
import { MercadoLivreService } from './mercadolivre.service';

const MAX_CATEGORIES = 5;
const MAX_HIGHLIGHTS_PER_CATEGORY = 20;
const CACHE_TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class MercadoLivreDiscoveryService {
  private readonly redis = new Redis(getRedisConfig().url);
  private readonly client = new MercadoLivreClient();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mercadoLivreService: MercadoLivreService,
    @InjectQueue('offer-processing') private readonly offerQueue: Queue,
  ) {}

  async discoverNow(tenantId: string, requestedCategoryIds: string[] = []) {
    const lockKey = `meli:discovery:lock:${tenantId}`;
    const owner = randomBytes(16).toString('hex');
    if (!(await this.redis.set(lockKey, owner, 'EX', 600, 'NX'))) {
      throw new ConflictException('Já existe uma descoberta em andamento.');
    }
    try {
      const integration = await this.prisma.marketplaceIntegration.findUnique({
        where: { tenantId_provider: { tenantId, provider: 'MERCADO_LIVRE' } },
      });
      if (
        !integration ||
        integration.status !== 'CONNECTED' ||
        !integration.publicIdentifier
      ) {
        throw new BadRequestException('Mercado Livre não está conectado.');
      }
      const token =
        await this.mercadoLivreService.getAccessTokenForApi(tenantId);
      const categories = requestedCategoryIds.length
        ? [...new Set(requestedCategoryIds)].slice(0, MAX_CATEGORIES)
        : await this.leafCategories(token);
      let foundCount = 0;
      let processedCount = 0;
      let createdCount = 0;
      let ignoredCount = 0;
      const sellerCache = new Map<string, Record<string, unknown>>();
      const reviewBudget = { remaining: 10 };
      for (const categoryId of categories) {
        let highlights: any;
        try {
          highlights = await this.client.getHighlights(
            'MLB',
            categoryId,
            token,
          );
        } catch (error) {
          if (error instanceof MercadoLivreApiError && error.status === 404)
            continue;
          throw error;
        }
        const content = Array.isArray(highlights?.content)
          ? highlights.content.slice(0, MAX_HIGHLIGHTS_PER_CATEGORY)
          : [];
        foundCount += content.length;
        for (let index = 0; index < content.length; index += 1) {
          const highlight = content[index];
          const id = typeof highlight?.id === 'string' ? highlight.id : '';
          const type = this.entityType(highlight?.type);
          if (!id || !type) {
            ignoredCount += 1;
            continue;
          }
          try {
            const item = await this.resolveItem(id, type, token);
            if (!item) {
              ignoredCount += 1;
              continue;
            }
            const overrides = await this.enrich(
              item,
              token,
              sellerCache,
              reviewBudget,
              {
                source: 'HIGHLIGHTS',
                sourceCategoryId: categoryId,
                rankingPosition: Number(highlight.position ?? index + 1),
                sourceEntityType: type,
              },
            );
            const canonical = MercadoLivreAdapter.toCanonicalOffer(
              item,
              overrides,
            );
            const result = await this.persistCanonicalOffer(
              tenantId,
              canonical,
            );
            processedCount += 1;
            if (result.created) createdCount += 1;
          } catch (error) {
            if (
              error instanceof MercadoLivreApiError &&
              [403, 404].includes(error.status)
            )
              ignoredCount += 1;
            else throw error;
          }
        }
      }
      await this.prisma.marketplaceIntegration.update({
        where: { id: integration.id },
        data: {
          lastDiscoveryAt: new Date(),
          lastDiscoveryCategoryCount: categories.length,
          lastDiscoveryFoundCount: foundCount,
          lastDiscoveryCreatedCount: createdCount,
          lastDiscoveryIgnoredCount: ignoredCount,
          lastDiscoveryError: null,
        },
      });
      return {
        status: 'COMPLETED',
        categoryCount: categories.length,
        foundCount,
        processedCount,
        createdCount,
        ignoredCount,
      };
    } catch (error) {
      const message = this.sanitizeError(error);
      await this.prisma.marketplaceIntegration.updateMany({
        where: { tenantId, provider: 'MERCADO_LIVRE' },
        data: { lastDiscoveryError: message },
      });
      throw new BadRequestException(message);
    } finally {
      await this.redis.eval(
        'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end',
        1,
        lockKey,
        owner,
      );
    }
  }

  private async leafCategories(token: string): Promise<string[]> {
    const roots = await this.client.getCategories(token);
    const leaves: string[] = [];
    const queue = roots.map((category) => category.id);
    while (queue.length && leaves.length < MAX_CATEGORIES) {
      const id = queue.shift()!;
      const cacheKey = `meli:category:MLB:${id}`;
      let category: any;
      const cached = await this.redis.get(cacheKey);
      if (cached) category = JSON.parse(cached);
      else {
        category = await this.client.getCategory(id, token);
        await this.redis.set(
          cacheKey,
          JSON.stringify(category),
          'EX',
          CACHE_TTL_SECONDS,
        );
      }
      const children = Array.isArray(category?.children_categories)
        ? category.children_categories
        : [];
      if (!children.length) leaves.push(id);
      else
        queue.push(
          ...children
            .map((child: any) => child.id)
            .filter(
              (childId: unknown): childId is string =>
                typeof childId === 'string',
            ),
        );
    }
    return leaves;
  }

  private entityType(
    type: unknown,
  ): 'ITEM' | 'PRODUCT' | 'USER_PRODUCT' | undefined {
    const normalized = String(type ?? '').toUpperCase();
    return normalized === 'ITEM' ||
      normalized === 'PRODUCT' ||
      normalized === 'USER_PRODUCT'
      ? normalized
      : undefined;
  }

  private async resolveItem(
    id: string,
    type: 'ITEM' | 'PRODUCT' | 'USER_PRODUCT',
    token: string,
  ): Promise<any | undefined> {
    if (type === 'ITEM') return this.client.getItem(id, token);
    if (type === 'PRODUCT') {
      const items = await this.client.getProductItems(id, token);
      const itemId = Array.isArray((items as any)?.results)
        ? ((items as any).results[0]?.item_id ?? (items as any).results[0]?.id)
        : undefined;
      return typeof itemId === 'string'
        ? this.client.getItem(itemId, token)
        : undefined;
    }
    const userProduct = await this.client.getUserProduct(id, token);
    const itemId =
      (userProduct as any)?.item_id ??
      (userProduct as any)?.items?.[0]?.item_id ??
      (userProduct as any)?.items?.[0]?.id;
    return typeof itemId === 'string'
      ? this.client.getItem(itemId, token)
      : undefined;
  }

  private async enrich(
    item: any,
    token: string,
    sellerCache: Map<string, Record<string, unknown>>,
    reviewBudget: { remaining: number },
    discovery: NonNullable<MercadoLivreAdapterOverrides['discovery']>,
  ): Promise<MercadoLivreAdapterOverrides> {
    let currentPriceCents: number | undefined;
    let originalPriceCents: number | undefined;
    try {
      const sale = await this.client.getSalePrice(String(item.id), token);
      if (typeof (sale as any)?.amount === 'number')
        currentPriceCents = Math.round((sale as any).amount * 100);
      if (typeof (sale as any)?.regular_amount === 'number')
        originalPriceCents = Math.round((sale as any).regular_amount * 100);
    } catch (error) {
      if (
        !(error instanceof MercadoLivreApiError) ||
        ![403, 404].includes(error.status)
      )
        throw error;
    }
    let rating: number | undefined;
    let reviewsCount: number | undefined;
    if (reviewBudget.remaining > 0) {
      reviewBudget.remaining -= 1;
      try {
        const reviews: any = await this.client.getReviews(
          String(item.id),
          token,
        );
        rating =
          typeof reviews?.rating_average === 'number'
            ? reviews.rating_average
            : undefined;
        reviewsCount =
          typeof reviews?.paging?.total === 'number'
            ? reviews.paging.total
            : undefined;
      } catch (error) {
        if (
          !(error instanceof MercadoLivreApiError) ||
          ![403, 404].includes(error.status)
        )
          throw error;
      }
    }
    const sellerId =
      item?.seller_id != null ? String(item.seller_id) : undefined;
    let seller: any = undefined;
    if (sellerId) {
      seller = sellerCache.get(sellerId);
      if (!seller) {
        const cacheKey = `meli:seller:MLB:${sellerId}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) seller = JSON.parse(cached);
        else {
          seller = await this.client.getUser(sellerId, token);
          await this.redis.set(
            cacheKey,
            JSON.stringify(seller),
            'EX',
            CACHE_TTL_SECONDS,
          );
        }
        sellerCache.set(sellerId, seller);
      }
    }
    return {
      currentPriceCents,
      originalPriceCents,
      rating,
      reviewsCount,
      discovery,
      seller: seller
        ? {
            reputationLevel:
              typeof seller.level_id === 'string' ? seller.level_id : undefined,
            completedTransactions:
              typeof seller.seller_reputation?.transactions?.completed ===
              'number'
                ? seller.seller_reputation.transactions.completed
                : undefined,
            canceledTransactions:
              typeof seller.seller_reputation?.transactions?.canceled ===
              'number'
                ? seller.seller_reputation.transactions.canceled
                : undefined,
          }
        : undefined,
    };
  }

  private async persistCanonicalOffer(tenantId: string, canonical: any) {
    const correlationId = `meli-discovery:${tenantId}:${randomBytes(12).toString('hex')}`;
    const result = await this.prisma.$transaction(async (tx) => {
      const marketplace = await tx.marketplace.upsert({
        where: { type: 'MERCADO_LIVRE' },
        update: {},
        create: { name: 'Mercado Livre', type: 'MERCADO_LIVRE' },
      });
      const existing = await tx.offer.findUnique({
        where: {
          tenantId_marketplaceId_externalId: {
            tenantId,
            marketplaceId: marketplace.id,
            externalId: canonical.externalOfferId,
          },
        },
      });
      const imageUrl = canonical.product.images.find((url: string) =>
        url.startsWith('https://'),
      );
      const offer = await tx.offer.upsert({
        where: {
          tenantId_marketplaceId_externalId: {
            tenantId,
            marketplaceId: marketplace.id,
            externalId: canonical.externalOfferId,
          },
        },
        create: {
          tenantId,
          marketplaceId: marketplace.id,
          externalId: canonical.externalOfferId,
          title: canonical.product.title,
          price: canonical.pricing.currentPriceCents,
          commission: null,
          url: canonical.canonicalUrl,
          imageUrl,
        },
        update: {
          title: canonical.product.title,
          price: canonical.pricing.currentPriceCents,
          url: canonical.canonicalUrl,
          ...(imageUrl ? { imageUrl } : {}),
        },
      });
      const observation = await tx.offerObservation.create({
        data: {
          offerId: offer.id,
          correlationId,
          schemaVersion: 'meli-discovery-v1',
          canonicalPayload: canonical,
          category: canonical.product.sourceCategory || null,
          discoverySource: canonical.discovery?.source || null,
          sourceCategoryId: canonical.discovery?.sourceCategoryId || null,
          rankingPosition: canonical.discovery?.rankingPosition || null,
          sourceEntityType: canonical.discovery?.sourceEntityType || null,
          observedAt: canonical.discoveredAt,
        },
      });
      const monetization = await tx.monetizationRecord.findUnique({
        where: { offerId: offer.id },
      });
      if (!monetization)
        await tx.monetizationRecord.create({
          data: {
            offerId: offer.id,
            provider: 'MERCADO_LIVRE',
            status: 'UNVERIFIED',
            source: 'official_discovery',
          },
        });
      return {
        offerId: offer.id,
        observationId: observation.id,
        created: !existing,
      };
    });
    await this.offerQueue.add(
      'evaluate-offer',
      {
        schemaVersion: 'meli-discovery-v1',
        correlationId,
        tenantId,
        observationId: result.observationId,
        action: 'evaluate',
      },
      {
        jobId: correlationId,
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
      },
    );
    return result;
  }

  private sanitizeError(error: unknown): string {
    if (error instanceof MercadoLivreApiError) {
      if (error.status === 401)
        return 'Mercado Livre rejeitou o token; autenticação necessária.';
      if (error.status === 403)
        return 'Mercado Livre não autorizou esta consulta.';
      if (error.status === 404)
        return 'Recurso do Mercado Livre não encontrado.';
      if (error.status === 429)
        return 'Mercado Livre limitou temporariamente as requisições.';
      if (error.status >= 500 || error.status === 0)
        return 'Mercado Livre indisponível temporariamente.';
    }
    if (
      error instanceof ConflictException ||
      error instanceof BadRequestException
    )
      return error.message;
    return 'Falha segura na descoberta do Mercado Livre.';
  }
}
