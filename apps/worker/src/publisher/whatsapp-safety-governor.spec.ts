import { WhatsAppSafetyGovernor } from './whatsapp-safety-governor';

const baseInput = () => ({
  tenantId: 'tenant-1',
  channelId: 'channel-1',
  integration: {
    provider: 'WHATSAPP',
    transport: 'WEB_UNOFFICIAL',
    status: 'CONNECTED',
    externalInstanceName: 'lia-tenant',
    encryptedAccessToken: 'encrypted',
    connectedAt: new Date(Date.now() - 10 * 60_000),
  },
  channel: {
    provider: 'WHATSAPP',
    enabled: true,
    safetyMaxPerHour: 10,
    safetyMaxPerDay: 50,
    safetyMinIntervalSeconds: 60,
  },
  offer: {
    status: 'ACTIVE',
    monetization: {
      status: 'VERIFIED',
      destinationUrl: 'https://shopee.test/offer',
    },
  },
  score: 0.8,
  observedAt: new Date(),
});

describe('WhatsAppSafetyGovernor', () => {
  const makePrisma = (config: any = null, counts = [0, 0, null]) => ({
    whatsAppSafetyConfig: {
      findUnique: jest.fn().mockResolvedValue(config),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    publication: {
      count: (() => {
        const mock = jest.fn();
        counts.forEach((value) => mock.mockResolvedValueOnce(value));
        mock.mockResolvedValue(0);
        return mock;
      })(),
      findFirst: jest.fn().mockResolvedValue(counts[2]),
    },
  });

  it('blocks an offline session and disabled group', async () => {
    const governor = new WhatsAppSafetyGovernor(makePrisma() as any);
    await expect(
      governor.evaluate({
        ...baseInput(),
        integration: { ...baseInput().integration, status: 'NEEDS_REAUTH' },
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'WHATSAPP_SESSION_OFFLINE',
    });
    await expect(
      governor.evaluate({
        ...baseInput(),
        channel: { ...baseInput().channel, enabled: false },
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'WHATSAPP_GROUP_DISABLED',
    });
  });

  it('blocks kill switch, quiet window and expired observations', async () => {
    const now = new Date('2026-08-22T12:00:00Z');
    const config = {
      enabled: true,
      killSwitch: true,
      quietStartMinute: 0,
      quietEndMinute: 1439,
      maxObservationAgeMinutes: 10,
      minQualityScore: 0,
      circuitState: 'CLOSED',
    };
    const governor = new WhatsAppSafetyGovernor(makePrisma(config) as any);
    await expect(
      governor.evaluate({ ...baseInput(), now }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'WHATSAPP_KILL_SWITCH',
    });
    const configWithoutKill = { ...config, killSwitch: false };
    const second = new WhatsAppSafetyGovernor(
      makePrisma(configWithoutKill) as any,
    );
    await expect(
      second.evaluate({
        ...baseInput(),
        integration: {
          ...baseInput().integration,
          connectedAt: new Date(now.getTime() - 10 * 60_000),
        },
        now,
        observedAt: new Date(now.getTime() - 11 * 60_000),
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'WHATSAPP_OBSERVATION_EXPIRED',
    });
  });

  it('blocks daily limit and permits a healthy candidate', async () => {
    const config = {
      enabled: true,
      killSwitch: false,
      circuitState: 'CLOSED',
      maxPerHour: 20,
      maxPerDay: 2,
      minIntervalSeconds: 30,
      maxObservationAgeMinutes: 1440,
      minQualityScore: 0.5,
    };
    const blocked = new WhatsAppSafetyGovernor(
      makePrisma(config, [2, 2, null]) as any,
    );
    await expect(blocked.evaluate(baseInput())).resolves.toMatchObject({
      allowed: false,
      reason: 'WHATSAPP_DAILY_LIMIT',
    });
    const allowed = new WhatsAppSafetyGovernor(
      makePrisma(config, [0, 0, null]) as any,
    );
    await expect(allowed.evaluate(baseInput())).resolves.toEqual({
      allowed: true,
    });
  });

  it('opens the circuit after three consecutive provider failures', async () => {
    const prisma = makePrisma({ consecutiveErrors: 2, circuitState: 'CLOSED' });
    const governor = new WhatsAppSafetyGovernor(prisma as any);
    await governor.recordFailure('tenant-1');
    expect(prisma.whatsAppSafetyConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          circuitState: 'OPEN',
          consecutiveErrors: 3,
        }),
      }),
    );
  });

  it('blocks category saturation using real publication rows', async () => {
    const prisma = makePrisma(null, [0, 0, 0, 0, 3, 0]);
    const governor = new WhatsAppSafetyGovernor(prisma as any);
    await expect(
      governor.evaluate({
        ...baseInput(),
        category: 'Electronics',
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'WHATSAPP_CATEGORY_SATURATION',
    });
    expect(prisma.publication.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['PUBLISHED', 'PUBLISHING', 'DELIVERY_UNKNOWN'] },
          candidate: {
            evaluation: { observation: { category: 'Electronics' } },
          },
        }),
      }),
    );
  });

  it('blocks seller saturation only when a reliable seller id exists', async () => {
    const prisma = makePrisma(null, [0, 0, 0, 0, 3]);
    const governor = new WhatsAppSafetyGovernor(prisma as any);
    await expect(
      governor.evaluate({
        ...baseInput(),
        sellerId: 'shop-123',
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'WHATSAPP_SELLER_SATURATION',
    });
    expect(prisma.publication.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          candidate: expect.objectContaining({
            evaluation: expect.objectContaining({
              observation: expect.objectContaining({
                canonicalPayload: expect.objectContaining({
                  path: ['seller', 'externalId'],
                  equals: 'shop-123',
                }),
              }),
            }),
          }),
        }),
      }),
    );
  });

  it('uses the tenant timezone for quiet-window decisions', async () => {
    const now = new Date('2026-08-22T13:30:00Z');
    const prisma = makePrisma(
      {
        enabled: true,
        killSwitch: false,
        circuitState: 'CLOSED',
        quietStartMinute: 9 * 60,
        quietEndMinute: 10 * 60,
      },
      [0, 0, null],
    ) as any;
    const governor = new WhatsAppSafetyGovernor(prisma);
    await expect(
      governor.evaluate({
        ...baseInput(),
        now,
        timezone: 'America/Campo_Grande',
        integration: {
          ...baseInput().integration,
          connectedAt: new Date(now.getTime() - 10 * 60_000),
        },
      }),
    ).resolves.toMatchObject({ allowed: true });
  });

  it('schedules saturation retry after the oldest blocking publication expires', async () => {
    const now = new Date('2026-08-22T12:00:00Z');
    const prisma = makePrisma(null, [0, 0, null, 0, 3]) as any;
    prisma.publication.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        createdAt: new Date(now.getTime() - 2 * 60 * 60_000),
        publishedAt: new Date(now.getTime() - 2 * 60 * 60_000),
      });
    const governor = new WhatsAppSafetyGovernor(prisma);
    const result = await governor.evaluate({
      ...baseInput(),
      now,
      category: 'Electronics',
      integration: {
        ...baseInput().integration,
        connectedAt: new Date(now.getTime() - 10 * 60_000),
      },
    });
    expect(result.reason).toBe('WHATSAPP_CATEGORY_SATURATION');
    expect(result.retryAt).toEqual(new Date(now.getTime() + 10 * 60 * 60_000));
  });
});
