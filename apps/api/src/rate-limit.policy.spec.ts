import { getRateLimitCategory, RATE_LIMIT_POLICIES } from './rate-limit.policy';

describe('rate-limit policy', () => {
  it('keeps login strict', () => {
    expect(getRateLimitCategory({ method: 'POST', path: '/auth/login' })).toBe(
      'login',
    );
    expect(RATE_LIMIT_POLICIES.login.limit).toBe(5);
  });

  it('allows normal authenticated panel traffic and polling', () => {
    expect(getRateLimitCategory({ method: 'GET', path: '/overview' })).toBe(
      'admin',
    );
    expect(
      getRateLimitCategory({ method: 'GET', path: '/analytics/realtime' }),
    ).toBe('polling');
    expect(RATE_LIMIT_POLICIES.admin.limit).toBeGreaterThan(
      RATE_LIMIT_POLICIES.login.limit,
    );
    expect(RATE_LIMIT_POLICIES.polling.limit).toBeGreaterThan(
      RATE_LIMIT_POLICIES.admin.limit,
    );
  });

  it('gives webhook delivery its own high-volume policy', () => {
    expect(
      getRateLimitCategory({
        method: 'POST',
        path: '/webhooks/whatsapp',
      }),
    ).toBe('webhook');
    expect(RATE_LIMIT_POLICIES.webhook.limit).toBeGreaterThan(
      RATE_LIMIT_POLICIES.polling.limit,
    );
  });

  it('limits public search to 20 requests per minute', () => {
    expect(
      getRateLimitCategory({ method: 'POST', path: '/public/search' }),
    ).toBe('publicSearch');
    expect(RATE_LIMIT_POLICIES.publicSearch.limit).toBe(20);
    expect(RATE_LIMIT_POLICIES.publicSearch.ttl).toBe(60_000);
  });
});
