import { OfferService } from './offer.service';

const canonical = (price: number, observedAt: string) => ({
  marketplace: 'SHOPEE',
  externalOfferId: 'offer-1',
  canonicalUrl: 'https://example.com/offer-1',
  sourceUrl: 'https://example.com/offer-1',
  currency: 'BRL',
  product: {
    title: 'Produto',
    images: ['https://example.com/image.jpg'],
    normalizedCategory: 'smartphones',
  },
  pricing: {
    currentPriceCents: price,
    originalPriceCents: 1200,
    discountBps: 1000,
  },
  shipping: { isFree: true },
  commission: {
    estimatedAmountCents: 120,
    rateBps: 1000,
    source: 'CALCULATED',
  },
  metrics: {
    rating: 4.5,
    reviewsCount: 100,
    marketplaceSalesCount: 50,
  },
  seller: { isOfficial: true },
  discoveredAt: new Date(observedAt),
});

describe('OfferService historical processing', () => {
  it('keeps 1000 → 990 → 800 snapshots and uses the prior snapshot for dedup', async () => {
    const observations = [
      {
        id: 'obs-1',
        offerId: 'offer-1',
        observedAt: new Date('2026-08-01T10:00:00Z'),
        canonicalPayload: canonical(1000, '2026-08-01T10:00:00Z'),
      },
      {
        id: 'obs-2',
        offerId: 'offer-1',
        observedAt: new Date('2026-08-01T11:00:00Z'),
        canonicalPayload: canonical(990, '2026-08-01T11:00:00Z'),
      },
      {
        id: 'obs-3',
        offerId: 'offer-1',
        observedAt: new Date('2026-08-01T12:00:00Z'),
        canonicalPayload: canonical(800, '2026-08-01T12:00:00Z'),
      },
    ];
    const histories: any[] = [];
    const evaluations: any[] = [];
    const candidates: any[] = [];
    const offer = { id: 'offer-1', tenantId: 'tenant-1', price: 1000 };

    const prisma: any = {
      offerObservation: {
        findUnique: jest.fn(({ where }: any) => {
          const observation = observations.find((item) => item.id === where.id);
          return observation ? { ...observation, offer } : null;
        }),
      },
      $transaction: async (callback: (tx: any) => Promise<unknown>) => {
        const tx = {
          priceHistory: {
            findMany: jest.fn(async () =>
              [...histories].sort(
                (a, b) => b.observedAt.getTime() - a.observedAt.getTime(),
              ),
            ),
            upsert: jest.fn(async ({ create, update }: any) => {
              const index = histories.findIndex(
                (item) =>
                  item.observationId ===
                  (create.observationId ?? update.observationId),
              );
              const next = {
                ...(index >= 0 ? histories[index] : {}),
                ...(index >= 0 ? update : create),
              };
              if (index >= 0) histories[index] = next;
              else histories.push(next);
              return next;
            }),
          },
          publication: {
            count: jest.fn().mockResolvedValue(0),
            findMany: jest.fn().mockResolvedValue([]),
          },
          autopilotCatalogPolicy: {
            findFirst: jest.fn().mockResolvedValue({
              productCooldownHours: 120,
            }),
          },
          offerEvaluation: {
            upsert: jest.fn(async ({ create }: any) => {
              const existing = evaluations.find(
                (item) => item.observationId === create.observationId,
              );
              if (existing) return existing;
              const evaluation = {
                id: `evaluation-${evaluations.length + 1}`,
                ...create,
              };
              evaluations.push(evaluation);
              return evaluation;
            }),
          },
          publicationCandidate: {
            findFirst: jest.fn(
              async () =>
                candidates.find((item) =>
                  ['PENDING', 'DEFERRED', 'QUEUED', 'PUBLISHING'].includes(
                    item.status,
                  ),
                ) || null,
            ),
            upsert: jest.fn(async ({ create }: any) => {
              const existing = candidates.find(
                (item) => item.evaluationId === create.evaluationId,
              );
              if (existing) return existing;
              const candidate = {
                id: `candidate-${candidates.length + 1}`,
                ...create,
              };
              candidates.push(candidate);
              return candidate;
            }),
          },
          offer: {
            update: jest.fn(async ({ data }: any) =>
              Object.assign(offer, data),
            ),
          },
        };
        return callback(tx);
      },
    };

    const service = new OfferService(prisma);
    await service.processObservation('obs-1');
    await service.processObservation('obs-2');
    candidates[0].status = 'FAILED';
    await service.processObservation('obs-3');

    expect(histories.map((item) => item.priceCents)).toEqual([1000, 990, 800]);
    expect(evaluations.map((item) => item.decision)).toEqual([
      'ELIGIBLE',
      'REJECTED_DUPLICATE',
      'ELIGIBLE',
    ]);
    expect(candidates).toHaveLength(2);
  });

  it('persists Mercado Livre observations without creating publication candidates', async () => {
    const mlOffer = canonical(1000, '2026-08-01T10:00:00Z');
    mlOffer.marketplace = 'MERCADO_LIVRE';
    const candidateUpsert = jest.fn();
    const prisma: any = {
      offerObservation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ml-obs',
          offerId: 'ml-offer',
          observedAt: new Date('2026-08-01T10:00:00Z'),
          canonicalPayload: mlOffer,
          offer: { id: 'ml-offer', tenantId: 'tenant-1' },
        }),
      },
      $transaction: async (callback: (tx: any) => Promise<unknown>) =>
        callback({
          priceHistory: {
            findMany: jest.fn().mockResolvedValue([]),
            upsert: jest.fn().mockResolvedValue({}),
          },
          publication: { count: jest.fn().mockResolvedValue(0) },
          offerEvaluation: {
            upsert: jest.fn().mockResolvedValue({ id: 'ml-evaluation' }),
          },
          publicationCandidate: { upsert: candidateUpsert },
          offer: { update: jest.fn().mockResolvedValue({}) },
        }),
    };

    await new OfferService(prisma).processObservation('ml-obs');

    expect(candidateUpsert).not.toHaveBeenCalled();
  });
});

const makeLifecycleHarness = (policyHours: number | null = 120) => {
  const observations: any[] = [];
  const histories: any[] = [];
  const evaluations: any[] = [];
  const candidates: any[] = [];
  const publications: any[] = [];
  const offer = { id: 'offer-1', tenantId: 'tenant-1', price: 1000 };
  let now = new Date('2026-08-01T10:00:00.000Z');

  const prisma: any = {
    offerObservation: {
      findUnique: jest.fn(({ where }: any) => {
        const observation = observations.find((item) => item.id === where.id);
        return observation ? { ...observation, offer } : null;
      }),
    },
    $transaction: async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        priceHistory: {
          findMany: jest.fn(async () =>
            [...histories].sort(
              (a, b) => b.observedAt.getTime() - a.observedAt.getTime(),
            ),
          ),
          upsert: jest.fn(async ({ create, update }: any) => {
            const index = histories.findIndex(
              (item) =>
                item.observationId ===
                (create.observationId ?? update.observationId),
            );
            const next = {
              ...(index >= 0 ? histories[index] : {}),
              ...(index >= 0 ? update : create),
            };
            if (index >= 0) histories[index] = next;
            else histories.push(next);
            return next;
          }),
        },
        publication: {
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn(async () => publications),
        },
        autopilotCatalogPolicy: {
          findFirst: jest.fn().mockResolvedValue({
            productCooldownHours: policyHours,
          }),
        },
        offerEvaluation: {
          upsert: jest.fn(async ({ create }: any) => {
            const existing = evaluations.find(
              (item) => item.observationId === create.observationId,
            );
            if (existing) return existing;
            const evaluation = {
              id: `evaluation-${evaluations.length + 1}`,
              ...create,
            };
            evaluations.push(evaluation);
            return evaluation;
          }),
        },
        publicationCandidate: {
          findFirst: jest.fn(
            async () =>
              candidates.find((item) =>
                ['PENDING', 'DEFERRED', 'QUEUED', 'PUBLISHING'].includes(
                  item.status,
                ),
              ) || null,
          ),
          findMany: jest.fn(async () => candidates),
          upsert: jest.fn(async ({ create }: any) => {
            const existing = candidates.find(
              (item) => item.evaluationId === create.evaluationId,
            );
            if (existing) return existing;
            const candidate = {
              id: `candidate-${candidates.length + 1}`,
              createdAt: now,
              updatedAt: now,
              ...create,
            };
            candidates.push(candidate);
            return candidate;
          }),
        },
        offer: {
          update: jest.fn().mockResolvedValue({}),
        },
      }),
  };

  const service = new OfferService(prisma);
  service.clock = () => now.getTime();

  const addObservation = async (
    id: string,
    observedAt: Date,
    payload = canonical(1000, observedAt.toISOString()),
  ) => {
    observations.push({
      id,
      offerId: 'offer-1',
      observedAt,
      canonicalPayload: payload,
    });
    now = observedAt;
    return service.processObservation(id);
  };

  return {
    addObservation,
    candidates,
    evaluations,
    publications,
    setNow: (value: Date) => {
      now = value;
    },
  };
};

describe('OfferService lifecycle-aware reconsideration', () => {
  it.each([
    { label: 'higher price', price: 1100 },
    { label: 'small drop', price: 990 },
  ])('does not spam on a $label observation', async ({ price }) => {
    const harness = makeLifecycleHarness();

    await harness.addObservation('obs-1', new Date('2026-08-01T10:00:00Z'));
    await harness.addObservation(
      'obs-2',
      new Date('2026-08-01T10:05:00Z'),
      canonical(price, '2026-08-01T10:05:00Z'),
    );

    expect(harness.candidates).toHaveLength(1);
    expect(harness.evaluations.at(-1).decision).toBe('REJECTED_DUPLICATE');
  });

  it('does not create duplicate live candidates for repeated observations', async () => {
    const harness = makeLifecycleHarness();

    await harness.addObservation('obs-1', new Date('2026-08-01T10:00:00Z'));
    await harness.addObservation('obs-2', new Date('2026-08-01T10:05:00Z'));
    await harness.addObservation('obs-3', new Date('2026-08-01T10:10:00Z'));

    expect(harness.candidates).toHaveLength(1);
    expect(harness.evaluations.map((item) => item.decision)).toEqual([
      'ELIGIBLE',
      'REJECTED_DUPLICATE',
      'REJECTED_DUPLICATE',
    ]);
  });

  it('blocks a republish during the configured cooldown and allows it after expiry', async () => {
    const harness = makeLifecycleHarness(120);
    const publishedAt = new Date('2026-08-01T10:00:00Z');

    await harness.addObservation('obs-1', publishedAt);
    harness.candidates[0].status = 'PUBLISHED';
    harness.publications.push({
      publishedAt,
      createdAt: publishedAt,
      status: 'PUBLISHED',
    });

    await harness.addObservation('obs-2', new Date('2026-08-06T09:00:00Z'));
    expect(harness.candidates).toHaveLength(1);

    await harness.addObservation('obs-3', new Date('2026-08-06T11:00:00Z'));
    expect(harness.candidates).toHaveLength(2);
    expect(harness.evaluations.at(-1).decision).toBe('ELIGIBLE');
  });

  it('permits a terminal candidate to be reconsidered after the bounded interval', async () => {
    const harness = makeLifecycleHarness(null);

    await harness.addObservation('obs-1', new Date('2026-08-01T10:00:00Z'));
    harness.candidates[0].status = 'FAILED';
    await harness.addObservation('obs-2', new Date('2026-08-02T11:00:00Z'));

    expect(harness.candidates).toHaveLength(2);
    expect(harness.evaluations.at(-1).decision).toBe('ELIGIBLE');
  });

  it('allows a later strong observation after an earlier below-score observation', async () => {
    const harness = makeLifecycleHarness(null);
    const weak = canonical(1000, '2026-08-01T10:00:00Z');
    weak.commission = {
      estimatedAmountCents: null,
      rateBps: null,
      source: 'UNAVAILABLE',
    };
    weak.pricing.discountBps = null;
    weak.shipping = { isFree: null };
    weak.seller = { isOfficial: null };
    weak.metrics = {
      rating: null,
      reviewsCount: 0,
      marketplaceSalesCount: 0,
    };

    await harness.addObservation(
      'obs-1',
      new Date('2026-08-01T10:00:00Z'),
      weak,
    );
    await harness.addObservation('obs-2', new Date('2026-08-02T11:00:00Z'));

    expect(harness.evaluations[0].decision).toBe('REJECTED_INSUFFICIENT_DATA');
    expect(harness.evaluations[1].decision).toBe('ELIGIBLE');
    expect(harness.candidates).toHaveLength(1);
  });

  it.each(['PENDING', 'DEFERRED', 'QUEUED', 'PUBLISHING'])(
    'keeps one live candidate when the existing status is %s',
    async (status) => {
      const harness = makeLifecycleHarness();

      await harness.addObservation('obs-1', new Date('2026-08-01T10:00:00Z'));
      harness.candidates[0].status = status;
      await harness.addObservation('obs-2', new Date('2026-08-02T11:00:00Z'));

      expect(harness.candidates).toHaveLength(1);
    },
  );
});
