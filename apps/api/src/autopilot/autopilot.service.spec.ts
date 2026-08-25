import { AutopilotService } from './autopilot.service';

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
        findMany: jest.fn().mockResolvedValue([
          {
            category: '100630,100662,100881',
            offer: { title: 'Paleta Trio de Blush' },
          },
          {
            category: '100636,100716,101201',
            offer: { title: 'Produto sem descrição' },
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
});
