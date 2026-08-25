import {
  assertProductionAuthCookieDomain,
  getAuthCookieOptions,
} from './auth-cookie';

describe('auth cookie configuration', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDomain = process.env.AUTH_COOKIE_DOMAIN;
  const originalWebUrl = process.env.WEB_URL;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalDomain === undefined) delete process.env.AUTH_COOKIE_DOMAIN;
    else process.env.AUTH_COOKIE_DOMAIN = originalDomain;
    if (originalWebUrl === undefined) delete process.env.WEB_URL;
    else process.env.WEB_URL = originalWebUrl;
  });

  it('requires the shared domain for the official production web host', () => {
    process.env.NODE_ENV = 'production';
    process.env.WEB_URL = 'https://botlia.com.br';
    delete process.env.AUTH_COOKIE_DOMAIN;

    expect(() => assertProductionAuthCookieDomain()).toThrow(
      'AUTH_COOKIE_DOMAIN must be configured in production',
    );
  });

  it('rejects a domain that cannot be shared with the official web host', () => {
    process.env.NODE_ENV = 'production';
    process.env.WEB_URL = 'https://botlia.com.br';
    process.env.AUTH_COOKIE_DOMAIN = 'example.com';

    expect(() => assertProductionAuthCookieDomain()).toThrow(
      'AUTH_COOKIE_DOMAIN must be botlia.com.br',
    );
  });

  it('keeps the secure shared-cookie attributes in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.WEB_URL = 'https://botlia.com.br';
    process.env.AUTH_COOKIE_DOMAIN = 'botlia.com.br';

    expect(getAuthCookieOptions()).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      domain: 'botlia.com.br',
    });
  });
});
