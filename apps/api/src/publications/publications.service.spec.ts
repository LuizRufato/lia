import { BadRequestException } from '@nestjs/common';
import { PublicationsService } from './publications.service';

describe('PublicationsService', () => {
  const tenantId = 'tenant-1';

  function createService() {
    const publication = {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([]),
    };
    const prisma: any = {
      autopilotConfig: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ timezone: 'America/Campo_Grande' }),
      },
      publication,
      channel: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'channel-1', displayName: 'Teste' }]),
      },
      marketplace: {
        findMany: jest.fn().mockResolvedValue([{ type: 'SHOPEE' }]),
      },
    };
    return { service: new PublicationsService(prisma), prisma, publication };
  }

  const publishedRow = {
    id: 'publication-1',
    channelId: 'channel-1',
    status: 'PUBLISHED',
    createdAt: new Date('2026-08-25T12:00:00.000Z'),
    publishedAt: new Date('2026-08-25T12:01:00.000Z'),
    channel: {
      id: 'channel-1',
      displayName: 'Teste',
      provider: 'WHATSAPP',
    },
    candidate: {
      evaluation: {
        score: 82,
        observation: {
          offer: {
            id: 'offer-1',
            title: 'Fone Bluetooth',
            imageUrl: 'https://cdn.example/image.png',
            product: { name: 'Fone Bluetooth' },
            marketplace: { type: 'SHOPEE' },
          },
        },
      },
    },
    trackedLink: {
      slug: 'fone-bluetooth',
      clicks: [{ id: 'click-1' }],
    },
  };

  it('lists tenant-scoped publications with valid clicks and safe sales fields', async () => {
    const { service, publication } = createService();
    publication.findMany.mockResolvedValue([publishedRow]);

    const result = await service.list(tenantId, { page: '2', limit: '20' });

    expect(result).toMatchObject({
      page: 2,
      limit: 20,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: true,
      timezone: 'America/Campo_Grande',
    });
    expect(result.items[0]).toMatchObject({
      publicationId: 'publication-1',
      offerId: 'offer-1',
      productTitle: 'Fone Bluetooth',
      channelName: 'Teste',
      provider: 'WHATSAPP',
      marketplace: 'SHOPEE',
      status: 'PUBLISHED',
      liaScore: 82,
      validClicks: 1,
      sales: null,
      commissionCents: null,
      trackedLink: {
        slug: 'fone-bluetooth',
        url: 'https://go.botlia.com.br/fone-bluetooth',
      },
    });
    expect(publication.count.mock.calls[0][0].where.channel).toEqual({
      tenantId,
    });
    expect(publication.findMany.mock.calls[0][0]).toMatchObject({
      skip: 20,
      take: 20,
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    });
  });

  it('combines search, channel, status, marketplace and Campo Grande date filters', async () => {
    const { service, publication } = createService();

    await service.list(tenantId, {
      search: 'fone',
      channelId: 'channel-1',
      status: 'published',
      marketplace: 'shopee',
      dateFrom: '2026-08-25',
      dateTo: '2026-08-25',
    });

    const where = publication.count.mock.calls[0][0].where;
    expect(where.channel).toEqual({ tenantId, id: 'channel-1' });
    expect(where.status).toBe('PUBLISHED');
    expect(where.candidate.evaluation.observation.offer).toEqual({
      marketplace: { type: 'SHOPEE' },
      title: { contains: 'fone', mode: 'insensitive' },
    });
    expect(where.OR[0].publishedAt.gte.toISOString()).toBe(
      '2026-08-25T04:00:00.000Z',
    );
    expect(where.OR[0].publishedAt.lt.toISOString()).toBe(
      '2026-08-26T04:00:00.000Z',
    );
    expect(where.OR[1].publishedAt).toBeNull();
  });

  it('rejects unsupported status, marketplace and date values', async () => {
    const { service } = createService();

    await expect(
      service.list(tenantId, { status: 'UNKNOWN' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.list(tenantId, { marketplace: 'AMAZON' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.list(tenantId, { dateFrom: '25/08/2026' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns sanitized filter options scoped to the tenant', async () => {
    const { service, prisma } = createService();

    await expect(service.options(tenantId)).resolves.toEqual({
      channels: [{ id: 'channel-1', displayName: 'Teste' }],
      marketplaces: ['SHOPEE'],
    });
    expect(prisma.channel.findMany).toHaveBeenCalledWith({
      where: { tenantId },
      select: { id: true, displayName: true },
      orderBy: { displayName: 'asc' },
    });
    expect(prisma.marketplace.findMany).toHaveBeenCalledWith({
      where: { offers: { some: { tenantId } } },
      select: { type: true },
      orderBy: { type: 'asc' },
    });
  });
});
