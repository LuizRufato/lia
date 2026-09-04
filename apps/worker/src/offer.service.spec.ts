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

const strongCanonical = (price: number, observedAt: string) => ({
  ...canonical(price, observedAt),
  pricing: {
    currentPriceCents: price,
    originalPriceCents: 1200,
    discountBps: 2500,
  },
  commission: {
    estimatedAmountCents: 1000,
    rateBps: 1500,
    source: 'CALCULATED',
  },
  metrics: {
    rating: 4.8,
    reviewsCount: 500,
    marketplaceSalesCount: 500,
  },
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
          $executeRaw: jest.fn().mockResolvedValue(1),
          publication: {
            count: jest.fn().mockResolvedValue(0),
            findMany: jest.fn().mockResolvedValue([]),
          },
          autopilotCatalogPolicy: {
            findFirst: jest.fn().mockResolvedValue({
              productCooldownHours: 120,
            }),
          },
          autopilotConfig: {
            findUnique: jest.fn().mockResolvedValue({ minScore: 40 }),
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
            findMany: jest.fn(async () =>
              evaluations
                .filter(
                  (evaluation) => evaluation.decision !== 'REJECTED_DUPLICATE',
                )
                .map((evaluation) => {
                  const observedAt = observations.find(
                    (item) => item.id === evaluation.observationId,
                  )?.observedAt;
                  return {
                    evaluatedAt: observedAt,
                    observation: { observedAt },
                  };
                }),
            ),
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
            findMany: jest.fn(async ({ where }: any) =>
              candidates.filter((item) =>
                where.status?.in
                  ? where.status.in.includes(item.status)
                  : where.status?.notIn
                    ? !where.status.notIn.includes(item.status)
                    : true,
              ),
            ),
            upsert: jest.fn(async ({ create }: any) => {
              const existing = candidates.find(
                (item) => item.evaluationId === create.evaluationId,
              );
              if (existing) return existing;
              const candidate = {
                id: `candidate-${candidates.length + 1}`,
                evaluation: { score: 55 },
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
          $executeRaw: jest.fn().mockResolvedValue(1),
          publication: {
            count: jest.fn().mockResolvedValue(0),
            findMany: jest.fn().mockResolvedValue([]),
          },
          autopilotConfig: {
            findUnique: jest.fn().mockResolvedValue({ minScore: 50 }),
          },
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

const makeLifecycleHarness = (
  policyHours: number | null = 120,
  minScore = 50,
) => {
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
        $executeRaw: jest.fn().mockResolvedValue(1),
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
        autopilotConfig: {
          findUnique: jest.fn().mockResolvedValue({ minScore }),
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
          findMany: jest.fn(async () =>
            evaluations
              .filter(
                (evaluation) => evaluation.decision !== 'REJECTED_DUPLICATE',
              )
              .map((evaluation) => {
                const observedAt = observations.find(
                  (item) => item.id === evaluation.observationId,
                )?.observedAt;
                return {
                  evaluatedAt: observedAt,
                  observation: { observedAt },
                };
              }),
          ),
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
          findMany: jest.fn(async ({ where }: any) =>
            candidates.filter((item) =>
              where.status?.in
                ? where.status.in.includes(item.status)
                : where.status?.notIn
                  ? !where.status.notIn.includes(item.status)
                  : true,
            ),
          ),
          update: jest.fn(async ({ where, data }: any) => {
            const candidate = candidates.find((item) => item.id === where.id);
            if (candidate) Object.assign(candidate, data);
            return candidate;
          }),
          upsert: jest.fn(async ({ create }: any) => {
            const existing = candidates.find(
              (item) => item.evaluationId === create.evaluationId,
            );
            if (existing) return existing;
            const evaluation = evaluations.find(
              (item) => item.id === create.evaluationId,
            );
            const candidate = {
              id: `candidate-${candidates.length + 1}`,
              createdAt: now,
              updatedAt: now,
              evaluation: { score: evaluation?.score ?? 80 },
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
    payload = strongCanonical(1000, observedAt.toISOString()),
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

const makeConcurrentHarness = () => {
  const observations: any[] = [];
  const histories: any[] = [];
  const evaluations: any[] = [];
  const candidates: any[] = [];
  const lockTails = new Map<string, Promise<void>>();
  let activeTransactions = 0;
  let maxActiveTransactions = 0;
  const lockCalls: string[] = [];

  const acquireLock = async (offerId: string) => {
    const previous = lockTails.get(offerId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    lockTails.set(offerId, current);
    await previous;
    return () => {
      release();
      if (lockTails.get(offerId) === current) lockTails.delete(offerId);
    };
  };

  const prisma: any = {
    offerObservation: {
      findUnique: jest.fn(({ where }: any) => {
        const observation = observations.find((item) => item.id === where.id);
        return observation
          ? {
              ...observation,
              offer: {
                id: observation.offerId,
                tenantId: 'tenant-1',
              },
            }
          : null;
      }),
    },
    $transaction: async (callback: (tx: any) => Promise<unknown>) => {
      let release = () => undefined;
      const tx = {
        $executeRaw: async (_query: unknown, offerId: string) => {
          lockCalls.push(offerId);
          release = await acquireLock(offerId);
          activeTransactions += 1;
          maxActiveTransactions = Math.max(
            maxActiveTransactions,
            activeTransactions,
          );
        },
        priceHistory: {
          findMany: jest.fn(async ({ where }: any) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return histories.filter((item) => item.offerId === where.offerId);
          }),
          upsert: jest.fn(async ({ create }: any) => {
            histories.push(create);
            return create;
          }),
        },
        publication: {
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
        },
        autopilotConfig: {
          findUnique: jest.fn().mockResolvedValue({ minScore: 50 }),
        },
        autopilotCatalogPolicy: {
          findFirst: jest.fn().mockResolvedValue({
            productCooldownHours: 120,
          }),
        },
        offerEvaluation: {
          upsert: jest.fn(async ({ create }: any) => {
            const evaluation = {
              id: `evaluation-${evaluations.length + 1}`,
              observationOfferId: observations.find(
                (item) => item.id === create.observationId,
              )?.offerId,
              ...create,
            };
            evaluations.push(evaluation);
            return evaluation;
          }),
          findMany: jest.fn(async () =>
            evaluations
              .filter(
                (evaluation) => evaluation.decision !== 'REJECTED_DUPLICATE',
              )
              .map((evaluation) => {
                const observedAt = observations.find(
                  (item) => item.id === evaluation.observationId,
                )?.observedAt;
                return {
                  evaluatedAt: observedAt,
                  observation: { observedAt },
                };
              }),
          ),
        },
        publicationCandidate: {
          findMany: jest.fn(async ({ where }: any) =>
            candidates
              .filter(
                (item) => item.offerId === where.evaluation.observation.offerId,
              )
              .filter((item) =>
                where.status.in
                  ? where.status.in.includes(item.status)
                  : !where.status.notIn.includes(item.status),
              )
              .map((item) => ({
                id: item.id,
                status: item.status,
                evaluation: { score: item.score },
              })),
          ),
          update: jest.fn(async ({ where, data }: any) => {
            const candidate = candidates.find((item) => item.id === where.id);
            if (candidate) Object.assign(candidate, data);
            return candidate;
          }),
          upsert: jest.fn(async ({ create }: any) => {
            const evaluation = evaluations.find(
              (item) => item.id === create.evaluationId,
            );
            const candidate = {
              id: `candidate-${candidates.length + 1}`,
              offerId: evaluation?.observationOfferId,
              score: evaluation?.score ?? 80,
              ...create,
            };
            candidate.offerId = evaluation?.observationOfferId;
            candidates.push(candidate);
            return candidate;
          }),
        },
        offer: { update: jest.fn().mockResolvedValue({}) },
      };

      try {
        return await callback(tx);
      } finally {
        activeTransactions -= 1;
        release();
      }
    },
  };

  const service = new OfferService(prisma);
  const addObservation = (id: string, offerId: string, observedAt: string) => {
    observations.push({
      id,
      offerId,
      observedAt: new Date(observedAt),
      canonicalPayload: strongCanonical(1000, observedAt),
    });
  };

  return {
    addObservation,
    candidates,
    lockCalls,
    maxActiveTransactions: () => maxActiveTransactions,
    process: (id: string) => service.processObservation(id),
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

  it('keeps the reconsideration anchor stable across 15-minute duplicate polling', async () => {
    const harness = makeLifecycleHarness(null);
    const start = new Date('2026-08-01T10:00:00Z');

    await harness.addObservation('obs-initial', start);
    harness.candidates[0].status = 'FAILED';

    for (let index = 1; index < 96; index += 1) {
      const observedAt = new Date(start.getTime() + index * 15 * 60 * 1000);
      await harness.addObservation(
        `obs-duplicate-${index}`,
        observedAt,
        canonical(1000, observedAt.toISOString()),
      );
    }

    expect(harness.candidates).toHaveLength(1);
    expect(
      harness.evaluations
        .slice(1)
        .every((evaluation) => evaluation.decision === 'REJECTED_DUPLICATE'),
    ).toBe(true);

    const boundary = new Date(start.getTime() + 96 * 15 * 60 * 1000);
    await harness.addObservation(
      'obs-at-reconsideration-boundary',
      boundary,
      strongCanonical(1000, boundary.toISOString()),
    );

    expect(harness.evaluations.at(-1).decision).toBe('ELIGIBLE');
    expect(harness.candidates).toHaveLength(2);
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
    const harness = makeLifecycleHarness(null, 50);
    const belowMinScore = canonical(1000, '2026-08-01T10:00:00Z');

    await harness.addObservation(
      'obs-1',
      new Date('2026-08-01T10:00:00Z'),
      belowMinScore,
    );
    await harness.addObservation('obs-2', new Date('2026-08-02T11:00:00Z'));

    expect(harness.evaluations[0].score).toBeLessThan(50);
    expect(harness.evaluations[0].decision).toBe('ELIGIBLE');
    expect(harness.candidates).toHaveLength(1);
    expect(harness.evaluations[1].score).toBeGreaterThanOrEqual(50);
    expect(harness.evaluations[1].decision).toBe('ELIGIBLE');
  });

  it('is not blocked by a later significant price drop after a below-minScore observation', async () => {
    const harness = makeLifecycleHarness(null, 50);

    await harness.addObservation(
      'obs-1',
      new Date('2026-08-01T10:00:00Z'),
      canonical(1000, '2026-08-01T10:00:00Z'),
    );
    await harness.addObservation(
      'obs-2',
      new Date('2026-08-01T10:05:00Z'),
      strongCanonical(900, '2026-08-01T10:05:00Z'),
    );

    expect(harness.evaluations[0].score).toBeLessThan(50);
    expect(harness.evaluations[1].score).toBeGreaterThanOrEqual(50);
    expect(harness.evaluations[1].decision).toBe('ELIGIBLE');
    expect(harness.candidates).toHaveLength(1);
  });

  it.each(['PENDING', 'DEFERRED'])(
    'supersedes a legacy below-minScore %s candidate before creating a qualifying one',
    async (status) => {
      const harness = makeLifecycleHarness(null, 50);

      await harness.addObservation(
        'obs-legacy-anchor',
        new Date('2026-08-01T10:00:00Z'),
        canonical(1000, '2026-08-01T10:00:00Z'),
      );
      harness.candidates.push({
        id: `legacy-${status.toLowerCase()}`,
        status,
        evaluation: { score: 43 },
        createdAt: new Date('2026-08-01T10:00:00Z'),
        updatedAt: new Date('2026-08-01T10:00:00Z'),
      });

      await harness.addObservation(
        'obs-qualifying',
        new Date('2026-08-02T10:00:00Z'),
        strongCanonical(1000, '2026-08-02T10:00:00Z'),
      );

      const liveCandidates = harness.candidates.filter((candidate) =>
        ['PENDING', 'DEFERRED', 'QUEUED', 'PUBLISHING'].includes(
          candidate.status,
        ),
      );
      expect(harness.candidates).toHaveLength(2);
      expect(liveCandidates).toHaveLength(1);
      expect(harness.candidates[0]).toMatchObject({
        status: 'SKIPPED',
        deferredReason: 'SUPERSEDED_BELOW_CURRENT_MIN_SCORE',
      });
      expect(harness.evaluations.at(-1).decision).toBe('ELIGIBLE');
    },
  );

  it.each(['QUEUED', 'PUBLISHING'])(
    'does not supersede or replace a legacy below-minScore %s candidate',
    async (status) => {
      const harness = makeLifecycleHarness(null, 50);

      await harness.addObservation(
        'obs-protected-anchor',
        new Date('2026-08-01T10:00:00Z'),
        canonical(1000, '2026-08-01T10:00:00Z'),
      );
      harness.candidates.push({
        id: `legacy-${status.toLowerCase()}`,
        status,
        evaluation: { score: 43 },
        createdAt: new Date('2026-08-01T10:00:00Z'),
        updatedAt: new Date('2026-08-01T10:00:00Z'),
      });

      await harness.addObservation(
        'obs-blocked-qualifying',
        new Date('2026-08-02T10:00:00Z'),
        strongCanonical(1000, '2026-08-02T10:00:00Z'),
      );

      expect(harness.candidates).toHaveLength(1);
      expect(harness.candidates[0]).toMatchObject({
        status,
        evaluation: { score: 43 },
      });
      expect(harness.evaluations.at(-1).decision).toBe('ELIGIBLE');
    },
  );

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

  it('serializes true concurrent processing for the same canonical Offer', async () => {
    const harness = makeConcurrentHarness();
    harness.addObservation('obs-a', 'offer-a', '2026-08-01T10:00:00Z');
    harness.addObservation('obs-b', 'offer-a', '2026-08-01T10:05:00Z');

    await Promise.all([harness.process('obs-a'), harness.process('obs-b')]);

    expect(harness.candidates).toHaveLength(1);
    expect(harness.maxActiveTransactions()).toBe(1);
    expect(harness.lockCalls).toEqual(['offer-a', 'offer-a']);
  });

  it('does not globally serialize concurrent processing for different Offers', async () => {
    const harness = makeConcurrentHarness();
    harness.addObservation('obs-a', 'offer-a', '2026-08-01T10:00:00Z');
    harness.addObservation('obs-b', 'offer-b', '2026-08-01T10:00:00Z');

    await Promise.all([harness.process('obs-a'), harness.process('obs-b')]);

    expect(harness.maxActiveTransactions()).toBe(2);
    expect(new Set(harness.lockCalls)).toEqual(new Set(['offer-a', 'offer-b']));
  });
});
