const mockRedis = {
  set: jest.fn().mockResolvedValue('OK'),
  eval: jest.fn().mockResolvedValue(1),
  quit: jest.fn().mockResolvedValue('OK'),
};

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => mockRedis),
}));

import { AutopilotSchedulerService } from './scheduler.service';

const decimal = (value: number) => ({ toNumber: () => value });

const makeCandidate = (id: string, score = 80) => ({
  id,
  status: 'PENDING',
  evaluation: {
    id: `evaluation-${id}`,
    decision: 'ELIGIBLE',
    score: decimal(score),
    observation: {
      observedAt: new Date('2026-08-31T12:00:00.000Z'),
      category: 'Eletrônicos',
      canonicalPayload: { product: { title: `Produto ${id}` } },
      offer: {
        id: `offer-${id}`,
        externalId: `offer-${id}`,
        tenantId: 'tenant-1',
        marketplaceId: 'marketplace-1',
        status: 'ACTIVE',
        title: `Produto ${id}`,
        price: 1000,
        commission: 100,
        marketplace: { type: 'SHOPEE', name: 'Shopee' },
        monetization: {
          status: 'VERIFIED',
          destinationUrl: 'https://shopee.test/affiliate',
        },
      },
    },
  },
});

const makeEvaluation = (id: string, score = 80) => {
  const candidate = makeCandidate(id, score);
  return {
    ...candidate.evaluation,
    candidate,
    observation: candidate.evaluation.observation,
  };
};

const makeConfig = (
  mode: 'AUTO' | 'DRY_RUN' = 'AUTO',
  channelIds = ['channel-1'],
  overrides: Record<string, any> = {},
) => ({
  tenantId: 'tenant-1',
  mode,
  allowedStartMinute: 0,
  allowedEndMinute: 1439,
  timezone: 'UTC',
  minScore: decimal(50),
  minimumCommissionCents: 0,
  maxDailyPosts: 120,
  intervalMinutes: 8,
  minSendIntervalMinutes: null,
  maxSendIntervalMinutes: null,
  nextEligibleSendAt: null,
  enabledChannels: channelIds.map((channelId) => ({
    channelId,
    channel: { enabled: true, visibility: 'PRIVATE' },
  })),
  enabledMarketplaces: [{ marketplaceId: 'marketplace-1' }],
  catalogPolicy: { mode: 'OPEN' },
  ...overrides,
});

const makePrisma = () => ({
  offerEvaluation: { findMany: jest.fn().mockResolvedValue([]) },
  publication: {
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
  },
  marketplaceIntegration: {
    findMany: jest
      .fn()
      .mockResolvedValue([{ provider: 'SHOPEE', status: 'CONNECTED' }]),
  },
  publicationCandidate: {
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    update: jest.fn().mockResolvedValue({}),
  },
  autopilotAudit: { create: jest.fn().mockResolvedValue({}) },
});

const makeService = (prisma: any, queue: any) =>
  new AutopilotSchedulerService(prisma, {} as any, queue as any);

describe('AutopilotSchedulerService bounded delivery planning', () => {
  afterEach(() => jest.clearAllMocks());

  it('stops before candidate lookup while global pacing is not due', async () => {
    const prisma = makePrisma();
    const queue = { add: jest.fn() };
    const service = makeService(prisma, queue);
    const nextEligibleSendAt = new Date(Date.now() + 60_000);

    await (service as any).evaluateForTenant(
      makeConfig('AUTO', ['channel-1'], { nextEligibleSendAt }),
      'tenant-1',
    );

    expect(prisma.offerEvaluation.findMany).not.toHaveBeenCalled();
    expect(prisma.publicationCandidate.updateMany).not.toHaveBeenCalled();
    expect(prisma.autopilotAudit.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('uses a deterministic bounded scan of 50 evaluations', async () => {
    const prisma = makePrisma();
    const queue = { add: jest.fn() };
    const service = makeService(prisma, queue);

    await (service as any).evaluateForTenant(makeConfig(), 'tenant-1');

    expect(prisma.offerEvaluation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
        orderBy: [{ score: 'desc' }, { id: 'asc' }],
      }),
    );
  });

  it('finds a valid candidate after 49 local blockers in the same tick', async () => {
    const prisma = makePrisma();
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const service = makeService(prisma, queue);
    const evaluations = Array.from({ length: 50 }, (_, index) =>
      makeEvaluation(`candidate-${index + 1}`, 100 - index),
    );
    prisma.offerEvaluation.findMany.mockResolvedValue(evaluations);
    jest.spyOn(service as any, 'createAudit').mockResolvedValue(undefined);
    const guard = jest
      .spyOn(service as any, 'evaluateCatalogPublicationGuards')
      .mockImplementation(async (...args: any[]) =>
        Number(String(args[3]).replace('offer-candidate-', '')) <= 49
          ? {
              allowed: false,
              reason: 'REJECTED_PRODUCT_COOLDOWN',
              details: 'blocked for test',
              retryAt: new Date(Date.now() + 60_000),
            }
          : { allowed: true },
      );

    await (service as any).evaluateForTenant(makeConfig(), 'tenant-1');

    expect(guard).toHaveBeenCalledTimes(50);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][1].candidateId).toBe('candidate-50');
  });

  it('does not read beyond the first 50 blockers', async () => {
    const prisma = makePrisma();
    const queue = { add: jest.fn() };
    const service = makeService(prisma, queue);
    prisma.offerEvaluation.findMany.mockResolvedValue(
      Array.from({ length: 50 }, (_, index) =>
        makeEvaluation(`candidate-${index}`),
      ),
    );
    jest.spyOn(service as any, 'createAudit').mockResolvedValue(undefined);
    const guard = jest
      .spyOn(service as any, 'evaluateCatalogPublicationGuards')
      .mockResolvedValue({
        allowed: false,
        reason: 'REJECTED_PRODUCT_COOLDOWN',
        details: 'blocked for test',
        retryAt: new Date(Date.now() + 60_000),
      });

    await (service as any).evaluateForTenant(makeConfig(), 'tenant-1');

    expect(guard).toHaveBeenCalledTimes(50);
    expect(queue.add).not.toHaveBeenCalled();
    expect(prisma.offerEvaluation.findMany).toHaveBeenCalledTimes(1);
  });

  it('creates one independent job per valid channel with one pacing leader', async () => {
    const prisma = makePrisma();
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const service = makeService(prisma, queue);
    prisma.offerEvaluation.findMany.mockResolvedValue([
      makeEvaluation('candidate-1'),
    ]);
    jest.spyOn(service as any, 'createAudit').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'evaluateCatalogPublicationGuards')
      .mockResolvedValue({ allowed: true });

    await (service as any).evaluateForTenant(
      makeConfig('AUTO', ['channel-1', 'channel-2']),
      'tenant-1',
    );

    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add.mock.calls.map((call: any[]) => call[2].jobId)).toEqual([
      'publish-candidate-1-channel-1',
      'publish-candidate-1-channel-2',
    ]);
    const jobs = queue.add.mock.calls.map((call: any[]) => call[1]);
    expect(jobs.every((job: any) => job.fanoutChannelIds.length === 2)).toBe(
      true,
    );
    expect(jobs.filter((job: any) => job.pacingLeader)).toHaveLength(1);
  });

  it('keeps an allowed channel when another channel guard blocks', async () => {
    const prisma = makePrisma();
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const service = makeService(prisma, queue);
    prisma.offerEvaluation.findMany.mockResolvedValue([
      makeEvaluation('candidate-1'),
    ]);
    jest.spyOn(service as any, 'createAudit').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'evaluateCatalogPublicationGuards')
      .mockImplementation(async (_tenant, _timezone, channelId) =>
        channelId === 'channel-1'
          ? {
              allowed: false,
              reason: 'REJECTED_CATEGORY_DAILY_LIMIT',
              details: 'blocked for test',
              retryAt: new Date(Date.now() + 60_000),
            }
          : { allowed: true },
      );

    await (service as any).evaluateForTenant(
      makeConfig('AUTO', ['channel-1', 'channel-2']),
      'tenant-1',
    );

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][1].channelId).toBe('channel-2');
    expect(prisma.publicationCandidate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'QUEUED', deferredReason: null, retryAt: null },
      }),
    );
  });

  it('uses the earliest retryAt when every channel is blocked', async () => {
    const run = async (channelIds: string[]) => {
      const prisma = makePrisma();
      const service = makeService(prisma, { add: jest.fn() });
      prisma.offerEvaluation.findMany.mockResolvedValue([
        makeEvaluation('candidate-1'),
      ]);
      jest.spyOn(service as any, 'createAudit').mockResolvedValue(undefined);
      jest
        .spyOn(service as any, 'evaluateCatalogPublicationGuards')
        .mockImplementation(async (_tenant, _timezone, channelId) => ({
          allowed: false,
          reason: 'REJECTED_PRODUCT_COOLDOWN',
          details: 'blocked for test',
          retryAt:
            channelId === 'channel-1'
              ? new Date('2026-08-31T20:20:00.000Z')
              : new Date('2026-08-31T20:05:00.000Z'),
        }));

      await (service as any).evaluateForTenant(
        makeConfig('AUTO', channelIds),
        'tenant-1',
      );
      return prisma.publicationCandidate.updateMany.mock.calls.at(-1)[0].data
        .retryAt as Date;
    };

    await expect(run(['channel-1', 'channel-2'])).resolves.toEqual(
      new Date('2026-08-31T20:05:00.000Z'),
    );
    await expect(run(['channel-2', 'channel-1'])).resolves.toEqual(
      new Date('2026-08-31T20:05:00.000Z'),
    );
  });

  it('counts two publications for one candidate as one daily offer slot', async () => {
    const prisma = makePrisma();
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const service = makeService(prisma, queue);
    prisma.publication.findMany.mockResolvedValue([
      { candidateId: 'existing-candidate' },
      { candidateId: 'existing-candidate' },
    ]);
    prisma.offerEvaluation.findMany.mockResolvedValue([
      makeEvaluation('candidate-1'),
    ]);
    jest.spyOn(service as any, 'createAudit').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'evaluateCatalogPublicationGuards')
      .mockResolvedValue({ allowed: true });

    await (service as any).evaluateForTenant(
      makeConfig('AUTO', ['channel-1'], { maxDailyPosts: 2 }),
      'tenant-1',
    );

    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('counts two different candidates as two daily offer slots', async () => {
    const prisma = makePrisma();
    const queue = { add: jest.fn() };
    const service = makeService(prisma, queue);
    prisma.publication.findMany.mockResolvedValue([
      { candidateId: 'candidate-a' },
      { candidateId: 'candidate-b' },
    ]);
    prisma.offerEvaluation.findMany.mockResolvedValue([
      makeEvaluation('candidate-1'),
    ]);
    jest.spyOn(service as any, 'createAudit').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'evaluateCatalogPublicationGuards')
      .mockResolvedValue({ allowed: true });

    await (service as any).evaluateForTenant(
      makeConfig('AUTO', ['channel-1'], { maxDailyPosts: 2 }),
      'tenant-1',
    );

    expect(queue.add).not.toHaveBeenCalled();
    expect(prisma.publicationCandidate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DEFERRED',
          deferredReason: 'DEFERRED_DAILY_LIMIT',
        }),
      }),
    );
  });
});
