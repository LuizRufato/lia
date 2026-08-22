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
  generateVisitorHash,
  getRedisConfig,
} from "@lia/core";
import { UAParser } from "ua-parser-js";

const fastify = Fastify({ logger: true });

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
const clicksQueue = new Queue("clicks-queue", {
  connection: redis,
  prefix: redisConfig.prefix,
});

const CACHE_TTL_SECONDS = 300; // 5 mins
const HASH_SECRET =
  process.env.CLICK_HASH_SECRET ||
  (isProduction
    ? (() => {
        throw new Error("CLICK_HASH_SECRET is required in production");
      })()
    : "dev-secret-123");

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
  let linkDataStr = await redis.get(cacheKey);

  let linkData: {
    id: string;
    destinationUrl: string;
    active: boolean;
    expiresAt: string | null;
    tenantId: string;
  } | null = null;

  if (linkDataStr) {
    if (linkDataStr === "NOT_FOUND") {
      return reply.status(404).send("Not Found");
    }
    linkData = JSON.parse(linkDataStr);
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

    if (!dbLink) {
      await redis.setex(cacheKey, 60, "NOT_FOUND"); // Anti-hammering cache for non-existent links
      return reply.status(404).send("Not Found");
    }

    linkData = {
      id: dbLink.id,
      destinationUrl: dbLink.destinationUrl,
      active: dbLink.active,
      expiresAt: dbLink.expiresAt ? dbLink.expiresAt.toISOString() : null,
      tenantId: dbLink.offer.tenantId,
    };

    await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(linkData));
  }

  // 3. Validation
  if (!linkData || !linkData.active) {
    return reply.status(410).send("Gone - Link is inactive");
  }

  if (linkData.expiresAt && new Date(linkData.expiresAt) < new Date()) {
    return reply.status(410).send("Gone - Link expired");
  }

  // 4. Analytics Data Prep
  const userAgent = request.headers["user-agent"] as string | undefined;
  const ip = request.ip; // Fastify automatically gets it if trustProxy is set

  const eventId = randomUUID();
  const clickedAt = new Date().toISOString();

  const { classification, reason } = classifyClick(userAgent);
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

  // 5. Fast Enqueue (Bounded wait)
  try {
    // We race the enqueue against a short timeout to never block the redirect
    await Promise.race([
      clicksQueue.add(
        "process-click",
        {
          eventId,
          linkId: linkData.id,
          tenantId: linkData.tenantId,
          clickedAt,
          classification,
          classificationReason: reason,
          visitorHash,
          userAgentFamily,
          deviceType,
        },
        { jobId: eventId },
      ), // Use eventId as jobId for BullMQ idempotency
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Queue timeout")), 50),
      ),
    ]);
  } catch (error: any) {
    fastify.log.error(
      `Analytics enqueue failed for event ${eventId}: ${error.message}`,
    );
    // DO NOT ABORT - continue with redirect
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
