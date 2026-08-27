import {
  assertSafePublicUrl,
  createProductIdentity,
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

  it.each([
    ['iPhone', 'Microfone de lapela compatível com iPhone'],
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
