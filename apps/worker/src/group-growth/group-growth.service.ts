import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import {
  decryptSecret,
  getEncryptionKey,
  WhatsAppEvolutionProvider,
} from '@lia/integrations';

type ParticipantUpdate = {
  tenantId: string;
  groupJid: string;
  eventId: string;
  action: 'JOIN' | 'LEAVE' | 'REMOVE';
  participant?: string;
  participantHash?: string;
  occurredAt?: Date | string;
};

const CAPACITY = 1024;
const PREPARE_THRESHOLD = 900;

function participantHash(value: string) {
  return createHmac('sha256', getEncryptionKey()).update(value).digest('hex');
}

export function capacityStatus(memberCount: number) {
  if (memberCount >= CAPACITY) return 'FULL' as const;
  if (memberCount >= PREPARE_THRESHOLD) return 'NEAR_CAPACITY' as const;
  return 'ACTIVE' as const;
}

@Injectable()
export class GroupGrowthService {
  private readonly logger = new Logger(GroupGrowthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ingestParticipantUpdate(update: ParticipantUpdate) {
    try {
      return await this.prisma.$transaction(async (tx: any) => {
        const group = await tx.liaWhatsAppGroup.findFirst({
          where: {
            tenantId: update.tenantId,
            externalGroupJid: update.groupJid,
          },
        });
        if (!group) return { accepted: false, reason: 'UNREGISTERED_GROUP' };
        if (group.name.trim().toLowerCase() === 'teste') {
          return { accepted: false, reason: 'TEST_GROUP_EXCLUDED' };
        }

        const existingEvent = await tx.liaWhatsAppGroupEvent.findUnique({
          where: { eventId: update.eventId },
        });
        if (existingEvent) {
          return { accepted: false, reason: 'DUPLICATE_EVENT' };
        }

        const occurredAt = update.occurredAt
          ? new Date(update.occurredAt)
          : new Date();
        if (Number.isNaN(occurredAt.getTime())) {
          return { accepted: false, reason: 'INVALID_OCCURRED_AT' };
        }
        const hash =
          update.participantHash ||
          (update.participant ? participantHash(update.participant) : null);
        if (!hash) return { accepted: false, reason: 'INVALID_PARTICIPANT' };
        await tx.liaWhatsAppGroupEvent.create({
          data: {
            tenantId: update.tenantId,
            groupId: group.id,
            eventId: update.eventId,
            type: update.action,
            participantHash: hash,
            occurredAt,
          },
        });

        const member = await tx.liaWhatsAppGroupMember.findUnique({
          where: {
            groupId_participantHash: {
              groupId: group.id,
              participantHash: hash,
            },
          },
        });
        const isJoin = update.action === 'JOIN';
        const wasActive = member?.isActive === true;
        const delta = isJoin
          ? wasActive
            ? 0
            : 1
          : member
            ? wasActive
              ? -1
              : 0
            : -1;
        const nextCount = Math.max(0, Number(group.memberCount || 0) + delta);

        await tx.liaWhatsAppGroupMember.upsert({
          where: {
            groupId_participantHash: {
              groupId: group.id,
              participantHash: hash,
            },
          },
          create: {
            tenantId: update.tenantId,
            groupId: group.id,
            participantHash: hash,
            isActive: isJoin,
            joinedAt: isJoin ? occurredAt : undefined,
            leftAt: isJoin ? undefined : occurredAt,
          },
          update: {
            isActive: isJoin,
            joinedAt: isJoin ? occurredAt : undefined,
            leftAt: isJoin ? null : occurredAt,
          },
        });

        await tx.liaWhatsAppGroup.update({
          where: { id: group.id },
          data: {
            memberCount: nextCount,
            externalMemberCount:
              group.externalMemberCount === null
                ? undefined
                : Math.max(0, Number(group.externalMemberCount) + delta),
            status: capacityStatus(nextCount),
            lastReconciledAt: occurredAt,
          },
        });

        return {
          accepted: true,
          eventId: update.eventId,
          memberCount: nextCount,
        };
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        return { accepted: false, reason: 'DUPLICATE_EVENT' };
      }
      throw error;
    }
  }

  @Cron('*/15 * * * *')
  async reconcileRegisteredGroups() {
    const groups = await this.prisma.liaWhatsAppGroup.findMany({
      where: {
        NOT: { name: 'Teste' },
        status: { not: 'INACTIVE' },
      },
      select: {
        id: true,
        tenantId: true,
        externalGroupJid: true,
      },
    });
    if (!groups.length) return;

    const provider = new WhatsAppEvolutionProvider();
    const key = getEncryptionKey();
    const integrations = await this.prisma.channelIntegration.findMany({
      where: {
        provider: 'WHATSAPP',
        transport: 'WEB_UNOFFICIAL',
        externalInstanceName: { not: null },
        encryptedAccessToken: { not: null },
        tokenIv: { not: null },
        tokenAuthTag: { not: null },
      },
      select: {
        tenantId: true,
        externalInstanceName: true,
        encryptedAccessToken: true,
        tokenIv: true,
        tokenAuthTag: true,
      },
    });
    const integrationsByTenant = new Map(
      integrations.map((integration) => [integration.tenantId, integration]),
    );

    for (const group of groups) {
      const integration = integrationsByTenant.get(group.tenantId);
      if (!integration || !integration.externalInstanceName) continue;

      try {
        const token = decryptSecret(
          integration.encryptedAccessToken!,
          integration.tokenIv!,
          integration.tokenAuthTag!,
          key,
        );
        const state = await provider.getConnectionState(
          integration.externalInstanceName,
          token,
        );
        if (state !== 'open') continue;

        const remoteGroups = await provider.fetchGroups(
          integration.externalInstanceName,
          token,
        );
        const remoteGroup = remoteGroups.find(
          (candidate) => candidate.id === group.externalGroupJid,
        );
        if (!remoteGroup) continue;

        await this.prisma.liaWhatsAppGroup.update({
          where: { id: group.id },
          data: {
            externalMemberCount: remoteGroup.participants,
            memberCount: remoteGroup.participants,
            status: capacityStatus(remoteGroup.participants),
            lastReconciledAt: new Date(),
          },
        });
      } catch (error: any) {
        this.logger.warn(
          `Group reconciliation unavailable for registered group ${group.id}: ${error.message}`,
        );
      }
    }
  }
}
