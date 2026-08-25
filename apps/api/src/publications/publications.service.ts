import { BadRequestException, Injectable } from '@nestjs/common';
import { nextLocalDay, zonedTimeToUtc } from '@lia/core';
import { PrismaService } from '../prisma.service';

const DEFAULT_TIMEZONE = 'America/Campo_Grande';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const PUBLICATION_STATUSES = [
  'PENDING',
  'PUBLISHING',
  'PUBLISHED',
  'WAITING_CONNECTION',
  'RETRYABLE',
  'DELIVERY_UNKNOWN',
  'FAILED',
] as const;
const MARKETPLACES = ['SHOPEE', 'MERCADO_LIVRE'] as const;

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendente',
  PUBLISHING: 'Publicando',
  PUBLISHED: 'Publicada',
  WAITING_CONNECTION: 'Aguardando conexão',
  RETRYABLE: 'Tentará novamente',
  DELIVERY_UNKNOWN: 'Entrega incerta',
  FAILED: 'Falhou',
};

type PublicationQuery = {
  search?: string;
  channelId?: string;
  status?: string;
  marketplace?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: string | number;
  limit?: string | number;
};

@Injectable()
export class PublicationsService {
  constructor(private readonly prisma: PrismaService) {}

  private getTimezone(value: string | null | undefined) {
    const timezone = value || DEFAULT_TIMEZONE;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
      return timezone;
    } catch {
      return DEFAULT_TIMEZONE;
    }
  }

  private parsePage(value: string | number | undefined) {
    const page = Number(value || 1);
    return Number.isInteger(page) && page > 0 ? page : 1;
  }

  private parseLimit(value: string | number | undefined) {
    const limit = Number(value || DEFAULT_LIMIT);
    if (!Number.isInteger(limit) || limit < 1) return DEFAULT_LIMIT;
    return Math.min(limit, MAX_LIMIT);
  }

  private parseDate(value: string | undefined, timezone: string, end = false) {
    if (!value) return undefined;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      throw new BadRequestException('Período inválido.');
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const start = zonedTimeToUtc(year, month, day, 0, 0, timezone);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Período inválido.');
    }
    return end ? nextLocalDay(start, timezone) : start;
  }

  private buildDateWhere(dateFrom: Date | undefined, dateTo: Date | undefined) {
    if (!dateFrom && !dateTo) return undefined;
    const range = {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lt: dateTo } : {}),
    };
    return {
      OR: [{ publishedAt: range }, { publishedAt: null, createdAt: range }],
    };
  }

  private buildWhere(
    tenantId: string,
    query: PublicationQuery,
    timezone: string,
  ) {
    const status = query.status?.trim().toUpperCase();
    const marketplace = query.marketplace?.trim().toUpperCase();
    if (status && !PUBLICATION_STATUSES.includes(status as any)) {
      throw new BadRequestException('Status inválido.');
    }
    if (marketplace && !MARKETPLACES.includes(marketplace as any)) {
      throw new BadRequestException('Marketplace inválida.');
    }

    const dateFrom = this.parseDate(query.dateFrom, timezone);
    const dateTo = this.parseDate(query.dateTo, timezone, true);
    const dateWhere = this.buildDateWhere(dateFrom, dateTo);

    const offerWhere: Record<string, unknown> = {};
    if (marketplace) {
      offerWhere.marketplace = { type: marketplace };
    }
    if (query.search?.trim()) {
      offerWhere.title = {
        contains: query.search.trim(),
        mode: 'insensitive',
      };
    }

    return {
      channel: {
        tenantId,
        ...(query.channelId ? { id: query.channelId.trim() } : {}),
      },
      ...(status ? { status } : {}),
      ...(Object.keys(offerWhere).length
        ? { candidate: { evaluation: { observation: { offer: offerWhere } } } }
        : {}),
      ...(dateWhere || {}),
    };
  }

  private toItem(publication: any) {
    const offer = publication.candidate?.evaluation?.observation?.offer;
    const evaluation = publication.candidate?.evaluation;
    const trackedLink = publication.trackedLink;
    const trackerBase =
      process.env.TRACKER_PUBLIC_BASE_URL?.replace(/\/$/, '') ||
      'https://go.botlia.com.br';

    return {
      publicationId: publication.id,
      offerId: offer?.id || null,
      productTitle: offer?.title || offer?.product?.name || 'Oferta',
      productImageUrl: offer?.imageUrl || null,
      channelId: publication.channel?.id || publication.channelId,
      channelName: publication.channel?.displayName || 'Canal',
      provider: publication.channel?.provider || null,
      marketplace: offer?.marketplace?.type || null,
      status: publication.status,
      statusLabel: STATUS_LABELS[publication.status] || publication.status,
      createdAt: publication.createdAt,
      publishedAt: publication.publishedAt,
      liaScore: evaluation?.score == null ? null : Number(evaluation.score),
      trackedLink: trackedLink
        ? {
            slug: trackedLink.slug,
            url: `${trackerBase}/${trackedLink.slug}`,
          }
        : null,
      validClicks: trackedLink?.clicks?.length || 0,
      // There is no Publication -> MarketplaceConversion relation. Affiliate
      // links are reusable by offer/channel, so attribution here is ambiguous.
      sales: null,
      commissionCents: null,
    };
  }

  async list(tenantId: string, query: PublicationQuery = {}) {
    const page = this.parsePage(query.page);
    const limit = this.parseLimit(query.limit);
    const autopilotConfig = await this.prisma.autopilotConfig.findUnique({
      where: { tenantId },
      select: { timezone: true },
    });
    const timezone = this.getTimezone(autopilotConfig?.timezone);
    const where = this.buildWhere(tenantId, query, timezone) as any;

    const [total, publications] = await Promise.all([
      this.prisma.publication.count({ where }),
      this.prisma.publication.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          channel: { select: { id: true, displayName: true, provider: true } },
          candidate: {
            include: {
              evaluation: {
                include: {
                  observation: {
                    include: {
                      offer: {
                        include: {
                          product: { select: { name: true } },
                          marketplace: { select: { type: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          trackedLink: {
            include: {
              clicks: {
                where: { classification: 'VALID' },
                select: { id: true },
              },
            },
          },
        },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    return {
      items: publications.map((publication) => this.toItem(publication)),
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      timezone,
    };
  }

  async options(tenantId: string) {
    const [channels, marketplaces] = await Promise.all([
      this.prisma.channel.findMany({
        where: { tenantId },
        select: { id: true, displayName: true },
        orderBy: { displayName: 'asc' },
      }),
      this.prisma.marketplace.findMany({
        where: { offers: { some: { tenantId } } },
        select: { type: true },
        orderBy: { type: 'asc' },
      }),
    ]);
    return {
      channels,
      marketplaces: marketplaces.map((marketplace) => marketplace.type),
    };
  }
}
