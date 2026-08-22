export interface RedisConfig {
  url: string;
  host: string;
  port: number;
  prefix: string;
  username?: string;
  password?: string;
  db?: number;
  tls?: { rejectUnauthorized?: boolean };
}

type RedisEnvironment = Record<string, string | undefined>;

const DEFAULT_REDIS_URL = "redis://localhost:6379";
const DEFAULT_REDIS_PREFIX = "{lia}";

/**
 * Resolve Redis once for all API/Worker/Tracker entry points.
 * REDIS_URL is authoritative when present; host/port remain a compatible
 * fallback for local environments and preserve URL auth/TLS details.
 */
export function getRedisConfig(
  environment: RedisEnvironment = process.env,
): RedisConfig {
  const url = environment.REDIS_URL?.trim() || DEFAULT_REDIS_URL;
  const hasConfiguredUrl = Boolean(environment.REDIS_URL?.trim());
  let parsed: URL | undefined;

  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }

  const configuredPort = Number.parseInt(environment.REDIS_PORT ?? "", 10);
  const parsedPort = parsed?.port ? Number.parseInt(parsed.port, 10) : NaN;
  const port =
    hasConfiguredUrl && Number.isFinite(parsedPort)
      ? parsedPort
      : Number.isFinite(configuredPort)
        ? configuredPort
        : Number.isFinite(parsedPort)
          ? parsedPort
          : 6379;

  const config: RedisConfig = {
    url,
    host: hasConfiguredUrl
      ? parsed?.hostname || "localhost"
      : environment.REDIS_HOST?.trim() || parsed?.hostname || "localhost",
    port,
    prefix: environment.REDIS_PREFIX?.trim() || DEFAULT_REDIS_PREFIX,
  };

  if (parsed?.username) config.username = decodeURIComponent(parsed.username);
  if (parsed?.password) config.password = decodeURIComponent(parsed.password);
  if (parsed?.pathname && parsed.pathname !== "/") {
    const db = Number.parseInt(parsed.pathname.slice(1), 10);
    if (Number.isFinite(db)) config.db = db;
  }
  if (parsed?.protocol === "rediss:") {
    config.tls = {};
  }

  return config;
}

export function getBullMqRedisConnection(environment?: RedisEnvironment) {
  const config = getRedisConfig(environment);

  return {
    host: config.host,
    port: config.port,
    ...(config.username ? { username: config.username } : {}),
    ...(config.password ? { password: config.password } : {}),
    ...(config.db !== undefined ? { db: config.db } : {}),
    ...(config.tls ? { tls: config.tls } : {}),
  };
}
