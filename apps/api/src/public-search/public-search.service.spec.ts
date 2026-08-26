import { PublicSearchService } from './public-search.service';

describe('PublicSearchService', () => {
  const exactOffer = {
    id: 'offer-exact',
    title: 'iPhone 16 128GB Preto',
    price: 429900,
    imageUrl: 'https://cdn.example.com/phone.jpg',
    url: 'https://shopee.com.br/iphone',
    marketplace: { type: 'SHOPEE' },
    observations: [],
    priceHistories: [
      {
        originalPriceCents: 459900,
        discountBps: 650,
        rating: 4.8,
        salesCount: 1200,
      },
    ],
  };
  const similarOffer = {
    ...exactOffer,
    id: 'offer-similar',
    title: 'iPhone 16 Pro 256GB Preto',
  };

  function makeService() {
    const prisma = {
      tenant: { findMany: jest.fn().mockResolvedValue([{ id: 'tenant-1' }]) },
      offer: {
        findMany: jest.fn().mockResolvedValue([exactOffer, similarOffer]),
      },
      affiliateLink: {
        findUnique: jest.fn().mockResolvedValue({ id: 'affiliate-1' }),
      },
      publicTrackedLink: {
        create: jest.fn().mockResolvedValue({ token: 'public-token' }),
      },
    } as any;
    const offersService = {
      verifyMonetization: jest
        .fn()
        .mockResolvedValue({
          status: 'VERIFIED',
          affiliateUrl: 'https://s.shopee.com.br/verified',
        }),
    } as any;
    return {
      service: new PublicSearchService(prisma, offersService),
      prisma,
      offersService,
    };
  }

  it('returns only exact variant matches and creates a public tracked link', async () => {
    const { service, prisma, offersService } = makeService();

    const result = await service.search('iPhone 16 128GB');

    expect(result.status).toBe('FOUND');
    expect(result.recommendation?.title).toContain('iPhone 16 128GB');
    expect(result.recommendation?.trackedUrl).toContain('public-token');
    expect(offersService.verifyMonetization).toHaveBeenCalledWith(
      'tenant-1',
      'offer-exact',
    );
    expect(prisma.publicTrackedLink.create).toHaveBeenCalled();
  });

  it('does not present a clearly different variant as a match', async () => {
    const { service } = makeService();

    const result = await service.search('iPhone 16 512GB');

    expect(result.status).toBe('NO_EXACT_MATCH');
    expect(result.recommendation).toBeUndefined();
  });
});
