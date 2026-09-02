import { PublisherProcessor } from './publisher.processor';
import { DelayedError } from 'bullmq';

describe('PublisherProcessor send cadence state', () => {
  const makeProcessor = (prisma: any) =>
    new PublisherProcessor(prisma, {} as any, {} as any, {} as any);

  it('atomically claims one send lease and rejects the concurrent claimant', async () => {
    const prisma = {
      autopilotConfig: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'config-1',
          nextEligibleSendAt: null,
          intervalMinutes: 0,
        }),
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
      },
    };
    const processor = makeProcessor(prisma);
    const now = new Date('2026-08-27T12:00:00.000Z');

    await expect(
      (processor as any).claimSendLease('tenant-1', 'channel-1', now),
    ).resolves.toMatchObject({
      acquired: true,
    });
    await expect(
      (processor as any).claimSendLease('tenant-1', 'channel-1', now),
    ).resolves.toMatchObject({
      acquired: false,
    });
    expect(prisma.autopilotConfig.updateMany).toHaveBeenCalledTimes(2);
  });

  it('keeps a persisted next eligible time across a worker restart', async () => {
    const nextEligibleSendAt = new Date('2026-08-27T12:10:00.000Z');
    const prisma = {
      autopilotConfig: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'config-1',
          nextEligibleSendAt,
          intervalMinutes: 0,
        }),
        updateMany: jest.fn(),
      },
    };
    const processor = makeProcessor(prisma);

    await expect(
      (processor as any).claimSendLease(
        'tenant-1',
        'channel-1',
        new Date('2026-08-27T12:05:00.000Z'),
      ),
    ).resolves.toEqual({ acquired: false, retryAt: nextEligibleSendAt });
    expect(prisma.autopilotConfig.updateMany).not.toHaveBeenCalled();
  });

  it('creates a publication failure alert only after the final retry', async () => {
    const prisma = {
      publicationCandidate: {
        findUnique: jest.fn().mockResolvedValue({
          evaluation: {
            observation: {
              offer: { tenantId: 'tenant-1', title: 'Produto teste' },
            },
          },
        }),
      },
      channel: {
        findUnique: jest.fn().mockResolvedValue({ displayName: 'Teste' }),
      },
    };
    const events = { createPublicationFailureAlert: jest.fn() };
    const processor = new PublisherProcessor(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      events as any,
    );
    const makeJob = (attemptsMade: number) =>
      ({
        id: 'job-1',
        name: 'publish-candidate',
        data: { candidateId: 'candidate-1', channelId: 'channel-1' },
        attemptsMade,
        opts: { attempts: 3 },
      }) as any;

    await processor.onFailed(makeJob(1), new Error('temporary failure'));
    expect(events.createPublicationFailureAlert).not.toHaveBeenCalled();

    await processor.onFailed(makeJob(3), new Error('terminal failure'));
    expect(events.createPublicationFailureAlert).toHaveBeenCalledTimes(1);
    expect(events.createPublicationFailureAlert).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      jobId: 'job-1',
      product: 'Produto teste',
      channel: 'Teste',
      error: 'terminal failure',
    });
  });

  it('aggregates fan-out states without blocking a published sibling', async () => {
    const cases = [
      [['PUBLISHED', 'PUBLISHED'], 'PUBLISHED'],
      [['PUBLISHED', 'FAILED'], 'PUBLISHED'],
      [['PUBLISHED', 'DELIVERY_UNKNOWN'], 'PUBLISHED'],
      [['PUBLISHED', 'RETRYABLE'], 'PUBLISHING'],
      [['FAILED', 'FAILED'], 'FAILED'],
    ] as const;

    for (const [statuses, expectedStatus] of cases) {
      const prisma = {
        publication: {
          findMany: jest
            .fn()
            .mockResolvedValue(statuses.map((status) => ({ status }))),
        },
        publicationCandidate: { updateMany: jest.fn() },
      };
      const processor = makeProcessor(prisma);

      await (processor as any).refreshCandidateStatus('candidate-1', 2);

      expect(prisma.publicationCandidate.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: expectedStatus }),
        }),
      );
    }
  });

  it('does not send again for a published channel while another channel retries', async () => {
    const publishedPrisma = {
      publication: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'publication-1',
          status: 'PUBLISHED',
          externalMessageId: 'message-1',
          trackedLink: null,
        }),
      },
    };
    const publishedSender = { sendOfferMessage: jest.fn() };
    const publishedProcessor = new PublisherProcessor(
      publishedPrisma as any,
      publishedSender as any,
      {} as any,
      {} as any,
    );
    const candidate = { id: 'candidate-1' };
    const offer = { id: 'offer-1', tenantId: 'tenant-1' };
    const channel = { id: 'channel-1', provider: 'TELEGRAM' };

    await expect(
      (publishedProcessor as any).processChannel(
        {} as any,
        candidate,
        offer,
        channel,
      ),
    ).resolves.toMatchObject({ skipped: true, published: true });
    expect(publishedSender.sendOfferMessage).not.toHaveBeenCalled();

    const retryPrisma = {
      publication: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'publication-2',
          status: 'RETRYABLE',
          externalMessageId: null,
          trackedLink: {
            id: 'tracked-2',
            slug: 'slug-2',
            destinationUrl: 'https://shopee.test/affiliate',
          },
        }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      autopilotCatalogPolicy: { findFirst: jest.fn().mockResolvedValue(null) },
      autopilotConfig: {
        findUnique: jest.fn().mockResolvedValue({
          minSendIntervalMinutes: null,
          maxSendIntervalMinutes: null,
          intervalMinutes: 0,
          nextEligibleSendAt: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const retrySender = {
      sendOfferMessage: jest.fn().mockResolvedValue('message-2'),
    };
    const retryProcessor = new PublisherProcessor(
      retryPrisma as any,
      retrySender as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(retryProcessor as any, 'ensureVerifiedAffiliateLink')
      .mockResolvedValue('https://shopee.test/affiliate');
    jest
      .spyOn(retryProcessor as any, 'findProductCooldown')
      .mockResolvedValue({ active: false, until: null });

    await expect(
      (retryProcessor as any).processChannel(
        {} as any,
        {
          id: 'candidate-1',
          evaluation: {
            observation: { canonicalPayload: {}, category: 'Teste' },
          },
        },
        {
          id: 'offer-1',
          tenantId: 'tenant-1',
          title: 'Produto',
          price: 1000,
          marketplace: { type: 'SHOPEE' },
          url: 'https://shopee.test/product',
        },
        { id: 'channel-2', provider: 'TELEGRAM', externalChatId: 'chat-2' },
      ),
    ).resolves.toMatchObject({ published: true, messageId: 'message-2' });
    expect(retrySender.sendOfferMessage).toHaveBeenCalledTimes(1);
  });

  it('marks a preview-gated publication retryable without an external message id', async () => {
    const prisma = {
      publication: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'publication-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      trackedLink: {
        create: jest.fn().mockResolvedValue({ id: 'tracked-1' }),
      },
      autopilotConfig: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const whatsappPublisher = {
      publish: jest.fn().mockRejectedValue({
        code: 'WHATSAPP_PREVIEW_UNAVAILABLE',
      }),
    };
    const safetyGovernor = {
      evaluate: jest.fn().mockResolvedValue({ allowed: true }),
      recordFailure: jest.fn(),
      recordSuccess: jest.fn(),
    };
    const processor = new PublisherProcessor(
      prisma as any,
      {} as any,
      whatsappPublisher as any,
      safetyGovernor as any,
    );
    jest
      .spyOn(processor as any, 'ensureVerifiedAffiliateLink')
      .mockResolvedValue('https://shopee.test/affiliate');
    jest
      .spyOn(processor as any, 'findProductCooldown')
      .mockResolvedValue({ active: false, until: null });

    const job = {
      opts: { attempts: 3 },
      attemptsMade: 0,
      token: 'token-1',
      moveToDelayed: jest.fn().mockResolvedValue(undefined),
    } as any;
    const candidate = {
      id: 'candidate-1',
      evaluation: {
        score: 80,
        observation: {
          observedAt: new Date('2026-08-31T20:00:00.000Z'),
          category: 'Eletrônicos',
          canonicalPayload: {},
        },
      },
    };
    const offer = {
      id: 'offer-1',
      tenantId: 'tenant-1',
      title: 'Produto',
      price: 1000,
      marketplace: { type: 'SHOPEE' },
      priceHistories: [],
    };
    const channel = {
      id: 'channel-1',
      provider: 'WHATSAPP',
      externalChatId: 'group@g.us',
      tenant: { channelIntegrations: [] },
    };

    await expect(
      (processor as any).processChannel(job, candidate, offer, channel, false),
    ).rejects.toBeInstanceOf(DelayedError);

    expect(prisma.publication.update).toHaveBeenCalledWith({
      where: { id: 'publication-1' },
      data: {
        status: 'RETRYABLE',
        errorReason: 'WHATSAPP_PREVIEW_UNAVAILABLE',
      },
    });
    expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
    expect(safetyGovernor.recordFailure).not.toHaveBeenCalled();
  });

  it('publishes two fan-out channels independently without duplicating either one', async () => {
    const prisma = {
      publication: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest
          .fn()
          .mockResolvedValueOnce({ id: 'publication-1' })
          .mockResolvedValueOnce({ id: 'publication-2' }),
        update: jest.fn().mockResolvedValue({}),
      },
      trackedLink: {
        create: jest
          .fn()
          .mockResolvedValueOnce({ id: 'tracked-1' })
          .mockResolvedValueOnce({ id: 'tracked-2' }),
      },
      autopilotCatalogPolicy: { findFirst: jest.fn().mockResolvedValue(null) },
      autopilotConfig: {
        findUnique: jest.fn().mockResolvedValue({
          minSendIntervalMinutes: 6,
          maxSendIntervalMinutes: 15,
          intervalMinutes: 8,
          nextEligibleSendAt: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const sender = {
      sendOfferMessage: jest
        .fn()
        .mockResolvedValueOnce('message-1')
        .mockResolvedValueOnce('message-2'),
    };
    const processor = new PublisherProcessor(
      prisma as any,
      sender as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(processor as any, 'ensureVerifiedAffiliateLink')
      .mockResolvedValue('https://shopee.test/affiliate');
    jest
      .spyOn(processor as any, 'findProductCooldown')
      .mockResolvedValue({ active: false, until: null });

    const candidate = {
      id: 'candidate-1',
      evaluation: {
        observation: {
          canonicalPayload: {},
          category: 'Eletrônicos',
          observedAt: new Date('2026-08-31T20:00:00.000Z'),
        },
      },
    };
    const offer = {
      id: 'offer-1',
      tenantId: 'tenant-1',
      title: 'Produto',
      price: 1000,
      marketplace: { type: 'SHOPEE' },
      url: 'https://shopee.test/product',
    };

    await expect(
      (processor as any).processChannel(
        {} as any,
        candidate,
        offer,
        { id: 'channel-1', provider: 'TELEGRAM', externalChatId: 'chat-1' },
        false,
      ),
    ).resolves.toMatchObject({ published: true, messageId: 'message-1' });
    await expect(
      (processor as any).processChannel(
        {} as any,
        candidate,
        offer,
        { id: 'channel-2', provider: 'TELEGRAM', externalChatId: 'chat-2' },
        false,
      ),
    ).resolves.toMatchObject({ published: true, messageId: 'message-2' });

    expect(sender.sendOfferMessage).toHaveBeenCalledTimes(2);
    expect(prisma.publication.create).toHaveBeenCalledTimes(2);
    expect(prisma.trackedLink.create).toHaveBeenCalledTimes(2);
  });

  it('keeps an allowed sibling publishable when another channel is safety-blocked', async () => {
    const candidate = {
      id: 'candidate-1',
      evaluation: {
        id: 'evaluation-1',
        score: 80,
        observation: {
          offer: { tenantId: 'tenant-1', marketplaceId: 'marketplace-1' },
        },
      },
    };
    const config = {
      mode: 'AUTO',
      enabledChannels: [{ channelId: 'channel-1' }, { channelId: 'channel-2' }],
      enabledMarketplaces: [{ marketplaceId: 'marketplace-1' }],
    };
    const channelById = {
      'channel-1': {
        id: 'channel-1',
        enabled: true,
        provider: 'WHATSAPP',
        tenant: { channelIntegrations: [] },
      },
      'channel-2': {
        id: 'channel-2',
        enabled: true,
        provider: 'WHATSAPP',
        tenant: { channelIntegrations: [] },
      },
    };
    const prisma = {
      publicationCandidate: {
        findUnique: jest.fn().mockResolvedValue(candidate),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      autopilotConfig: { findUnique: jest.fn().mockResolvedValue(config) },
      channel: {
        findFirst: jest
          .fn()
          .mockImplementation(({ where }: any) =>
            Promise.resolve(channelById[where.id as 'channel-1' | 'channel-2']),
          ),
      },
      publication: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const processor = makeProcessor(prisma);
    const processChannel = jest
      .spyOn(processor as any, 'processChannel')
      .mockResolvedValueOnce({
        failed: true,
        reason: 'SAFETY_GOVERNOR',
        retryAt: new Date('2026-08-31T20:10:00.000Z'),
      })
      .mockResolvedValueOnce({
        success: true,
        published: true,
        messageId: 'message-2',
      });
    const blockedJob = {
      name: 'publish-candidate',
      token: 'token-1',
      data: {
        candidateId: 'candidate-1',
        channelId: 'channel-1',
        fanoutChannelIds: ['channel-1', 'channel-2'],
      },
      moveToDelayed: jest.fn().mockResolvedValue(undefined),
    };
    await expect(processor.process(blockedJob as any)).rejects.toBeDefined();

    const allowedJob = {
      name: 'publish-candidate',
      token: 'token-2',
      data: {
        candidateId: 'candidate-1',
        channelId: 'channel-2',
        fanoutChannelIds: ['channel-1', 'channel-2'],
      },
    };
    await expect(processor.process(allowedJob as any)).resolves.toMatchObject({
      results: [{ published: true, messageId: 'message-2' }],
    });

    expect(processChannel).toHaveBeenCalledTimes(2);
    expect(processChannel.mock.calls[0][3].id).toBe('channel-1');
    expect(processChannel.mock.calls[1][3].id).toBe('channel-2');
  });

  it('sets the offer-slot cadence only once across fan-out successes', async () => {
    const nextEligibleSendAt = new Date('2026-08-31T20:15:00.000Z');
    const prisma = {
      autopilotConfig: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            minSendIntervalMinutes: 6,
            maxSendIntervalMinutes: 15,
            intervalMinutes: 8,
            nextEligibleSendAt: null,
          })
          .mockResolvedValueOnce({ nextEligibleSendAt }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const processor = makeProcessor(prisma);
    const sentAt = new Date('2026-08-31T20:00:00.000Z');

    await (processor as any).completeSendLease('tenant-1', sentAt);
    await (processor as any).completeSendLease('tenant-1', sentAt);

    expect(prisma.autopilotConfig.updateMany).toHaveBeenCalledTimes(1);
  });

  it('does not globally skip the candidate when one scheduled channel is revoked', async () => {
    const candidate = {
      id: 'candidate-1',
      evaluation: {
        id: 'evaluation-1',
        score: 80,
        observation: {
          offer: {
            tenantId: 'tenant-1',
            marketplaceId: 'marketplace-1',
            id: 'offer-1',
          },
        },
      },
    };
    const prisma = {
      publicationCandidate: {
        findUnique: jest.fn().mockResolvedValue(candidate),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      autopilotConfig: {
        findUnique: jest.fn().mockResolvedValue({
          mode: 'AUTO',
          enabledChannels: [
            { channelId: 'channel-1' },
            { channelId: 'channel-2' },
          ],
          enabledMarketplaces: [{ marketplaceId: 'marketplace-1' }],
        }),
      },
      channel: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'channel-1',
          enabled: false,
        }),
      },
      publication: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([{ status: 'PUBLISHED' }]),
      },
      autopilotAudit: { create: jest.fn().mockResolvedValue({}) },
    };
    const processor = makeProcessor(prisma);
    const provider = { publish: jest.fn() };

    const result = await processor.process({
      name: 'publish-candidate',
      data: {
        candidateId: 'candidate-1',
        channelId: 'channel-1',
        fanoutChannelIds: ['channel-1', 'channel-2'],
      },
    } as any);

    expect(result).toMatchObject({
      skipped: true,
      reason: 'AUTOPILOT_AUTHORIZATION_REVOKED',
    });
    expect(prisma.publicationCandidate.update).not.toHaveBeenCalled();
    expect(provider.publish).not.toHaveBeenCalled();
    expect(prisma.autopilotAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channelId: 'channel-1',
          decision: 'REJECTED_CHANNEL_POLICY',
        }),
      }),
    );
  });
});
