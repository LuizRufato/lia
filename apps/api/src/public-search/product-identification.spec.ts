import {
  assertSafePublicUrl,
  areCompatibleProductVariants,
  areCompatibleProductTokens,
  createProductIdentity,
  inferCandidateProductType,
  identifyProduct,
  isAccessoryCandidate,
  isCompatibleProductType,
  PublicSearchInputError,
  tokenizeSearchText,
} from './product-identification';

describe('public product identification', () => {
  it('keeps model and variant tokens for deterministic matching', async () => {
    const identity = await identifyProduct('Philips Walita EP1220 220V');

    expect(identity.source).toBe('TEXT');
    expect(identity.tokens).toEqual(
      expect.arrayContaining(['philips', 'walita', 'ep1220', '220v']),
    );
  });

  it('normalizes accents without losing variant values', () => {
    expect(tokenizeSearchText('Tênis Adidas 42 Azul')).toEqual(
      expect.arrayContaining(['tenis', 'adidas', '42', 'azul']),
    );
  });

  it.each([
    ['Mercado Livre', 'Oferta'],
    ['Amazon', 'Frete grátis'],
  ])(
    'keeps URL metadata equivalent to the same textual product identity for %s',
    (marketplace, noise) => {
      const textIdentity = createProductIdentity('iPhone 17 Pro Max 256 GB', {
        name: 'iPhone 17 Pro Max 256 GB',
        source: 'TEXT',
      });
      const urlIdentity = createProductIdentity('https://example.com/item', {
        name: `Apple iPhone 17 Pro Max 256 GB | ${marketplace} | ${noise}`,
        brand: 'Apple',
        model: 'iPhone 17 Pro Max',
        source: 'URL_METADATA',
      });

      expect(urlIdentity.tokens).toEqual(textIdentity.tokens);
      expect(urlIdentity.name).not.toMatch(
        /Mercado Livre|Amazon|Oferta|Frete/i,
      );
      expect(urlIdentity.productType).toBe('SMARTPHONE');
    },
  );

  it.each(['Mercado Livre', 'Amazon'])(
    'does not require SEO-only URL metadata tokens for %s',
    (marketplace) => {
      const textIdentity = createProductIdentity('iPhone 17 Pro Max 256 GB', {
        name: 'iPhone 17 Pro Max 256 GB',
        source: 'TEXT',
      });
      const urlIdentity = createProductIdentity('https://example.com/item', {
        name: `Apple iPhone 17 Pro Max 256GB 5G Titânio Natural - Frete Grátis | ${marketplace}`,
        brand: 'Apple',
        source: 'URL_METADATA',
      });

      expect(urlIdentity.coreTokens).toEqual(textIdentity.coreTokens);
      expect(urlIdentity.hardVariantTokens).toEqual(
        textIdentity.hardVariantTokens,
      );
      expect(urlIdentity.tokens).toEqual(textIdentity.tokens);
      const candidateTokens = tokenizeSearchText(
        'Apple iPhone 17 Pro Max 256GB Smartphone',
      );
      expect(candidateTokens).toEqual(
        expect.arrayContaining(textIdentity.tokens),
      );
      expect(candidateTokens).toEqual(
        expect.arrayContaining(urlIdentity.tokens),
      );
      expect(urlIdentity.optionalTokens).toEqual(
        expect.arrayContaining(['apple', '5g', 'titanio', 'natural']),
      );
    },
  );

  it.each([
    ['iPhone', 'Microfone de lapela compatível com iPhone'],
    ['iPhone', 'Capa anti impacto para iPhone'],
    ['TV', 'Base suporte para TV'],
    ['notebook', 'Mochila para notebook'],
  ])('rejects an accessory for generic product %s', (query, candidate) => {
    const identity = createProductIdentity(query, {
      name: query,
      source: 'TEXT',
    });

    expect(isAccessoryCandidate(candidate, null, identity)).toBe(true);
  });

  it('keeps real products and rejects incompatible variants', () => {
    const identity = createProductIdentity('iPhone 17 Pro Max 256 GB', {
      name: 'iPhone 17 Pro Max 256 GB',
      source: 'TEXT',
    });

    expect(
      isCompatibleProductType(identity, 'Apple iPhone 17 Pro Max 256GB 5G'),
    ).toBe(true);
    expect(
      isCompatibleProductType(identity, 'Apple iPhone 17 Pro Max 512GB'),
    ).toBe(true);
    expect(
      areCompatibleProductVariants(identity, 'Apple iPhone 17 Pro Max 512GB'),
    ).toBe(false);
    expect(
      areCompatibleProductVariants(
        createProductIdentity('iPhone 17 Pro', {
          name: 'iPhone 17 Pro',
          source: 'TEXT',
        }),
        'Apple iPhone 17 Pro Max 256GB',
      ),
    ).toBe(false);
    expect(tokenizeSearchText('Apple iPhone 17 Pro Max 512GB')).not.toEqual(
      expect.arrayContaining(['256', 'gb']),
    );
    expect(
      isCompatibleProductType(
        createProductIdentity('Air Fryer', {
          name: 'Air Fryer',
          source: 'TEXT',
        }),
        'Fritadeira Air Fryer 3,5L',
      ),
    ).toBe(true);
  });

  it('matches celular by product type and rejects a product that only references it', () => {
    const identity = createProductIdentity('celular', {
      name: 'celular',
      source: 'TEXT',
    });

    expect(
      isCompatibleProductType(identity, 'Smartphone Samsung Galaxy A15'),
    ).toBe(true);
    expect(
      isCompatibleProductType(
        identity,
        'Kit 3 Shorts 2 em 1 Compressão Bermuda Masculina Academia Treino Bolso Celular',
      ),
    ).toBe(false);
    expect(
      areCompatibleProductTokens(identity, 'Smartphone Samsung Galaxy A15'),
    ).toBe(true);
  });

  it('uses primary product signals before compatibility mentions', () => {
    expect(
      inferCandidateProductType({
        title:
          'Kit 3 Shorts 2 em 1 Compressão Bermuda Masculina Academia Treino Bolso Celular',
      }),
    ).toBe('APPAREL');
    expect(
      inferCandidateProductType({
        title: 'Mesa Dobrável Notebook Retrátil Home Office Apoio Cama Sofá',
      }),
    ).toBe('TABLE_DESK');
    expect(
      inferCandidateProductType({
        title:
          'Prateleira Modular Lavanderia Desmontável Multiuso Estante Organizadora',
      }),
    ).toBe('SHELVING');
  });

  it('lets a structured category override a misleading title mention', () => {
    expect(
      inferCandidateProductType({
        category: 'Moda > Shorts',
        title: 'Shorts masculino com bolso para celular',
      }),
    ).toBe('APPAREL');
    expect(
      inferCandidateProductType({
        category: 'Móveis > Mesas para escritório',
        title: 'Mesa para notebook dobrável',
      }),
    ).toBe('TABLE_DESK');
  });

  it('does not treat a raw Shopee category id as semantic evidence', () => {
    expect(
      inferCandidateProductType({
        category: '100636,100717,101220',
        title: 'Mesa Dobrável Notebook Retrátil',
      }),
    ).toBe('TABLE_DESK');
  });

  it('requires the Stanley brand for a drinkware query and rejects accessories', () => {
    const identity = createProductIdentity('copo Stanley', {
      name: 'copo Stanley',
      source: 'TEXT',
    });

    expect(identity.productType).toBe('DRINKWARE');
    expect(
      areCompatibleProductTokens(identity, 'Copo térmico Stanley Quencher'),
    ).toBe(true);
    expect(
      isCompatibleProductType(identity, 'Tampa de reposição para copo Stanley'),
    ).toBe(false);
    expect(isCompatibleProductType(identity, 'Bolsa térmica Stanley')).toBe(
      false,
    );
    expect(
      isCompatibleProductType(
        identity,
        'Canudo de reposição para Copo Stanley',
      ),
    ).toBe(false);
  });

  it('uses controlled laundry-room synonyms without broadening to unrelated items', () => {
    const identity = createProductIdentity('armário para lavanderia', {
      name: 'armário para lavanderia',
      source: 'TEXT',
    });

    expect(identity.productType).toBe('CABINET_STORAGE');
    expect(
      areCompatibleProductTokens(
        identity,
        'Armário multiuso área de serviço 2 portas',
      ),
    ).toBe(true);
    expect(
      isCompatibleProductType(identity, 'Cesto de roupas para lavanderia'),
    ).toBe(false);
  });

  it.each([
    'http://localhost/item',
    'http://127.0.0.1/item',
    'http://169.254.169.254/latest',
  ])('blocks internal URL %s', async (url) => {
    await expect(assertSafePublicUrl(url)).rejects.toBeInstanceOf(
      PublicSearchInputError,
    );
  });

  it('rejects non-http schemes', async () => {
    await expect(assertSafePublicUrl('file:///etc/passwd')).rejects.toThrow(
      'HTTP ou HTTPS',
    );
  });
});
