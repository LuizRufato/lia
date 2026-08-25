export function assertProductionAuthCookieDomain() {
  if (process.env.NODE_ENV !== 'production') return;

  const domain = process.env.AUTH_COOKIE_DOMAIN?.trim();
  if (!domain) {
    throw new Error(
      'AUTH_COOKIE_DOMAIN must be configured in production for the shared web session cookie',
    );
  }

  const webUrl = process.env.WEB_URL?.trim();
  if (!webUrl) return;

  let webHost: string;
  try {
    webHost = new URL(webUrl).hostname;
  } catch {
    return;
  }

  const normalizedDomain = domain.replace(/^\.+/, '').toLowerCase();
  if (webHost === 'botlia.com.br' && normalizedDomain !== 'botlia.com.br') {
    throw new Error(
      'AUTH_COOKIE_DOMAIN must be botlia.com.br when WEB_URL is botlia.com.br',
    );
  }
}

export function getAuthCookieOptions() {
  const domain = process.env.AUTH_COOKIE_DOMAIN?.trim();

  assertProductionAuthCookieDomain();

  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    ...(domain ? { domain } : {}),
  };
}
