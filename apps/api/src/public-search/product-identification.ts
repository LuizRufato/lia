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
  'tampa',
  'tampas',
  'canudo',
  'canudos',
  'alca',
  'alcas',
  'reposicao',
  'acessorio',
  'acessorios',
]);

const MODEL_VARIANT_WORDS = new Set([
  'pro',
  'max',
  'mini',
  'plus',
  'ultra',
  'se',
]);

const URL_OPTIONAL_TERMS = new Set([
  'apple',
  'smartphone',
  'celular',
  'telefone',
  '5g',
  '4g',
  'titanio',
  'natural',
  'azul',
  'branco',
  'preto',
  'cinza',
  'verde',
  'rosa',
  'vermelho',
  'amarelo',
]);

const VARIANT_UNIT_PATTERN = /^(\d+)(gb|tb|v|hz|w|kg|g|l|ml|cm|mm)$/;

export type ProductType =
  | 'SMARTPHONE'
  | 'SCALE'
  | 'HEADPHONES'
  | 'DOORBELL'
  | 'TELEVISION'
  | 'NOTEBOOK'
  | 'SHOES'
  | 'AIR_FRYER'
  | 'DRINKWARE'
  | 'CABINET_STORAGE'
  | 'APPAREL'
  | 'TABLE_DESK'
  | 'SHELVING'
  | 'LAUNDRY_BASKET'
  | 'SUPPORT'
  | 'ACCESSORY'
  | 'UNKNOWN';

export interface ProductIdentity {
  input: string;
  name: string;
  brand?: string;
  model?: string;
  attributes: string[];
  tokens: string[];
  coreTokens: string[];
  hardVariantTokens: string[];
  optionalTokens: string[];
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

function extractHardVariantTokens(value: string): string[] {
  const rawTokens = normalizeSearchText(value).split(/\s+/).filter(Boolean);
  const variants = new Set<string>();

  for (let index = 0; index < rawTokens.length; index += 1) {
    const token = rawTokens[index];
    if (MODEL_VARIANT_WORDS.has(token)) variants.add(token);

    const compactVariant = token.match(VARIANT_UNIT_PATTERN);
    if (compactVariant && token !== '5g' && token !== '4g') {
      variants.add(`${compactVariant[1]}${compactVariant[2]}`);
      continue;
    }

    const next = rawTokens[index + 1];
    if (
      /^\d+$/.test(token) &&
      next &&
      /^(?:gb|tb|v|hz|w|kg|g|l|ml|cm|mm)$/.test(next)
    ) {
      variants.add(`${token}${next}`);
    }
  }

  return [...variants];
}

function expandHardVariantTokens(variants: string[]): string[] {
  return variants.flatMap((variant) => {
    const compactVariant = variant.match(VARIANT_UNIT_PATTERN);
    return compactVariant
      ? [variant, compactVariant[1], compactVariant[2]]
      : [variant];
  });
}

function sameTokenSet(left: string[], right: string[]): boolean {
  return (
    left.length === right.length && left.every((token) => right.includes(token))
  );
}

export function areCompatibleProductVariants(
  requested: ProductIdentity,
  candidateTitle: string,
  candidateCategory?: string | null,
): boolean {
  const candidateVariants = extractHardVariantTokens(
    [candidateTitle, candidateCategory].filter(Boolean).join(' '),
  );
  const families = [
    (value: string) => MODEL_VARIANT_WORDS.has(value),
    (value: string) => VARIANT_UNIT_PATTERN.test(value),
  ];

  return families.every((isFamily) => {
    const requestedFamily = requested.hardVariantTokens.filter(isFamily);
    if (!requestedFamily.length) return true;
    return sameTokenSet(requestedFamily, candidateVariants.filter(isFamily));
  });
}

const REFERENCED_PRODUCT_PATTERN =
  /\b(?:para|p|de|com|compativel com)\s+(?:o|a|um|uma)?\s*(?:iphone|smartphone|celular|telefone|tv|televisao|televisor|smarttv|notebook|laptop|copo|tumbler|caneca|armario|gabinete)\b/g;

const PRODUCT_TYPE_ANCHORS: Record<
  Exclude<ProductType, 'UNKNOWN'>,
  string[]
> = {
  SMARTPHONE: ['iphone', 'smartphone', 'celular', 'telefone', 'galaxy'],
  SCALE: ['balanca', 'peso'],
  HEADPHONES: ['fone', 'fones', 'headphone', 'headset', 'earbud', 'earbuds'],
  DOORBELL: ['campainha', 'porteiro', 'interfone'],
  TELEVISION: ['tv', 'televisao', 'televisor', 'smarttv'],
  NOTEBOOK: ['notebook', 'laptop'],
  SHOES: ['tenis', 'calcado', 'sapato', 'sapatilha'],
  AIR_FRYER: ['air', 'fryer', 'fritadeira'],
  DRINKWARE: ['copo', 'tumbler', 'caneca', 'garrafa'],
  CABINET_STORAGE: ['armario', 'gabinete', 'multiuso', 'servico'],
  APPAREL: ['shorts', 'bermuda', 'roupa', 'vestuario'],
  TABLE_DESK: ['mesa', 'escrivaninha', 'bancada'],
  SHELVING: ['prateleira', 'estante'],
  LAUNDRY_BASKET: ['cesto'],
  SUPPORT: ['suporte', 'base'],
  ACCESSORY: [...ACCESSORY_TERMS],
};

const GENERIC_TYPE_TOKENS: Record<
  Exclude<ProductType, 'UNKNOWN'>,
  Set<string>
> = {
  SMARTPHONE: new Set(['smartphone', 'celular', 'telefone', 'galaxy']),
  SCALE: new Set(['balanca', 'peso']),
  HEADPHONES: new Set([
    'fone',
    'fones',
    'headphone',
    'headset',
    'earbud',
    'earbuds',
  ]),
  DOORBELL: new Set(['campainha', 'porteiro', 'interfone']),
  TELEVISION: new Set(['tv', 'televisao', 'televisor', 'smarttv']),
  NOTEBOOK: new Set(['notebook', 'laptop']),
  SHOES: new Set(['tenis', 'calcado', 'sapato', 'sapatilha']),
  AIR_FRYER: new Set(['air', 'fryer', 'fritadeira']),
  DRINKWARE: new Set(['copo', 'tumbler', 'caneca', 'garrafa']),
  CABINET_STORAGE: new Set(['armario', 'gabinete']),
  APPAREL: new Set(['shorts', 'bermuda', 'roupa', 'vestuario']),
  TABLE_DESK: new Set(['mesa', 'escrivaninha', 'bancada']),
  SHELVING: new Set(['prateleira', 'estante']),
  LAUNDRY_BASKET: new Set(['cesto']),
  SUPPORT: new Set(['suporte', 'base']),
  ACCESSORY: new Set([...ACCESSORY_TERMS]),
};

const CONTROLLED_SYNONYMS: Record<string, string[][]> = {
  lavanderia: [['area', 'servico']],
  area: [['lavanderia']],
  servico: [['lavanderia']],
  tumbler: [['copo']],
  caneca: [['copo']],
  smartphone: [['celular'], ['telefone']],
  celular: [['smartphone'], ['telefone']],
  telefone: [['smartphone'], ['celular']],
};

function productTypeText(value: string): string {
  return normalizeSearchText(value).replace(REFERENCED_PRODUCT_PATTERN, ' ');
}

function hasPrimaryAccessorySignal(value: string): boolean {
  const normalized = normalizeSearchText(value);
  return /^(?:capa|pelicula|suporte|base|cabo|carregador|microfone|adaptador|bolsa|mochila|case|protecao|holder|tampa|canudo|alca|reposicao|acessorio)\b/.test(
    normalized,
  );
}

function inferProductTypeFromText(value: string): ProductType {
  const normalized = normalizeSearchText(value);
  const tokens = new Set(tokenizeSearchText(productTypeText(normalized)));

  if (hasPrimaryAccessorySignal(normalized)) return 'ACCESSORY';
  if (
    tokens.has('shorts') ||
    tokens.has('bermuda') ||
    tokens.has('vestuario') ||
    tokens.has('roupa')
  ) {
    return 'APPAREL';
  }
  if (
    tokens.has('mesa') ||
    tokens.has('escrivaninha') ||
    tokens.has('bancada')
  ) {
    return 'TABLE_DESK';
  }
  if (tokens.has('prateleira') || tokens.has('estante')) return 'SHELVING';
  if (tokens.has('cesto')) return 'LAUNDRY_BASKET';
  if (tokens.has('suporte') || tokens.has('base')) return 'SUPPORT';
  if (tokens.has('balanca')) return 'SCALE';
  if (
    tokens.has('fone') ||
    tokens.has('fones') ||
    tokens.has('headphone') ||
    tokens.has('headset') ||
    tokens.has('earbud') ||
    tokens.has('earbuds')
  ) {
    return 'HEADPHONES';
  }
  if (
    tokens.has('campainha') ||
    tokens.has('porteiro') ||
    tokens.has('interfone')
  ) {
    return 'DOORBELL';
  }
  if ((tokens.has('air') && tokens.has('fryer')) || tokens.has('fritadeira')) {
    return 'AIR_FRYER';
  }
  if (
    tokens.has('iphone') ||
    tokens.has('smartphone') ||
    tokens.has('celular') ||
    tokens.has('telefone') ||
    tokens.has('galaxy')
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
  if (
    tokens.has('copo') ||
    tokens.has('tumbler') ||
    tokens.has('caneca') ||
    (tokens.has('garrafa') && tokens.has('termica'))
  ) {
    return 'DRINKWARE';
  }
  if (tokens.has('armario') || tokens.has('gabinete')) {
    return 'CABINET_STORAGE';
  }
  if (tokens.has('area') && tokens.has('servico')) {
    return 'CABINET_STORAGE';
  }
  return 'UNKNOWN';
}

export function inferProductType(
  value: string,
  category?: string | null,
): ProductType {
  const valueType = inferProductTypeFromText(value);
  return valueType !== 'UNKNOWN'
    ? valueType
    : inferProductTypeFromText(category || '');
}

export function inferQueryProductType(query: string): ProductType {
  return inferProductTypeFromText(query);
}

function isRawMarketplaceCategory(value: string): boolean {
  return /^\d+(?:\s+\d+)*$/.test(normalizeSearchText(value));
}

export function inferCandidateProductType(input: {
  category?: string | null;
  productName?: string | null;
  title?: string | null;
}): ProductType {
  const structuredCategory = input.category?.trim();
  if (structuredCategory && !isRawMarketplaceCategory(structuredCategory)) {
    const categoryType = inferProductTypeFromText(structuredCategory);
    if (categoryType !== 'UNKNOWN') return categoryType;
  }

  const productNameType = inferProductTypeFromText(input.productName || '');
  if (productNameType !== 'UNKNOWN') return productNameType;

  return inferProductTypeFromText(input.title || '');
}

function tokenMatchesCandidate(
  token: string,
  requestedType: ProductType,
  candidateTokens: Set<string>,
): boolean {
  if (candidateTokens.has(token)) return true;

  if (
    requestedType !== 'UNKNOWN' &&
    GENERIC_TYPE_TOKENS[requestedType]?.has(token) &&
    [...GENERIC_TYPE_TOKENS[requestedType]].some((value) =>
      candidateTokens.has(value),
    )
  ) {
    return true;
  }

  return (CONTROLLED_SYNONYMS[token] || []).some((synonym) =>
    synonym.every((part) => candidateTokens.has(part)),
  );
}

export function countCompatibleProductTokens(
  requested: ProductIdentity,
  candidateTitle: string,
  candidateCategory?: string | null,
  candidateDetails?: string | null,
): number {
  const candidateTokens = new Set(
    tokenizeSearchText(
      [candidateTitle, candidateCategory, candidateDetails]
        .filter(Boolean)
        .join(' '),
    ),
  );
  return requested.tokens.filter((token) =>
    tokenMatchesCandidate(token, requested.productType, candidateTokens),
  ).length;
}

export function areCompatibleProductTokens(
  requested: ProductIdentity,
  candidateTitle: string,
  candidateCategory?: string | null,
  candidateDetails?: string | null,
): boolean {
  return (
    countCompatibleProductTokens(
      requested,
      candidateTitle,
      candidateCategory,
      candidateDetails,
    ) === requested.tokens.length
  );
}

export function getProductSearchAnchors(identity: ProductIdentity): string[] {
  const anchors = new Set(identity.tokens);
  if (identity.productType !== 'UNKNOWN') {
    for (const anchor of PRODUCT_TYPE_ANCHORS[identity.productType]) {
      anchors.add(anchor);
    }
  }
  for (const token of identity.tokens) {
    for (const synonym of CONTROLLED_SYNONYMS[token] || []) {
      for (const part of synonym) anchors.add(part);
    }
  }
  return [...anchors].filter((anchor) => anchor.length >= 2);
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

  return (
    hasPrimaryAccessorySignal(title) ||
    (category ? hasPrimaryAccessorySignal(category) : false)
  );
}

export function isCompatibleProductType(
  requested: ProductIdentity,
  candidateTitle: string,
  candidateCategory?: string | null,
  candidateProductName?: string | null,
): boolean {
  if (requested.productType === 'UNKNOWN') return true;
  const candidateType = inferCandidateProductType({
    title: candidateTitle,
    category: candidateCategory,
    productName: candidateProductName,
  });
  return candidateType === requested.productType;
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
  const nameTokens = tokenizeSearchText(name);
  const modelTokens = model ? tokenizeSearchText(model) : [];
  const hardVariantTokens = extractHardVariantTokens(
    [name, model].filter(Boolean).join(' '),
  );
  const expandedHardVariantTokens = expandHardVariantTokens(hardVariantTokens);
  const hardVariantTokenSet = new Set(expandedHardVariantTokens);
  const urlOptionalTokenSet = new Set(
    [...URL_OPTIONAL_TERMS].flatMap((term) => tokenizeSearchText(term)),
  );
  const optionalTokens =
    metadata.source === 'URL_METADATA'
      ? nameTokens.filter((token) => URL_OPTIONAL_TERMS.has(token))
      : [];
  const coreSourceTokens =
    metadata.source === 'URL_METADATA' && model ? modelTokens : nameTokens;
  const coreTokens = coreSourceTokens.filter(
    (token) =>
      !hardVariantTokenSet.has(token) &&
      !(metadata.source === 'URL_METADATA' && urlOptionalTokenSet.has(token)),
  );
  const tokens = [...new Set([...coreTokens, ...expandedHardVariantTokens])];

  return {
    input,
    name,
    ...(brand ? { brand } : {}),
    ...(model ? { model } : {}),
    attributes: tokens,
    tokens,
    coreTokens,
    hardVariantTokens,
    optionalTokens,
    productType: inferQueryProductType(identityText),
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
