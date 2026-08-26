import {
  assertSafePublicUrl,
  identifyProduct,
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
