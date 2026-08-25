import { AutopilotService } from './autopilot.service';

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    pttl: jest.fn().mockResolvedValue(12_000),
    disconnect: jest.fn(),
  })),
);

describe('AutopilotService controlled one-shot', () => {
  const queue = { add: jest.fn() } as any;

  const makePrisma = (channelEnabled = false) => {
    const candidate = {
      id: 'candidate-1',
      status: 'PENDING',
      evaluation: {
        id: 'evaluation-1',
        score: { toNumber: () => 80 },
        decision: 'ELIGIBLE',
        observation: {
          observedAt: new Date(),
          offer: {
            id: 'offer-1',
            tenantId: 'tenant-1',
            marketplaceId: 'marketplace-1',
            status: 'ACTIVE',
            commission: 1000,
            marketplace: { type: 'SHOPEE' },
            monetization: {
              status: 'VERIFIED',
              destinationUrl: 'https://s.shopee.com.br/verified',
              commissionAmountCents: 1000,
            },
          },
        },
      },
    };

    return {
      publicationCandidate: {
        findUnique: jest.fn().mockResolvedValue(candidate),
      },
      channel: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'channel-1',
          tenantId: 'tenant-1',
          provider: 'WHATSAPP',
          enabled: channelEnabled,
          visibility: 'PRIVATE',
        }),
      },
      autopilotConfig: {
        findUnique: jest.fn().mockResolvedValue({
          mode: 'DRY_RUN',
          minScore: { toNumber: () => 50 },
          minimumCommissionCents: 500,
          maxDailyPosts: 10,
          intervalMinutes: 1,
          allowedStartMinute: 0,
          allowedEndMinute: 1439,
          timezone: 'UTC',
          enabledMarketplaces: [{ marketplaceId: 'marketplace-1' }],
        }),
      },
      whatsAppSafetyConfig: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ maxObservationAgeMinutes: 1440 }),
      },
      marketplaceIntegration: {
        findUnique: jest.fn().mockResolvedValue({ status: 'CONNECTED' }),
      },
      publication: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
    } as any;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('blocks a disabled channel without enqueueing or touching other candidates', async () => {
    const service = new AutopilotService(makePrisma(false), queue);

    const result = await service.preflightOneShot('tenant-1', 'ADMIN', {
      candidateId: 'candidate-1',
      channelId: 'channel-1',
      confirmation: 'CONTROLLED_ONE_SHOT_REAL',
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('CHANNEL_DISABLED');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('requires an administrative role and an explicit confirmation', async () => {
    const service = new AutopilotService(makePrisma(true), queue);

    await expect(
      service.preflightOneShot('tenant-1', 'USER', {
        candidateId: 'candidate-1',
        channelId: 'channel-1',
        confirmation: 'CONTROLLED_ONE_SHOT_REAL',
      }),
    ).rejects.toThrow('Apenas administradores');

    const result = await service.preflightOneShot('tenant-1', 'ADMIN', {
      candidateId: 'candidate-1',
      channelId: 'channel-1',
      confirmation: 'wrong',
    });
    expect(result.blockers).toContain('EXPLICIT_CONFIRMATION_REQUIRED');
  });

  it('queues only the selected pair and preserves global DRY_RUN', async () => {
    const service = new AutopilotService(makePrisma(true), queue);
    jest.spyOn(service, 'preflightOneShot').mockResolvedValue({
      ready: true,
      blockers: [],
      candidateId: 'candidate-1',
      channelId: 'channel-1',
      score: 80,
      autopilotMode: 'DRY_RUN',
    });
    queue.add.mockResolvedValue({ id: 'one-shot-job-1' });

    const result = await service.executeOneShot('tenant-1', 'OWNER', {
      candidateId: 'candidate-1',
      channelId: 'channel-1',
      confirmation: 'CONTROLLED_ONE_SHOT_REAL',
    });

    expect(result).toMatchObject({
      status: 'QUEUED',
      candidateId: 'candidate-1',
      channelId: 'channel-1',
      autopilotMode: 'DRY_RUN',
    });
    expect(queue.add).toHaveBeenCalledWith(
      'controlled-one-shot',
      expect.objectContaining({
        candidateId: 'candidate-1',
        channelId: 'channel-1',
        confirmation: 'CONTROLLED_ONE_SHOT_REAL',
      }),
      expect.objectContaining({ attempts: 1 }),
    );
  });

  it('returns the ordered commercial catalog shape without raw category IDs', async () => {
    const prisma = {
      offerObservation: {
        findMany: jest.fn(),
      },
      offer: {
        findMany: jest.fn().mockResolvedValue([
          {
            title: 'Paleta Trio de Blush',
            observations: [{ category: '100630,100662,100881' }],
          },
          {
            title: 'Produto sem descrição',
            observations: [{ category: '100636,100716,101201' }],
          },
        ]),
      },
      publication: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;
    const service = new AutopilotService(prisma, queue);

    const result = await service.getCatalogCategories('tenant-1');

    expect(result.categories).toHaveLength(17);
    expect(result.categories[0]).toEqual({
      slug: 'eletronicos',
      label: 'Eletrônicos',
      observedCount: 0,
      publishedCount: 0,
    });
    expect(result.categories[7]).toMatchObject({
      slug: 'maquiagem-skincare',
      label: 'Maquiagem / Skincare',
      observedCount: 1,
    });
    expect(result.categories[16].label).toBe('Outros / Não classificados');
    expect(Object.keys(result.categories[0])).toEqual([
      'slug',
      'label',
      'observedCount',
      'publishedCount',
    ]);
  });

  it('returns the lightweight mode status without loading the dashboard', async () => {
    const findUnique = jest.fn().mockResolvedValue({ mode: 'AUTO' });
    const service = new AutopilotService(
      { autopilotConfig: { findUnique } } as any,
      queue,
    );

    await expect(service.getStatus('tenant-1')).resolves.toEqual({
      mode: 'AUTO',
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
      select: { mode: true },
    });
  });

  it('returns operational status from existing heartbeat and database data', async () => {
    const lastDecisionAt = new Date('2026-08-25T12:00:00.000Z');
    const lastShopeeDiscoveryAt = new Date('2026-08-25T11:59:00.000Z');
    const prisma = {
      autopilotConfig: {
        findUnique: jest.fn().mockResolvedValue({
          mode: 'AUTO',
          allowedStartMinute: 540,
          allowedEndMinute: 1320,
          intervalMinutes: 12,
          minScore: { toNumber: () => 65 },
          minimumCommissionCents: 500,
          maxDailyPosts: 5,
          timezone: 'America/Campo_Grande',
          enabledChannels: [],
          enabledMarketplaces: [
            {
              marketplaceId: 'marketplace-1',
              marketplace: { name: 'Shopee', type: 'SHOPEE' },
            },
          ],
          catalogPolicy: null,
        }),
      },
      publication: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      autopilotAudit: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'audit-1',
            decision: 'DRY_RUN_APPROVED',
            liaScore: { toNumber: () => 80 },
            details: null,
            createdAt: lastDecisionAt,
            candidate: null,
          },
        ]),
        create: jest.fn(),
      },
      marketplaceIntegration: {
        findMany: jest.fn().mockResolvedValue([{ provider: 'SHOPEE' }]),
        findFirst: jest.fn().mockResolvedValue({
          lastSyncAt: lastShopeeDiscoveryAt,
        }),
      },
      offerEvaluation: {
        count: jest.fn().mockResolvedValue(2),
        findFirst: jest.fn().mockResolvedValue({
          evaluatedAt: new Date('2026-08-25T11:58:00.000Z'),
        }),
      },
      channel: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      marketplace: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;
    const service = new AutopilotService(prisma, queue);

    const result = await service.getDashboard('tenant-1');

    expect(result.operationalStatus).toEqual({
      worker: { active: true, ageSeconds: 3 },
      lastShopeeDiscoveryAt,
      eligibleCandidates: 2,
      lastEvaluationAt: new Date('2026-08-25T11:58:00.000Z'),
      lastDecisionAt,
      nextOpportunity: 'Oferta elegível disponível',
    });
    expect(prisma.autopilotAudit.create).not.toHaveBeenCalled();
    expect(prisma.offerEvaluation.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          decision: 'ELIGIBLE',
          score: { gte: 65 },
        }),
      }),
    );

    prisma.offerEvaluation.count.mockResolvedValue(0);
    const emptyResult = await service.getDashboard('tenant-1');
    expect(emptyResult.operationalStatus.nextOpportunity).toBe(
      'Aguardando nova oferta com score mínimo',
    );
  });
});
