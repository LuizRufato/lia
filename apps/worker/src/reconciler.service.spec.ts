import { ReconcilerService } from './reconciler.service';

describe('ReconcilerService', () => {
  const observation = {
    id: 'observation-1',
    correlationId: 'correlation-1',
    schemaVersion: 'v1',
    offer: { tenantId: 'tenant-1' },
  };

  let prisma: any;
  let queue: any;
  let service: ReconcilerService;

  beforeEach(() => {
    prisma = {
      offerObservation: {
        findUnique: jest.fn().mockResolvedValue({ evaluations: [] }),
      },
    };
    queue = {
      getJob: jest.fn(),
      add: jest.fn().mockResolvedValue(undefined),
    };
    service = new ReconcilerService(prisma, queue);
  });

  it('reenqueues an absent job', async () => {
    queue.getJob.mockResolvedValue(null);

    await expect(service.reconcileObservation(observation)).resolves.toBe(
      'absent',
    );
    expect(queue.add).toHaveBeenCalledWith(
      'evaluate-offer',
      expect.objectContaining({ observationId: observation.id }),
      expect.objectContaining({ jobId: observation.correlationId }),
    );
  });

  it('retries a failed job without creating a duplicate', async () => {
    const job = {
      id: observation.correlationId,
      attemptsMade: 1,
      getState: jest.fn().mockResolvedValue('failed'),
      retry: jest.fn().mockResolvedValue(undefined),
    };
    queue.getJob.mockResolvedValue(job);

    await expect(service.reconcileObservation(observation)).resolves.toBe(
      'failed',
    );
    expect(job.retry).toHaveBeenCalledWith('failed');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('retries a completed job when its observation has no evaluation', async () => {
    const job = {
      id: observation.correlationId,
      attemptsMade: 0,
      getState: jest.fn().mockResolvedValue('completed'),
      retry: jest.fn().mockResolvedValue(undefined),
    };
    queue.getJob.mockResolvedValue(job);

    await expect(service.reconcileObservation(observation)).resolves.toBe(
      'inconsistent',
    );
    expect(job.retry).toHaveBeenCalledWith('completed');
  });

  it('leaves an active job alone to avoid racing the worker', async () => {
    const job = {
      attemptsMade: 0,
      getState: jest.fn().mockResolvedValue('active'),
      retry: jest.fn(),
    };
    queue.getJob.mockResolvedValue(job);

    await expect(service.reconcileObservation(observation)).resolves.toBe(
      'active',
    );
    expect(job.retry).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('does not touch the queue when the observation was already processed', async () => {
    prisma.offerObservation.findUnique.mockResolvedValue({
      evaluations: [{ id: 'evaluation-1' }],
    });

    await expect(service.reconcileObservation(observation)).resolves.toBe(
      'completed',
    );
    expect(queue.getJob).not.toHaveBeenCalled();
  });
});
