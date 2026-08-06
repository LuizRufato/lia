import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { Queue } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import { CanonicalOffer } from '@lia/core';
import Redis from 'ioredis';
import { ReconcilerService } from '../src/reconciler.service';
import { OfferProcessor } from '../src/offer.processor';

describe('Offer Processor (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let offerQueue: Queue;
  let pubQueue: Queue;
  let redis: Redis;
  const testPrefix = `{lia:test:${Date.now()}}`;

  beforeAll(async () => {
    process.env.REDIS_PREFIX = testPrefix;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    offerQueue = app.get<Queue>(getQueueToken('offer-processing'));
    pubQueue = app.get<Queue>(getQueueToken('publisher'));

    // Connect a raw redis client for cleanup
    redis = new Redis({ host: 'localhost', port: 6379 });
  });

  afterAll(async () => {
    // Delete only keys belonging to this test prefix
    if (redis) {
      const keys = await redis.keys(`${testPrefix}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      await redis.quit();
    }

    if (app) {
      await app.close();
    }
  });

  const generateCanonicalOffer = (): CanonicalOffer => ({
    marketplace: 'SHOPEE',
    externalOfferId: `TEST_${Date.now()}`,
    canonicalUrl: 'http://test.com',
    sourceUrl: 'http://test.com',
    currency: 'BRL',
    product: { title: 'Test Product', images: [] },
    pricing: { currentPriceCents: 10000 },
    shipping: { isFree: true },
    commission: {
      estimatedAmountCents: 1000,
      rateBps: 1000,
      source: 'CALCULATED',
    },
    metrics: { rating: 4.8 },
    seller: { isOfficial: true },
    discoveredAt: new Date(),
  });

  it('should process a valid observation and produce a publication candidate', async () => {
    const canonical = generateCanonicalOffer();

    // Seed DB setup
    let tenant = await prisma.tenant.findFirst();
    if (!tenant)
      tenant = await prisma.tenant.create({ data: { name: 'Test Tenant' } });

    let mp = await prisma.marketplace.findUnique({ where: { type: 'SHOPEE' } });
    if (!mp)
      mp = await prisma.marketplace.create({
        data: { name: 'Shopee', type: 'SHOPEE' },
      });

    const offer = await prisma.offer.create({
      data: {
        tenant: { connect: { id: tenant.id } },
        marketplace: { connect: { id: mp.id } },
        externalId: canonical.externalOfferId,
        title: canonical.product.title,
        price: 10000,
        commission: 1000,
        url: canonical.canonicalUrl,
      },
    });

    const obs = await prisma.offerObservation.create({
      data: {
        offerId: offer.id,
        correlationId: `evt_${Date.now()}`,
        schemaVersion: '1.0',
        canonicalPayload: canonical as any,
        observedAt: new Date(),
      },
    });

    // Directly call processor service instead of waiting for worker job for deterministic testing
    const processor = app.get(OfferProcessor);
    await processor.process({
      id: '1',
      data: { observationId: obs.id },
    } as any);

    // Verify Evaluation
    const evalResult = await prisma.offerEvaluation.findFirst({
      where: { observationId: obs.id },
    });

    expect(evalResult).toBeDefined();
    expect(evalResult.decision).toBe('ELIGIBLE');

    // Verify Candidate
    const candidate = await prisma.publicationCandidate.findFirst({
      where: { evaluationId: evalResult.id },
    });

    expect(candidate).toBeDefined();
    expect(candidate.status).toBe('PENDING');
  });

  it('should reject as duplicate if price is the same', async () => {
    const canonical = generateCanonicalOffer();
    const tenant = await prisma.tenant.findFirst();
    const mp = await prisma.marketplace.findFirst();

    const offer = await prisma.offer.create({
      data: {
        tenant: { connect: { id: tenant.id } },
        marketplace: { connect: { id: mp.id } },
        externalId: canonical.externalOfferId,
        title: canonical.product.title,
        price: 10000, // Same price
        commission: 1000,
        url: canonical.canonicalUrl,
      },
    });

    const mockObs = await prisma.offerObservation.create({
      data: {
        offerId: offer.id,
        correlationId: `mock_${Date.now()}`,
        schemaVersion: '1.0',
        canonicalPayload: {} as any,
        observedAt: new Date(),
      },
    });

    await prisma.offerEvaluation.create({
      data: {
        offerId: offer.id,
        observationId: mockObs.id,
        scoreVersion: '1.0',
        score: 100,
        decision: 'ELIGIBLE',
        decisionReasons: [],
        scoreBreakdown: {},
        inputsSnapshot: {},
      },
    });

    const obs = await prisma.offerObservation.create({
      data: {
        offerId: offer.id,
        correlationId: `evt_dup_${Date.now()}`,
        schemaVersion: '1.0',
        canonicalPayload: canonical as any,
        observedAt: new Date(),
      },
    });

    const processor = app.get(OfferProcessor);
    await processor.process({
      id: '2',
      data: { observationId: obs.id },
    } as any);

    const evalResult = await prisma.offerEvaluation.findFirst({
      where: { observationId: obs.id },
    });

    expect(evalResult.decision).toBe('REJECTED_DUPLICATE');
  });

  it('should accept as price drop if price drops >= 5%', async () => {
    const canonical = generateCanonicalOffer();
    canonical.pricing.currentPriceCents = 9000; // 10% drop

    const tenant = await prisma.tenant.findFirst();
    const mp = await prisma.marketplace.findFirst();

    const offer = await prisma.offer.create({
      data: {
        tenant: { connect: { id: tenant.id } },
        marketplace: { connect: { id: mp.id } },
        externalId: canonical.externalOfferId,
        title: canonical.product.title,
        price: 10000, // Old price
        commission: 1000,
        url: canonical.canonicalUrl,
      },
    });

    const mockObs = await prisma.offerObservation.create({
      data: {
        offerId: offer.id,
        correlationId: `mock2_${Date.now()}`,
        schemaVersion: '1.0',
        canonicalPayload: {} as any,
        observedAt: new Date(),
      },
    });

    await prisma.offerEvaluation.create({
      data: {
        offerId: offer.id,
        observationId: mockObs.id,
        scoreVersion: '1.0',
        score: 100,
        decision: 'ELIGIBLE',
        decisionReasons: [],
        scoreBreakdown: {},
        inputsSnapshot: {},
      },
    });

    const obs = await prisma.offerObservation.create({
      data: {
        offerId: offer.id,
        correlationId: `evt_drop_${Date.now()}`,
        schemaVersion: '1.0',
        canonicalPayload: canonical as any,
        observedAt: new Date(),
      },
    });

    const processor = app.get(OfferProcessor);
    await processor.process({
      id: '3',
      data: { observationId: obs.id },
    } as any);

    const evalResult = await prisma.offerEvaluation.findFirst({
      where: { observationId: obs.id },
    });

    expect(evalResult.decision).toBe('ELIGIBLE');
  });

  it('should reconcile PENDING candidates', async () => {
    // Create an old PENDING candidate
    const reconciler = app.get(ReconcilerService);

    const evalMock = await prisma.offerEvaluation.findFirst();
    const uniqueEval = await prisma.offerEvaluation.create({
      data: {
        offerId: evalMock.offerId,
        observationId: evalMock.observationId,
        scoreVersion: '1.0',
        score: 100,
        decision: 'ELIGIBLE',
        decisionReasons: [],
        scoreBreakdown: {},
        inputsSnapshot: {},
      },
    });

    const candidate = await prisma.publicationCandidate.create({
      data: {
        evaluationId: uniqueEval.id,
        status: 'PENDING',
        createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
        updatedAt: new Date(Date.now() - 5 * 60 * 1000),
      },
    });

    await reconciler.reconcilePendingPublications();

    // Check status
    const updated = await prisma.publicationCandidate.findUnique({
      where: { id: candidate.id },
    });

    expect(updated.status).toBe('QUEUED');

    // Check job exists in pubQueue
    const job = await pubQueue.getJob(`pub-${candidate.id}`);
    expect(job).toBeDefined();
    expect(job.data.candidateId).toBe(candidate.id);
  });
});
