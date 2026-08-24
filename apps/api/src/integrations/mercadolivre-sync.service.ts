import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { getRedisConfig } from '@lia/core';
import { MercadoLivreAdapter } from '@lia/integrations';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma.service';
import { MercadoLivreApiError, MercadoLivreClient } from './mercadolivre.client';
import { MercadoLivreService } from './mercadolivre.service';

const MAX_ITEMS = 50;
const DETAIL_BATCH_SIZE = 20;

export interface MercadoLivreSyncResult {
  status: 'COMPLETED';
  foundCount: number;
  processedCount: number;
  createdCount: number;
  updatedCount: number;
  ignoredCount: number;
}

@Injectable()
export class MercadoLivreSyncService {
  private readonly redis = new Redis(getRedisConfig().url);
  private readonly client = new MercadoLivreClient();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mercadoLivreService: MercadoLivreService,
    @InjectQueue('offer-processing') private readonly offerQueue: Queue,
  ) {}

  async syncNow(tenantId: string): Promise<MercadoLivreSyncResult> {
    const lockKey = `meli:sync:lock:${tenantId}`;
    const ownerToken = randomBytes(16).toString('hex');
    const lock = await this.redis.set(lockKey, ownerToken, 'EX', 300, 'NX');
    if (!lock) throw new ConflictException('Já existe uma sincronização em andamento.');

    try {
      const integration = await this.prisma.marketplaceIntegration.findUnique({
        where: { tenantId_provider: { tenantId, provider: 'MERCADO_LIVRE' } },
      });
      if (!integration || integration.status !== 'CONNECTED' || !integration.publicIdentifier) {
        throw new BadRequestException('Mercado Livre não está conectado.');
      }

      let token = await this.mercadoLivreService.getAccessTokenForApi(tenantId);
      let refreshed = false;
      const requestWithSingleRefresh = async <T>(request: (accessToken: string) => Promise<T>) => {
        try {
          return await request(token);
        } catch (error) {
          if (!(error instanceof MercadoLivreApiError) || error.status !== 401 || refreshed) throw error;
          refreshed = true;
          await this.mercadoLivreService.refreshAccessToken(tenantId);
          token = await this.mercadoLivreService.getAccessTokenForApi(tenantId);
          return request(token);
        }
      };

      const search = await requestWithSingleRefresh((accessToken) =>
        this.client.searchActiveItemIds(integration.publicIdentifier!, accessToken, MAX_ITEMS),
      );
      const ids = [...new Set((search.results || []).slice(0, MAX_ITEMS))];
      const foundCount = Number(search.paging?.total ?? ids.length);
      const syncRunId = randomBytes(12).toString('hex');
      let processedCount = 0;
      let createdCount = 0;
      let updatedCount = 0;
      let ignoredCount = Math.max(foundCount - ids.length, 0);

      for (let offset = 0; offset < ids.length; offset += DETAIL_BATCH_SIZE) {
        const batch = ids.slice(offset, offset + DETAIL_BATCH_SIZE);
        const items = await requestWithSingleRefresh((accessToken) =>
          this.client.getItems(batch, accessToken),
        );

        for (const entry of items) {
          if (entry.code < 200 || entry.code >= 300 || !entry.body) {
            ignoredCount += 1;
            continue;
          }

          let canonical;
          try {
            canonical = MercadoLivreAdapter.toCanonicalOffer(entry.body);
          } catch {
            ignoredCount += 1;
            continue;
          }

          const result = await this.persistCanonicalOffer(tenantId, canonical, syncRunId);
          processedCount += 1;
          if (result.created) createdCount += 1;
          else updatedCount += 1;
        }
      }

      await this.prisma.marketplaceIntegration.update({
        where: { id: integration.id },
        data: {
          lastSyncAt: new Date(),
          lastSyncProcessedCount: processedCount,
          lastSyncFoundCount: foundCount,
          lastSyncCreatedCount: createdCount,
          lastSyncUpdatedCount: updatedCount,
          lastSyncIgnoredCount: ignoredCount,
          lastError: null,
          status: 'CONNECTED',
        },
      });

      return { status: 'COMPLETED', foundCount, processedCount, createdCount, updatedCount, ignoredCount };
    } catch (error) {
      const message = this.sanitizeError(error);
      await this.prisma.marketplaceIntegration.updateMany({
        where: { tenantId, provider: 'MERCADO_LIVRE' },
        data: { lastError: message },
      });
      throw new BadRequestException(message);
    } finally {
      await this.redis.eval(
        'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end',
        1,
        lockKey,
        ownerToken,
      );
    }
  }

  private async persistCanonicalOffer(tenantId: string, canonical: any, syncRunId: string) {
    const correlationId = `meli:${tenantId}:${syncRunId}:${createHash('sha256').update(canonical.externalOfferId).digest('hex').slice(0, 16)}`;
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
      const imageUrl = canonical.product.images.find((url: string) => url.startsWith('https://')) || undefined;
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
          schemaVersion: 'meli-v1',
          canonicalPayload: canonical,
          category: canonical.product.sourceCategory || null,
          observedAt: canonical.discoveredAt,
        },
      });
      return { offerId: offer.id, observationId: observation.id, created: !existing };
    });

    await this.offerQueue.add(
      'evaluate-offer',
      { schemaVersion: 'meli-v1', correlationId, tenantId, observationId: result.observationId, action: 'evaluate' },
      { jobId: correlationId, attempts: 5, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true },
    );
    return result;
  }

  private sanitizeError(error: unknown): string {
    if (error instanceof MercadoLivreApiError) {
      if (error.status === 401) return 'Mercado Livre rejeitou o token; autenticação necessária.';
      if (error.status === 429) return 'Mercado Livre limitou temporariamente as requisições.';
      if (error.status >= 500 || error.status === 0) return 'Mercado Livre indisponível temporariamente.';
    }
    if (error instanceof ConflictException || error instanceof BadRequestException) return error.message;
    return 'Falha segura ao sincronizar Mercado Livre.';
  }
}
