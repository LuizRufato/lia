import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma.service';

type ParticipantUpdate = {
  tenantId: string;
  groupJid: string;
  eventId: string;
  action: 'JOIN' | 'LEAVE' | 'REMOVE';
  participant: string;
  occurredAt?: Date;
};

function participantHash(value: string) {
  const secret =
    process.env.INTEGRATION_ENCRYPTION_KEY || 'lia-group-analytics';
  return createHmac('sha256', secret).update(value).digest('hex');
}

@Injectable()
export class GroupGrowthService {
  private readonly logger = new Logger(GroupGrowthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ingestParticipantUpdate(update: ParticipantUpdate) {
    const group = await this.prisma.liaWhatsAppGroup.findFirst({
      where: { tenantId: update.tenantId, externalGroupJid: update.groupJid },
    });
    if (!group) return { accepted: false, reason: 'UNREGISTERED_GROUP' };
    if (group.name.trim().toLowerCase() === 'teste') {
      return { accepted: false, reason: 'TEST_GROUP_EXCLUDED' };
    }

    const occurredAt = update.occurredAt || new Date();
    const hash = participantHash(update.participant);
    const event = await this.prisma.liaWhatsAppGroupEvent.upsert({
      where: { eventId: update.eventId },
      create: {
        tenantId: update.tenantId,
        groupId: group.id,
        eventId: update.eventId,
        type: update.action,
        participantHash: hash,
        occurredAt,
      },
      update: {},
    });

    await this.prisma.liaWhatsAppGroupMember.upsert({
      where: {
        groupId_participantHash: { groupId: group.id, participantHash: hash },
      },
      create: {
        tenantId: update.tenantId,
        groupId: group.id,
        participantHash: hash,
        isActive: update.action === 'JOIN',
        joinedAt: update.action === 'JOIN' ? occurredAt : undefined,
        leftAt: update.action === 'JOIN' ? undefined : occurredAt,
      },
      update: {
        isActive: update.action === 'JOIN',
        joinedAt: update.action === 'JOIN' ? occurredAt : undefined,
        leftAt: update.action === 'JOIN' ? null : occurredAt,
      },
    });
    await this.refreshGroup(group.id, update.tenantId);
    return { accepted: true, eventId: event.eventId };
  }

  @Cron('*/15 * * * *')
  async reconcileRegisteredGroups() {
    const groups = await this.prisma.liaWhatsAppGroup.findMany({
      where: {
        isPublicationActive: true,
        status: { not: 'INACTIVE' },
        NOT: { name: 'Teste' },
      },
      select: { id: true, tenantId: true, externalMemberCount: true },
    });
    for (const group of groups) {
      // The Evolution adapter/webhook remains the source of external counts.
      // Never invent a count when no reconciliation payload is available.
      if (group.externalMemberCount === null) continue;
      await this.prisma.liaWhatsAppGroup.update({
        where: { id: group.id },
        data: {
          memberCount: Math.max(0, group.externalMemberCount),
          lastReconciledAt: new Date(),
        },
      });
      await this.refreshGroup(group.id, group.tenantId);
    }
  }

  private async refreshGroup(groupId: string, tenantId: string) {
    const [group, activeMembers, config] = await Promise.all([
      this.prisma.liaWhatsAppGroup.findFirst({
        where: { id: groupId, tenantId },
      }),
      this.prisma.liaWhatsAppGroupMember.count({
        where: { groupId, tenantId, isActive: true },
      }),
      this.prisma.metaAcquisitionConfig.findUnique({ where: { tenantId } }),
    ]);
    if (!group) return;
    const prepareThreshold = config?.groupPrepareThreshold ?? 900;
    const routingThreshold = config?.groupRoutingThreshold ?? 1000;
    const status =
      activeMembers >= group.capacity
        ? 'FULL'
        : activeMembers >= routingThreshold
          ? 'NEAR_CAPACITY'
          : group.status === 'PREPARING'
            ? 'PREPARING'
            : 'ACTIVE';
    await this.prisma.liaWhatsAppGroup.update({
      where: { id: groupId },
      data: {
        memberCount: activeMembers,
        status,
        isRoutingActive: activeMembers < routingThreshold,
        lastReconciledAt: new Date(),
      },
    });
    if (activeMembers >= prepareThreshold) {
      this.logger.debug(
        `Group ${groupId} reached the shadow preparation threshold.`,
      );
    }
  }
}
