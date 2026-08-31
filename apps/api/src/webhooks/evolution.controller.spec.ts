import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { EvolutionWebhookController } from './evolution.controller';

describe('EvolutionWebhookController', () => {
  const previousSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
  const previousEncryptionKey = process.env.INTEGRATION_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.EVOLUTION_WEBHOOK_SECRET = 'webhook-secret';
    process.env.INTEGRATION_ENCRYPTION_KEY = 'a'.repeat(64);
  });

  afterAll(() => {
    if (previousSecret === undefined)
      delete process.env.EVOLUTION_WEBHOOK_SECRET;
    else process.env.EVOLUTION_WEBHOOK_SECRET = previousSecret;
    if (previousEncryptionKey === undefined)
      delete process.env.INTEGRATION_ENCRYPTION_KEY;
    else process.env.INTEGRATION_ENCRYPTION_KEY = previousEncryptionKey;
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
    date_time: '2026-08-31T12:00:00.000Z',
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
    expect(eventsQueue.add.mock.calls[0][1].eventId).not.toContain(':0');
    expect(eventsQueue.add.mock.calls[1][1].eventId).not.toContain(':1');
  });

  it('accepts the real Evolution payload without an eventId', async () => {
    const { controller, eventsQueue } = createController();
    const body = {
      event: 'group-participants.update',
      instance: 'lia-instance',
      data: {
        id: '120363409141589024@g.us',
        participants: ['participant@s.whatsapp.net'],
        action: 'add',
        participantsData: [
          {
            phoneNumber: '5511999999999',
            name: 'must-not-be-forwarded',
            imgUrl: 'https://private.invalid/avatar',
          },
        ],
      },
      date_time: '2026-08-31T12:00:00.000Z',
      sender: 'ignored@s.whatsapp.net',
      apikey: 'must-not-be-forwarded',
    };

    await expect(controller.receive('webhook-secret', body)).resolves.toEqual(
      expect.objectContaining({ accepted: true, queued: true }),
    );
    expect(eventsQueue.add.mock.calls[0][1]).toMatchObject({
      action: 'JOIN',
      occurredAt: new Date('2026-08-31T12:00:00.000Z'),
    });
    expect(eventsQueue.add.mock.calls[0][1].eventId).toMatch(
      /^evo-group:[a-f0-9]{64}$/,
    );
    expect(eventsQueue.add.mock.calls[0][1]).not.toHaveProperty('apikey');
    expect(eventsQueue.add.mock.calls[0][1]).not.toHaveProperty('sender');
    expect(eventsQueue.add.mock.calls[0][1]).not.toHaveProperty(
      'participantsData',
    );
    expect(JSON.stringify(eventsQueue.add.mock.calls[0][1])).not.toContain(
      '5511999999999',
    );
  });

  it('derives the same event and job ids for an identical real payload retry', async () => {
    const { controller, eventsQueue } = createController();
    const body = {
      event: 'group-participants.update',
      instance: 'lia-instance',
      data: {
        id: '120363409141589024@g.us',
        participants: ['participant@s.whatsapp.net'],
        action: 'add',
      },
      date_time: '2026-08-31T12:00:00.000Z',
    };

    await controller.receive('webhook-secret', body);
    await controller.receive('webhook-secret', body);
    expect(eventsQueue.add.mock.calls[0][1].eventId).toBe(
      eventsQueue.add.mock.calls[1][1].eventId,
    );
    expect(eventsQueue.add.mock.calls[0][2].jobId).toBe(
      eventsQueue.add.mock.calls[1][2].jobId,
    );
  });

  it('maps remove to REMOVE and ignores promote/demote with 2xx semantics', async () => {
    const { controller, eventsQueue } = createController();
    const base = {
      event: 'group-participants.update',
      instance: 'lia-instance',
      data: {
        id: '120363409141589024@g.us',
        participants: ['participant@s.whatsapp.net'],
      },
      date_time: '2026-08-31T12:00:00.000Z',
    };

    await controller.receive('webhook-secret', {
      ...base,
      data: { ...base.data, action: 'remove' },
    });
    expect(eventsQueue.add.mock.calls[0][1]).toMatchObject({
      action: 'REMOVE',
    });

    await expect(
      controller.receive('webhook-secret', {
        ...base,
        data: { ...base.data, action: 'promote' },
      }),
    ).resolves.toEqual({
      accepted: false,
      reason: 'IGNORED_PARTICIPANT_ACTION',
    });
    await expect(
      controller.receive('webhook-secret', {
        ...base,
        data: { ...base.data, action: 'demote' },
      }),
    ).resolves.toEqual({
      accepted: false,
      reason: 'IGNORED_PARTICIPANT_ACTION',
    });
    expect(eventsQueue.add).toHaveBeenCalledTimes(1);
  });

  it('rejects a participant event without the Evolution envelope timestamp', async () => {
    const { controller } = createController();
    await expect(
      controller.receive('webhook-secret', {
        ...validBody,
        date_time: undefined,
        data: { ...validBody.data, eventId: undefined },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
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
