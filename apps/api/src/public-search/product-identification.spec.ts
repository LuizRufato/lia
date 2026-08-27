import {
  assertSafePublicUrl,
  areCompatibleProductVariants,
  areCompatibleProductTokens,
  classifyProduct,
  createProductIdentity,
  inferCandidateProductType,
  inferQueryProductType,
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

  it('prioritizes compact primary nouns and the real mochila smoke title', () => {
    const realMochilaTitle =
      'MochIia Vlagem Feminina Masculinas Multifuncional Reforçada Impermeável Expansível Mochila Notebook Antifurto USB';

    expect(inferCandidateProductType({ title: realMochilaTitle })).toBe('BAG');
    expect(classifyProduct(realMochilaTitle)).toEqual({
      primaryType: 'BAG',
      relation: 'ACCESSORY_FOR',
      relationTarget: 'NOTEBOOK',
    });

    for (const [query, candidate] of [
      ['notebook', 'Mochila Notebook'],
      ['notebook', 'Bolsa Notebook'],
      ['notebook', 'Case Notebook'],
      ['TV', 'Suporte TV'],
      ['TV', 'Base TV'],
      ['celular', 'Capa Celular'],
      ['celular', 'Capinha iPhone'],
      ['celular', 'Carregador Celular'],
      ['celular', 'Película iPhone'],
    ]) {
      const identity = createProductIdentity(query, {
        name: query,
        source: 'TEXT',
      });

      expect(isCompatibleProductType(identity, candidate)).toBe(false);
    }
  });

  it('keeps compact accessory queries searchable', () => {
    for (const [query, expected] of [
      ['mochila notebook', 'BAG'],
      ['capa iphone', 'CASE'],
      ['suporte tv', 'SUPPORT'],
      ['carregador celular', 'CHARGER'],
    ]) {
      const identity = createProductIdentity(query, {
        name: query,
        source: 'TEXT',
      });

      expect(identity.productType).toBe(expected);
      expect(isCompatibleProductType(identity, query)).toBe(true);
    }
  });

  it('classifies the real smoke candidates by their primary product noun', () => {
    expect(
      inferCandidateProductType({
        title:
          'Balança Bioimpedancia Digital Bluetooth Corporal até 180kg Resultado Pelo Celular',
      }),
    ).toBe('SCALE');
    expect(
      inferCandidateProductType({
        title:
          "Fones De Ouvido Intra-Auriculares Estéreo Sem Fio À Prova D'água Para Jogos Celular Inteligente 200mAh",
      }),
    ).toBe('HEADPHONES');
    expect(
      inferCandidateProductType({
        title:
          'Campainha Com Câmera Vídeo Porteiro Sem Fio Wi-Fi HD Inteligente Vê Pelo Celular',
      }),
    ).toBe('DOORBELL');
    expect(
      inferCandidateProductType({
        title:
          'Capinha de Celular BTS IPHONE 13 11 15 14 12 16 17 PRO MAX X XR XS MAX PLUS Proteção Anti Impacto Promoção',
      }),
    ).toBe('CASE');
    expect(
      inferCandidateProductType({
        category: 'Celulares e Acessórios',
        title:
          'Capinha de Celular BTS IPHONE 13 11 15 14 12 16 17 PRO MAX X XR XS MAX PLUS Proteção Anti Impacto Promoção',
      }),
    ).toBe('CASE');
  });

  it('keeps primary product type separate from a related target', () => {
    expect(classifyProduct('capa para celular')).toEqual({
      primaryType: 'CASE',
      relation: 'ACCESSORY_FOR',
      relationTarget: 'SMARTPHONE',
    });
    expect(classifyProduct('suporte para TV')).toEqual({
      primaryType: 'SUPPORT',
      relation: 'ACCESSORY_FOR',
      relationTarget: 'TELEVISION',
    });
    expect(classifyProduct('mesa para notebook')).toEqual({
      primaryType: 'TABLE_DESK',
      relation: 'USED_WITH',
      relationTarget: 'NOTEBOOK',
    });
    expect(classifyProduct('carregador para iPhone')).toEqual({
      primaryType: 'CHARGER',
      relation: 'ACCESSORY_FOR',
      relationTarget: 'SMARTPHONE',
    });
  });

  it('does not use an accessory relation target as the primary type', () => {
    const identity = createProductIdentity('celular', {
      name: 'celular',
      source: 'TEXT',
    });

    expect(
      isCompatibleProductType(
        identity,
        'Capinha de Celular BTS IPHONE 13 11 15 14 12 16 17 PRO MAX X XR XS MAX PLUS Proteção Anti Impacto Promoção',
      ),
    ).toBe(false);
    expect(
      isCompatibleProductType(
        createProductIdentity('capa para celular', {
          name: 'capa para celular',
          source: 'TEXT',
        }),
        'Capa Silicone para iPhone 17',
      ),
    ).toBe(true);
    expect(
      isCompatibleProductType(
        createProductIdentity('capa para celular', {
          name: 'capa para celular',
          source: 'TEXT',
        }),
        'Smartphone Apple iPhone 17',
      ),
    ).toBe(false);
  });

  it('keeps candidate type independent from query type', () => {
    const candidate = {
      title: 'Balança Inteligente Bluetooth com App no Celular',
    };

    expect(inferCandidateProductType(candidate)).toBe('SCALE');
    for (const query of [
      'celular',
      'balança',
      'bluetooth',
      'app',
      'qualquer',
    ]) {
      expect(inferQueryProductType(query)).toBeDefined();
      expect(inferCandidateProductType(candidate)).toBe('SCALE');
    }
  });

  it('classifies the real incompatible alternatives independently from celular', () => {
    const query = createProductIdentity('celular', {
      name: 'celular',
      source: 'TEXT',
    });
    const alternatives = [
      'Fácil De Usar Tipo-C Telefone Poeira Plug Liga Kindle Leitor Durável Multi Funcional Para E-Readers Dispositivos',
      'Kit Mobilador Gamer Completo Teclado RGB Mouse Gamer Mouse Pad Hub USB C Tripé Celular Free Fire',
    ];

    for (const title of alternatives) {
      expect(inferCandidateProductType({ title })).toBe('ACCESSORY');
      expect(isCompatibleProductType(query, title)).toBe(false);
    }
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
