import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { EvolutionWebhookController } from './evolution.controller';

describe('EvolutionWebhookController', () => {
  const previousSecret = process.env.EVOLUTION_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.EVOLUTION_WEBHOOK_SECRET = 'webhook-secret';
  });

  afterAll(() => {
    if (previousSecret === undefined)
      delete process.env.EVOLUTION_WEBHOOK_SECRET;
    else process.env.EVOLUTION_WEBHOOK_SECRET = previousSecret;
  });

  function createController() {
    const prisma = {
      channelIntegration: {
        findFirst: jest.fn().mockResolvedValue({
          tenantId: 'tenant-1',
          externalInstanceName: 'lia-instance',
        }),
      },
    } as any;
    const eventsQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    } as any;
    return {
      controller: new EvolutionWebhookController(prisma, eventsQueue),
      prisma,
      eventsQueue,
    };
  }

  const validBody = {
    event: 'group-participants.update',
    instance: 'lia-instance',
    data: {
      id: '120363409141589024@g.us',
      participants: [{ id: 'participant@s.whatsapp.net' }],
      action: 'add',
      eventId: 'event-1',
    },
  };

  it('validates, resolves, and queues a participant hash without returning the participant', async () => {
    const { controller, eventsQueue } = createController();

    await expect(
      controller.receive('webhook-secret', validBody),
    ).resolves.toEqual({ accepted: true, queued: true, eventId: 'event-1' });
    expect(eventsQueue.add).toHaveBeenCalledWith(
      'group-participant-update',
      expect.objectContaining({
        tenantId: 'tenant-1',
        instanceName: 'lia-instance',
        groupJid: '120363409141589024@g.us',
        action: 'JOIN',
        eventId: 'event-1',
      }),
      expect.objectContaining({ jobId: 'evolution-group:event-1' }),
    );
    expect(eventsQueue.add.mock.calls[0][1]).not.toHaveProperty('token');
    expect(eventsQueue.add.mock.calls[0][1]).toHaveProperty('participantHash');
    expect(eventsQueue.add.mock.calls[0][1]).not.toHaveProperty('participant');
  });

  it('queues each participant from a multi-participant event with stable ids', async () => {
    const { controller, eventsQueue } = createController();
    await controller.receive('webhook-secret', {
      ...validBody,
      data: {
        ...validBody.data,
        participants: [
          { id: 'one@s.whatsapp.net' },
          { id: 'two@s.whatsapp.net' },
        ],
      },
    });
    expect(eventsQueue.add).toHaveBeenCalledTimes(2);
    expect(eventsQueue.add.mock.calls[0][1]).not.toHaveProperty('participant');
    expect(eventsQueue.add.mock.calls[1][1]).not.toHaveProperty('participant');
    expect(eventsQueue.add.mock.calls[0][2].jobId).not.toBe(
      eventsQueue.add.mock.calls[1][2].jobId,
    );
  });

  it('uses the same stable job id for a duplicate payload', async () => {
    const { controller, eventsQueue } = createController();
    await controller.receive('webhook-secret', validBody);
    await controller.receive('webhook-secret', validBody);
    expect(eventsQueue.add).toHaveBeenNthCalledWith(
      2,
      'group-participant-update',
      expect.any(Object),
      expect.objectContaining({ jobId: 'evolution-group:event-1' }),
    );
  });

  it('rejects an invalid secret before reading the instance', async () => {
    const { controller, prisma } = createController();
    await expect(controller.receive('wrong', validBody)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.channelIntegration.findFirst).not.toHaveBeenCalled();
  });

  it('rejects malformed or unsupported events', async () => {
    const { controller } = createController();
    await expect(
      controller.receive('webhook-secret', {
        ...validBody,
        event: 'GROUPS_UPDATE',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.receive('webhook-secret', {
        ...validBody,
        data: { ...validBody.data, participants: [] },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown Evolution instance', async () => {
    const { controller, prisma } = createController();
    prisma.channelIntegration.findFirst.mockResolvedValue(null);
    await expect(
      controller.receive('webhook-secret', validBody),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
