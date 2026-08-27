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

  function makeService(offers = [exactOffer, similarOffer]) {
    const prisma = {
      tenant: { findMany: jest.fn().mockResolvedValue([{ id: 'tenant-1' }]) },
      marketplaceIntegration: {
        findMany: jest.fn().mockResolvedValue([{ provider: 'SHOPEE' }]),
      },
      offer: {
        findMany: jest.fn().mockResolvedValue(offers),
      },
      affiliateLink: {
        findUnique: jest.fn().mockResolvedValue({ id: 'affiliate-1' }),
      },
      publicTrackedLink: {
        create: jest.fn().mockResolvedValue({ token: 'public-token' }),
      },
    } as any;
    const offersService = {
      verifyMonetization: jest.fn().mockResolvedValue({
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

  it.each([
    ['iPhone', 'Microfone de lapela compatível com iPhone'],
    ['iPhone', 'Capa anti impacto para iPhone'],
    ['TV', 'Base suporte para TV'],
    ['notebook', 'Mochila para notebook'],
  ])(
    'does not present %s accessories as the main product',
    async (query, title) => {
      const accessory = { ...exactOffer, id: `accessory-${query}`, title };
      const { service, offersService } = makeService([accessory]);

      const result = await service.search(query);

      expect(result.status).toBe('NO_EXACT_MATCH');
      expect(offersService.verifyMonetization).not.toHaveBeenCalled();
    },
  );

  it('accepts a product title with descriptive words and preserves the variant', async () => {
    const candidate = {
      ...exactOffer,
      title: 'Apple iPhone 17 Pro Max 256GB 5G Tela Super Retina',
    };
    const { service } = makeService([candidate]);

    const result = await service.search('iPhone 17 Pro Max 256 GB');

    expect(result.status).toBe('FOUND');
  });

  it('rejects a broader model variant as an exact match', async () => {
    const candidate = {
      ...exactOffer,
      title: 'Apple iPhone 17 Pro Max 256GB Smartphone',
    };
    const { service, offersService } = makeService([candidate]);

    const result = await service.search('iPhone 17 Pro');

    expect(result.status).toBe('NO_EXACT_MATCH');
    expect(offersService.verifyMonetization).not.toHaveBeenCalled();
  });

  it('accepts a real Air Fryer candidate', async () => {
    const candidate = {
      ...exactOffer,
      title: 'Air Fryer Philips Walita 4L',
    };
    const { service } = makeService([candidate]);

    const result = await service.search('Air Fryer');

    expect(result.status).toBe('FOUND');
  });

  it('does not return a bermuda when searching for celular', async () => {
    const { service, offersService } = makeService([
      {
        ...exactOffer,
        title:
          'Kit 3 Shorts 2 em 1 Compressão Bermuda Masculina Academia Treino Bolso Celular',
      },
    ]);

    const result = await service.search('celular');

    expect(result.status).toBe('NO_EXACT_MATCH');
    expect(offersService.verifyMonetization).not.toHaveBeenCalled();
  });

  it('returns a smartphone for a generic celular query', async () => {
    const { service } = makeService([
      { ...exactOffer, title: 'Smartphone Samsung Galaxy A15 128GB' },
    ]);

    const result = await service.search('celular');

    expect(result.status).toBe('FOUND');
  });

  it.each([
    [
      'notebook',
      'Mesa Dobrável Notebook Retrátil Home Office Apoio Cama Sofá Trabalho Café',
    ],
    [
      'armário para lavanderia',
      'Prateleira Modular Lavanderia Desmontável Multiuso Estante Organizadora de Plástico Com Pezinhos 6 Andares',
    ],
    [
      'armário para lavanderia',
      'Cesto de Bambu Organizador de Roupa Suja Lavanderia',
    ],
  ])(
    'rejects the real smoke-test false positive for %s: %s',
    async (query, title) => {
      const { service, offersService } = makeService([
        { ...exactOffer, title },
      ]);

      const result = await service.search(query);

      expect(result.status).toBe('NO_EXACT_MATCH');
      expect(offersService.verifyMonetization).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['Copo térmico Stanley Quencher', 'FOUND'],
    ['Copo térmico CamelBak', 'NO_EXACT_MATCH'],
    ['Tampa de reposição para copo Stanley', 'NO_EXACT_MATCH'],
    ['Bolsa térmica Stanley', 'NO_EXACT_MATCH'],
  ])(
    'matches copo Stanley only to the product itself: %s',
    async (title, status) => {
      const { service } = makeService([{ ...exactOffer, title }]);

      const result = await service.search('copo Stanley');

      expect(result.status).toBe(status);
    },
  );

  it('matches armário para lavanderia to área de serviço', async () => {
    const { service } = makeService([
      {
        ...exactOffer,
        title: 'Armário multiuso área de serviço 2 portas',
      },
    ]);

    const result = await service.search('armário para lavanderia');

    expect(result.status).toBe('FOUND');
  });

  it('accepts real primary products for notebook and TV searches', async () => {
    const notebook = makeService([
      {
        ...exactOffer,
        title: 'Notebook Lenovo IdeaPad 3i Intel Core i5 8GB 256GB SSD',
      },
    ]);
    const television = makeService([
      { ...exactOffer, title: 'Smart TV Samsung 55 polegadas 4K UHD' },
    ]);

    expect((await notebook.service.search('notebook')).status).toBe('FOUND');
    expect((await television.service.search('TV')).status).toBe('FOUND');
  });

  it('keeps a laundry basket out of an armário para lavanderia search', async () => {
    const { service } = makeService([
      { ...exactOffer, title: 'Cesto de roupas para lavanderia' },
    ]);

    const result = await service.search('armário para lavanderia');

    expect(result.status).toBe('NO_EXACT_MATCH');
  });
});
