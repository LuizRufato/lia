import Fastify from "fastify";
import cors from "@fastify/cors";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { Redis } from "ioredis";
import { Queue } from "bullmq";
import { randomUUID } from "crypto";
import {
  classifyClick,
  firstHttpsImageUrl,
  generateVisitorHash,
  getRedisConfig,
  intelligenceClassFor,
  isPreviewCrawler,
} from "@lia/core";
import { UAParser } from "ua-parser-js";
import {
  CLICK_ENQUEUE_ATTEMPTS,
  CLICK_JOB_OPTIONS,
  CLICK_QUEUE_NAME,
  TRUSTED_PROXY_RANGES,
  getClickHashSecret,
} from "./config";
import { buildSmartPreviewHtml } from "./preview";

const fastify = Fastify({ logger: true, trustProxy: TRUSTED_PROXY_RANGES });

const isProduction = process.env.NODE_ENV === "production";
const connectionString =
  process.env.DATABASE_URL ||
  (isProduction
    ? (() => {
        throw new Error("DATABASE_URL is required in production");
      })()
    : "postgresql://postgres:postgres@localhost:5432/lia_db?schema=public");
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const redisConfig = getRedisConfig();
const redis = new Redis(redisConfig.url);
const clicksQueue = new Queue(CLICK_QUEUE_NAME, {
  connection: redis,
  prefix: redisConfig.prefix,
});

const CACHE_TTL_SECONDS = 300; // 5 mins
const HASH_SECRET = getClickHashSecret(process.env);

function safeReferrer(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

fastify.register(cors, { origin: "*" });

fastify.get("/health", async () => {
  return { status: "ok", tracker: true };
});

fastify.get("/:slug", async (request, reply) => {
  const { slug } = request.params as { slug: string };

  if (!slug || slug.length < 5) {
    return reply.status(404).send("Not Found");
  }

  // 1. Redis Cache Lookup
  const cacheKey = `link:${slug}`;
  let linkDataStr: string | null = null;
  try {
    linkDataStr = await redis.get(cacheKey);
  } catch (error: any) {
    // Redis is an optimization for link lookup. A temporary outage should
    // not prevent a redirect when PostgreSQL can still resolve the link.
    fastify.log.warn(`Tracker cache lookup failed: ${error.message}`);
  }

  let linkData: {
    id: string;
    destinationUrl: string;
    active: boolean;
    expiresAt: string | null;
    tenantId: string;
    kind: "LEGACY" | "PUBLIC";
  } | null = null;

  if (linkDataStr) {
    if (linkDataStr === "NOT_FOUND") {
      return reply.status(404).send("Not Found");
    }
    linkData = JSON.parse(linkDataStr);
    linkData!.kind = linkData!.kind || "LEGACY";
  } else {
    // 2. PostgreSQL Lookup
    const dbLink = await prisma.trackedLink.findUnique({
      where: { slug },
      select: {
        id: true,
        destinationUrl: true,
        active: true,
        expiresAt: true,
        offer: { select: { tenantId: true } },
      },
    });

    if (dbLink) {
      linkData = {
        id: dbLink.id,
        destinationUrl: dbLink.destinationUrl,
        active: dbLink.active,
        expiresAt: dbLink.expiresAt ? dbLink.expiresAt.toISOString() : null,
        tenantId: dbLink.offer.tenantId,
        kind: "LEGACY",
      };
    } else {
      const publicLink = await prisma.publicTrackedLink.findUnique({
        where: { token: slug },
        select: {
          id: true,
          destinationUrl: true,
          active: true,
          expiresAt: true,
          offer: { select: { tenantId: true } },
        },
      });

      if (!publicLink) {
        await redis
          .setex(cacheKey, 60, "NOT_FOUND")
          .catch((error: any) =>
            fastify.log.warn(`Tracker negative cache failed: ${error.message}`),
          ); // Anti-hammering cache for non-existent links
        return reply.status(404).send("Not Found");
      }

      linkData = {
        id: publicLink.id,
        destinationUrl: publicLink.destinationUrl,
        active: publicLink.active,
        expiresAt: publicLink.expiresAt
          ? publicLink.expiresAt.toISOString()
          : null,
        tenantId: publicLink.offer.tenantId,
        kind: "PUBLIC",
      };
    }

    await redis
      .setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(linkData))
      .catch((error: any) =>
        fastify.log.warn(`Tracker link cache failed: ${error.message}`),
      );
  }

  // 3. Validation
  if (!linkData || !linkData.active) {
    return reply.status(410).send("Gone - Link is inactive");
  }

  if (linkData.expiresAt && new Date(linkData.expiresAt) < new Date()) {
    return reply.status(410).send("Gone - Link expired");
  }

  // Preview crawlers receive real Open Graph metadata but never create a
  // ClickEvent. Human browsers retain the fast 302 path below.
  const userAgent = request.headers["user-agent"] as string | undefined;
  if (isPreviewCrawler(userAgent)) {
    const preview =
      linkData.kind === "LEGACY"
        ? await prisma.trackedLink.findUnique({
            where: { slug },
            select: {
              destinationUrl: true,
              offer: {
                select: {
                  title: true,
                  imageUrl: true,
                  price: true,
                  product: { select: { name: true, description: true } },
                  observations: {
                    orderBy: { observedAt: "desc" },
                    take: 1,
                    select: { canonicalPayload: true },
                  },
                  priceHistories: {
                    orderBy: { observedAt: "desc" },
                    take: 1,
                    select: { originalPriceCents: true },
                  },
                },
              },
            },
          })
        : await prisma.publicTrackedLink.findUnique({
            where: { token: slug },
            select: {
              destinationUrl: true,
              offer: {
                select: {
                  title: true,
                  imageUrl: true,
                  price: true,
                  product: { select: { name: true, description: true } },
                  observations: {
                    orderBy: { observedAt: "desc" },
                    take: 1,
                    select: { canonicalPayload: true },
                  },
                  priceHistories: {
                    orderBy: { observedAt: "desc" },
                    take: 1,
                    select: { originalPriceCents: true },
                  },
                },
              },
            },
          });
    const offer = preview?.offer;
    const canonicalImage = (offer?.observations[0]?.canonicalPayload as any)
      ?.product?.images;
    const imageUrl = offer?.imageUrl || firstHttpsImageUrl(canonicalImage);
    return reply.type("text/html; charset=utf-8").send(
      buildSmartPreviewHtml(slug, {
        title: offer?.title || offer?.product?.name || "Oferta LIA",
        description: offer?.product?.description,
        destinationUrl: preview?.destinationUrl || linkData.destinationUrl,
        priceCents: offer?.price,
        originalPriceCents: offer?.priceHistories[0]?.originalPriceCents,
        imageUrl,
      }),
    );
  }

  // 4. Analytics Data Prep
  const ip = request.ip; // Fastify automatically gets it if trustProxy is set

  const eventId = randomUUID();
  const clickedAt = new Date().toISOString();

  const { classification, reason } = classifyClick(userAgent);
  const intelligenceClass = intelligenceClassFor(classification);
  const visitorHash = generateVisitorHash(
    userAgent,
    ip,
    new Date(),
    HASH_SECRET,
  );

  let userAgentFamily = null;
  let deviceType = null;

  if (userAgent) {
    const parser = new UAParser(userAgent);
    userAgentFamily = parser.getBrowser().name || null;
    deviceType = parser.getDevice().type || "desktop";
  }
  const operatingSystem = userAgent
    ? new UAParser(userAgent).getOS().name || null
    : null;
  const referrer = safeReferrer(
    (request.headers.referer as string | undefined) ||
      (request.headers.origin as string | undefined),
  );

  // 5. Fast Enqueue (bounded background retry)
  const clickJobData = {
    eventId,
    linkId: linkData.id,
    tenantId: linkData.tenantId,
    clickedAt,
    classification,
    classificationReason: reason,
    visitorHash,
    userAgentFamily,
    operatingSystem,
    deviceType,
    referrer,
    intelligenceClass,
  };

  if (linkData.kind === "LEGACY") {
    void enqueueClickWithRetry(eventId, clickJobData);
  } else {
    void prisma.publicClickEvent
      .create({
        data: {
          eventId,
          linkId: linkData.id,
          clickedAt: new Date(clickedAt),
          classification,
          classificationReason: reason,
          intelligenceClass,
          visitorHash,
          userAgentFamily,
          operatingSystem,
          deviceType,
          referrer,
        },
      })
      .catch((error: any) =>
        fastify.log.error(`Public click persistence failed: ${error.message}`),
      );
  }

  // 6. Redirect 302
  reply.header(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  reply.header("Pragma", "no-cache");
  reply.header("Expires", "0");

  return reply.redirect(302, linkData.destinationUrl);
});

async function enqueueClickWithRetry(eventId: string, data: object) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= CLICK_ENQUEUE_ATTEMPTS; attempt += 1) {
    try {
      await Promise.race([
        clicksQueue.add("process-click", data, {
          jobId: eventId,
          ...CLICK_JOB_OPTIONS,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Queue enqueue timeout")), 250),
        ),
      ]);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < CLICK_ENQUEUE_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, 25 * 2 ** (attempt - 1)),
        );
      }
    }
  }

  const message =
    lastError instanceof Error ? lastError.message : "unknown error";
  fastify.log.error(
    `Analytics enqueue failed after ${CLICK_ENQUEUE_ATTEMPTS} attempts for event ${eventId}: ${message}`,
  );
}

const start = async () => {
  try {
    const port = parseInt(process.env.TRACKER_PORT || "3002", 10);
    await fastify.listen({ port, host: "0.0.0.0" });
    console.log(`Tracker listening on http://0.0.0.0:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
