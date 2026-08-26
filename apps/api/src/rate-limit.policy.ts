import type { ExecutionContext } from '@nestjs/common';

export const RATE_LIMIT_POLICIES = {
  login: { limit: 5, ttl: 60_000, blockDuration: 60_000 },
  admin: { limit: 120, ttl: 60_000, blockDuration: 10_000 },
  polling: { limit: 300, ttl: 60_000, blockDuration: 5_000 },
  webhook: { limit: 600, ttl: 60_000, blockDuration: 5_000 },
  publicSearch: { limit: 20, ttl: 60_000, blockDuration: 60_000 },
} as const;

export type RateLimitCategory = keyof typeof RATE_LIMIT_POLICIES;

interface RequestLike {
  route?: { path?: unknown };
  path?: unknown;
  url?: unknown;
  method?: unknown;
}

function requestPath(request: RequestLike): string {
  const routePath = request.route?.path;
  if (typeof routePath === 'string') return routePath;
  if (typeof request.path === 'string') return request.path;

  const url = typeof request.url === 'string' ? request.url : '';
  return url.split('?')[0] || '/';
}

export function getRateLimitCategory(request: RequestLike): RateLimitCategory {
  const path = requestPath(request);
  const method =
    typeof request.method === 'string' ? request.method.toUpperCase() : 'GET';

  if (method === 'POST' && path === '/auth/login') return 'login';
  if (method === 'POST' && path === '/public/search') return 'publicSearch';
  if (path.startsWith('/webhooks/')) return 'webhook';
  if (
    path === '/health' ||
    path === '/health/system' ||
    path.endsWith('/realtime') ||
    path.endsWith('/status') ||
    path.endsWith('/groups')
  ) {
    return 'polling';
  }

  return 'admin';
}

export function getRateLimitPolicy(
  context: ExecutionContext,
): (typeof RATE_LIMIT_POLICIES)[RateLimitCategory] {
  return RATE_LIMIT_POLICIES[
    getRateLimitCategory(context.switchToHttp().getRequest())
  ];
}
