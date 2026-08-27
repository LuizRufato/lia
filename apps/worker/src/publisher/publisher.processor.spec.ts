import { PublisherProcessor } from './publisher.processor';

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
});
