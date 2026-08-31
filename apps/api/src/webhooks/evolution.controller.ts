import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getEncryptionKey } from '@lia/integrations';
import { PrismaService } from '../prisma.service';
import { Public } from '../auth/public.decorator';

type NormalizedParticipantEvent = {
  tenantId: string;
  instanceName: string;
  groupJid: string;
  eventId: string;
  action: 'JOIN' | 'LEAVE' | 'REMOVE';
  participantHash: string;
  occurredAt: Date;
};

function hashParticipant(value: string) {
  return createHmac('sha256', getEncryptionKey()).update(value).digest('hex');
}

type NormalizedAction = NormalizedParticipantEvent['action'] | 'IGNORED';

function normalizeAction(value: unknown): NormalizedAction | null {
  const action = String(value || '')
    .trim()
    .toLowerCase();
  if (['add', 'added', 'join', 'joined'].includes(action)) return 'JOIN';
  if (['leave', 'left'].includes(action)) return 'LEAVE';
  if (
    ['remove', 'removed', 'delete', 'deleted', 'kick', 'kicked'].includes(
      action,
    )
  )
    return 'REMOVE';
  if (['promote', 'demote'].includes(action)) return 'IGNORED';
  return null;
}

function normalizeParticipant(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!value || typeof value !== 'object') return null;
  const participant = value as Record<string, unknown>;
  const id = participant.id || participant.jid || participant.participant;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function normalizeGroupEvent(
  body: Record<string, any>,
  tenantId: string,
): NormalizedParticipantEvent[] | { ignored: true; reason: string } | null {
  const eventName = String(body.event || body.eventType || body.type || '')
    .trim()
    .toUpperCase()
    .replace(/[.-]/g, '_');
  if (eventName !== 'GROUP_PARTICIPANTS_UPDATE') return null;

  const data = body.data && typeof body.data === 'object' ? body.data : body;
  const instanceName = String(
    body.instance || body.instanceName || data.instance || '',
  ).trim();
  const groupJid = String(data.id || data.groupJid || data.jid || '').trim();
  const participants = Array.isArray(data.participants)
    ? data.participants
    : [data.participant];
  const normalizedParticipants: Array<string | null> =
    participants.map(normalizeParticipant);
  const action = normalizeAction(data.action || data.operation || body.action);
  const dateTime = String(body.date_time || data.date_time || '').trim();
  const parsedDateTime = dateTime ? new Date(dateTime) : null;

  if (
    !instanceName ||
    !groupJid.endsWith('@g.us') ||
    !normalizedParticipants.length ||
    normalizedParticipants.some((participant) => !participant) ||
    !action
  ) {
    return null;
  }

  if (action === 'IGNORED') {
    return { ignored: true, reason: 'IGNORED_PARTICIPANT_ACTION' };
  }

  if (!parsedDateTime || Number.isNaN(parsedDateTime.getTime())) return null;

  const occurredAt = parsedDateTime;
  const explicitEventId = String(
    body.eventId || data.eventId || data.idempotencyKey || '',
  ).trim();

  return normalizedParticipants.map((participant: string | null) => {
    const participantHash = hashParticipant(participant!);
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          instanceName,
          eventName,
          occurredAt.toISOString(),
          groupJid,
          action,
          participantHash,
          explicitEventId || null,
        ]),
      )
      .digest('hex');
    return {
      tenantId,
      instanceName,
      groupJid,
      eventId:
        explicitEventId && normalizedParticipants.length === 1
          ? explicitEventId
          : `evo-group:${fingerprint}`,
      action,
      participantHash,
      occurredAt,
    };
  });
}

function isValidSecret(
  received: string | undefined,
  expected: string | undefined,
) {
  if (!received || !expected) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

@Controller('webhooks/evolution')
export class EvolutionWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('evolution-group-events')
    private readonly eventsQueue: Queue,
  ) {}

  @Public()
  @Post()
  async receive(
    @Headers('x-evolution-webhook-secret') secret: string | undefined,
    @Body() body: Record<string, any>,
  ) {
    if (!isValidSecret(secret, process.env.EVOLUTION_WEBHOOK_SECRET)) {
      throw new UnauthorizedException('Evolution webhook não autorizado.');
    }

    const instanceName = String(
      body.instance || body.instanceName || body.data?.instance || '',
    ).trim();
    if (!instanceName) {
      throw new BadRequestException('Instância Evolution ausente.');
    }

    const integration = await this.prisma.channelIntegration.findFirst({
      where: {
        provider: 'WHATSAPP',
        transport: 'WEB_UNOFFICIAL',
        externalInstanceName: instanceName,
      },
      select: { tenantId: true, externalInstanceName: true },
    });

    if (!integration || integration.externalInstanceName !== instanceName) {
      throw new UnauthorizedException('Instância Evolution desconhecida.');
    }

    const events = normalizeGroupEvent(body, integration.tenantId);
    if (!events) {
      throw new BadRequestException('Evento de grupo Evolution inválido.');
    }

    if ('ignored' in events) {
      return { accepted: false, reason: events.reason };
    }

    for (const event of events) {
      await this.eventsQueue.add('group-participant-update', event, {
        jobId: `evolution-group:${event.eventId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });
    }

    return { accepted: true, queued: true, eventId: events[0].eventId };
  }
}
