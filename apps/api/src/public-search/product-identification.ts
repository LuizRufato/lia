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

const MARKETPLACE_NOISE_PATTERNS = [
  /\bmercado\s+livre\b/gi,
  /\bmagazine\s+luiza\b/gi,
  /\bcasas\s+bahia\b/gi,
  /\bali\s*express\b/gi,
  /\bamazon\b/gi,
  /\bshopee\b/gi,
  /\bmagalu\b/gi,
  /\bkabum\b/gi,
  /\boferta(?:s)?\b/gi,
  /\bpromo(?:cao|ção)(?:s)?\b/gi,
  /\bfrete\s+(?:gratis|grátis)\b/gi,
  /\bmelhor\s+pre(?:co|ço)\b/gi,
  /\b(?:novo|original|imperdivel|imperdível)\b/gi,
];

const ACCESSORY_TERMS = new Set([
  'capa',
  'capas',
  'pelicula',
  'peliculas',
  'suporte',
  'suportes',
  'base',
  'bases',
  'cabo',
  'cabos',
  'carregador',
  'carregadores',
  'microfone',
  'microfones',
  'adaptador',
  'adaptadores',
  'bolsa',
  'bolsas',
  'mochila',
  'mochilas',
  'case',
  'cases',
  'protecao',
  'protecoes',
  'holder',
]);

const PRODUCT_VARIANT_WORDS = new Set([
  'pro',
  'max',
  'mini',
  'plus',
  'ultra',
  'se',
  'azul',
  'branco',
  'preto',
  'cinza',
  'verde',
  'rosa',
  'vermelho',
  'amarelo',
]);

export type ProductType =
  'SMARTPHONE' | 'TELEVISION' | 'NOTEBOOK' | 'SHOES' | 'AIR_FRYER' | 'UNKNOWN';

export interface ProductIdentity {
  input: string;
  name: string;
  brand?: string;
  model?: string;
  attributes: string[];
  tokens: string[];
  productType: ProductType;
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
  const rawTokens = normalizeSearchText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
  const expandedTokens = rawTokens.flatMap((token) => {
    const compactVariant = token.match(/^(\d+)(gb|tb|v|hz|w|kg|g|l|ml|cm|mm)$/);
    return compactVariant
      ? [token, compactVariant[1], compactVariant[2]]
      : [token];
  });
  return [...new Set(expandedTokens)];
}

function extractVariantTokens(value: string): string[] {
  return tokenizeSearchText(value).filter(
    (token) =>
      PRODUCT_VARIANT_WORDS.has(token) ||
      /^\d+$/.test(token) ||
      /^(?:gb|tb|v|hz|w|kg|g|l|ml|cm|mm)$/.test(token) ||
      /^\d+(?:gb|tb|v|hz|w|kg|g|l|ml|cm|mm)$/.test(token),
  );
}

export function inferProductType(value: string): ProductType {
  const tokens = new Set(tokenizeSearchText(value));
  if ((tokens.has('air') && tokens.has('fryer')) || tokens.has('fritadeira')) {
    return 'AIR_FRYER';
  }
  if (
    tokens.has('iphone') ||
    tokens.has('smartphone') ||
    tokens.has('celular') ||
    tokens.has('telefone')
  ) {
    return 'SMARTPHONE';
  }
  if (
    tokens.has('tv') ||
    tokens.has('televisao') ||
    tokens.has('televisor') ||
    tokens.has('smarttv')
  ) {
    return 'TELEVISION';
  }
  if (tokens.has('notebook') || tokens.has('laptop')) return 'NOTEBOOK';
  if (
    tokens.has('tenis') ||
    tokens.has('calcado') ||
    tokens.has('sapato') ||
    tokens.has('sapatilha')
  ) {
    return 'SHOES';
  }
  return 'UNKNOWN';
}

export function isAccessoryCandidate(
  title: string,
  category: string | null | undefined,
  requested: ProductIdentity | string,
): boolean {
  const requestedTokens =
    typeof requested === 'string'
      ? tokenizeSearchText(requested)
      : requested.tokens;
  if (requestedTokens.some((token) => ACCESSORY_TERMS.has(token))) return false;

  const candidateTokens = tokenizeSearchText(
    [title, category].filter(Boolean).join(' '),
  );
  return candidateTokens.some((token) => ACCESSORY_TERMS.has(token));
}

export function isCompatibleProductType(
  requested: ProductIdentity,
  candidateTitle: string,
  candidateCategory?: string | null,
): boolean {
  if (requested.productType === 'UNKNOWN') return true;
  const candidateType = inferProductType(
    [candidateTitle, candidateCategory].filter(Boolean).join(' '),
  );
  return candidateType === 'UNKNOWN' || candidateType === requested.productType;
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

function cleanMetadataText(value: string): string {
  let cleaned = decodeHtml(value);
  for (const pattern of MARKETPLACE_NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ');
  }
  return cleaned
    .replace(/[|•]+/g, ' ')
    .replace(/\s+[-–—]\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createProductIdentity(
  input: string,
  metadata: {
    name: string;
    brand?: string;
    model?: string;
    source: ProductIdentity['source'];
  },
): ProductIdentity {
  const name =
    metadata.source === 'URL_METADATA'
      ? cleanMetadataText(metadata.name)
      : metadata.name.trim();
  const brand = metadata.brand
    ? metadata.source === 'URL_METADATA'
      ? cleanMetadataText(metadata.brand)
      : metadata.brand.trim()
    : undefined;
  const model = metadata.model
    ? metadata.source === 'URL_METADATA'
      ? cleanMetadataText(metadata.model)
      : metadata.model.trim()
    : undefined;
  const identityText = [name, brand, model].filter(Boolean).join(' ');
  const tokens =
    metadata.source === 'URL_METADATA' && (brand || model)
      ? [
          ...new Set([
            ...tokenizeSearchText([brand, model].filter(Boolean).join(' ')),
            ...extractVariantTokens(name),
          ]),
        ]
      : tokenizeSearchText(identityText);

  return {
    input,
    name,
    ...(brand ? { brand } : {}),
    ...(model ? { model } : {}),
    attributes: tokens,
    tokens,
    productType: inferProductType(identityText),
    source: metadata.source,
  };
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
    const identity = createProductIdentity(trimmed, {
      name: trimmed,
      source: 'TEXT',
    });
    if (!identity.tokens.length) {
      throw new PublicSearchInputError('Informe um produto ou URL.');
    }
    return identity;
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
  const identity = createProductIdentity(trimmed, {
    name,
    ...(brand ? { brand } : {}),
    ...(model ? { model } : {}),
    source: 'URL_METADATA',
  });

  if (!identity.name || identity.tokens.length < 2) {
    throw new PublicSearchInputError(
      'Não consegui identificar esse produto automaticamente. Tente informar o nome e o modelo.',
    );
  }

  return identity;
}
