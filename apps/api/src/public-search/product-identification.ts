import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_HTML_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 5_000;
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.google.com',
]);

const STOP_WORDS = new Set([
  'a',
  'as',
  'ao',
  'aos',
  'com',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'e',
  'em',
  'para',
  'por',
  'sem',
  'um',
  'uma',
  'uns',
  'umas',
  'the',
  'and',
  'for',
]);

export interface ProductIdentity {
  input: string;
  name: string;
  brand?: string;
  model?: string;
  attributes: string[];
  tokens: string[];
  source: 'TEXT' | 'URL_METADATA';
}

export class PublicSearchInputError extends Error {}

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenizeSearchText(value: string): string[] {
  return [
    ...new Set(
      normalizeSearchText(value)
        .split(/\s+/)
        .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)),
    ),
  ];
}

function isPrivateIp(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    );
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb') ||
      normalized.startsWith('::ffff:127.') ||
      normalized.startsWith('::ffff:10.') ||
      normalized.startsWith('::ffff:192.168.')
    );
  }

  return true;
}

export async function assertSafePublicUrl(value: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new PublicSearchInputError('URL de produto inválida.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PublicSearchInputError('Informe uma URL HTTP ou HTTPS.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    (net.isIP(hostname) && isPrivateIp(hostname))
  ) {
    throw new PublicSearchInputError(
      'Não foi possível ler essa URL com segurança. Informe o nome e o modelo do produto.',
    );
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new PublicSearchInputError(
      'Não foi possível acessar essa página. Informe o nome e o modelo do produto.',
    );
  }

  if (
    !addresses.length ||
    addresses.some(({ address }) => isPrivateIp(address))
  ) {
    throw new PublicSearchInputError(
      'Não foi possível ler essa URL com segurança. Informe o nome e o modelo do produto.',
    );
  }

  return parsed;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function tagContent(html: string, tag: string): string | undefined {
  const match = html.match(
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'),
  );
  return match?.[1] ? decodeHtml(match[1].replace(/<[^>]+>/g, ' ')) : undefined;
}

function metaContent(html: string, key: string): string | undefined {
  const safeKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${safeKey}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      'i',
    ),
  );
  return match?.[1] ? decodeHtml(match[1]) : undefined;
}

function parseJsonLd(html: string): Record<string, unknown> | null {
  const scripts = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script[1]);
      const values = Array.isArray(parsed) ? parsed : [parsed];
      const product = values.find((item) => item?.['@type'] === 'Product');
      if (product && typeof product === 'object') return product;
    } catch {
      // Public product pages frequently contain malformed JSON-LD; metadata is enough.
    }
  }
  return null;
}

async function readPublicHtml(
  startUrl: string,
): Promise<{ html: string; url: URL }> {
  let current = await assertSafePublicUrl(startUrl);

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(current, {
      redirect: 'manual',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'LIA-Public-Search/1.0',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirect === MAX_REDIRECTS) {
        throw new PublicSearchInputError(
          'A página redirecionou muitas vezes. Informe o nome e o modelo do produto.',
        );
      }
      current = await assertSafePublicUrl(
        new URL(location, current).toString(),
      );
      continue;
    }

    if (!response.ok) {
      throw new PublicSearchInputError(
        'Não foi possível ler essa página. Informe o nome e o modelo do produto.',
      );
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_HTML_BYTES) {
      throw new PublicSearchInputError(
        'A página é grande demais para uma identificação segura. Informe o nome e o modelo.',
      );
    }

    const html = await response.text();
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
      throw new PublicSearchInputError(
        'A página é grande demais para uma identificação segura. Informe o nome e o modelo.',
      );
    }
    return { html, url: current };
  }

  throw new PublicSearchInputError(
    'Não foi possível seguir a URL com segurança.',
  );
}

export async function identifyProduct(input: string): Promise<ProductIdentity> {
  const trimmed = input.trim();
  if (!trimmed) throw new PublicSearchInputError('Informe um produto ou URL.');

  if (!/^https?:\/\//i.test(trimmed)) {
    const tokens = tokenizeSearchText(trimmed);
    return {
      input: trimmed,
      name: trimmed,
      attributes: tokens,
      tokens,
      source: 'TEXT',
    };
  }

  const { html, url } = await readPublicHtml(trimmed);
  const jsonLd = parseJsonLd(html);
  const brand =
    typeof jsonLd?.brand === 'object'
      ? String((jsonLd.brand as Record<string, unknown>).name || '')
      : typeof jsonLd?.brand === 'string'
        ? jsonLd.brand
        : undefined;
  const model = typeof jsonLd?.model === 'string' ? jsonLd.model : undefined;
  const name =
    (typeof jsonLd?.name === 'string' && jsonLd.name) ||
    metaContent(html, 'og:title') ||
    tagContent(html, 'title') ||
    decodeHtml(url.pathname.split('/').filter(Boolean).pop() || '');
  const attributes = [brand, model, name].filter(Boolean).join(' ');
  const tokens = tokenizeSearchText(attributes);

  if (!name || tokens.length < 2) {
    throw new PublicSearchInputError(
      'Não consegui identificar esse produto automaticamente. Tente informar o nome e o modelo.',
    );
  }

  return {
    input: trimmed,
    name,
    ...(brand ? { brand } : {}),
    ...(model ? { model } : {}),
    attributes: tokens,
    tokens,
    source: 'URL_METADATA',
  };
}
