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
