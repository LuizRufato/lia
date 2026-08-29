const mockGetConnectionState = jest.fn();
const mockFetchGroups = jest.fn();

jest.mock('@lia/integrations', () => ({
  decryptSecret: jest.fn(() => 'instance-token'),
  getEncryptionKey: jest.fn(() => 'encryption-key'),
  WhatsAppEvolutionProvider: jest.fn().mockImplementation(() => ({
    getConnectionState: mockGetConnectionState,
    fetchGroups: mockFetchGroups,
  })),
}));

import { capacityStatus, GroupGrowthService } from './group-growth.service';

function createTransactionalPrisma(
  group: any,
  member: any = null,
  event: any = null,
) {
  const tx = {
    liaWhatsAppGroup: {
      findFirst: jest.fn().mockResolvedValue(group),
      update: jest.fn().mockResolvedValue(undefined),
    },
    liaWhatsAppGroupEvent: {
      findUnique: jest.fn().mockResolvedValue(event),
      create: jest.fn().mockResolvedValue(undefined),
    },
    liaWhatsAppGroupMember: {
      findUnique: jest.fn().mockResolvedValue(member),
      upsert: jest.fn().mockResolvedValue(undefined),
    },
  };
  return {
    tx,
    prisma: {
      $transaction: jest.fn(async (callback: (value: any) => unknown) =>
        callback(tx),
      ),
    } as any,
  };
}

describe('GroupGrowthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ignores events for groups outside the official registry', async () => {
    const { prisma } = createTransactionalPrisma(null);
    await expect(
      new GroupGrowthService(prisma).ingestParticipantUpdate({
        tenantId: 'tenant-1',
        groupJid: 'unknown@g.us',
        eventId: 'event-1',
        action: 'JOIN',
        participant: 'participant',
      }),
    ).resolves.toEqual({ accepted: false, reason: 'UNREGISTERED_GROUP' });
  });

  it('uses the imported baseline for a JOIN and ignores the duplicate event', async () => {
    const group = {
      id: 'group-1',
      name: 'LIA Achou 1',
      memberCount: 300,
      externalMemberCount: 300,
      isRoutingActive: false,
    };
    const first = createTransactionalPrisma(group);
    await expect(
      new GroupGrowthService(first.prisma).ingestParticipantUpdate({
        tenantId: 'tenant-1',
        groupJid: 'group@g.us',
        eventId: 'join-1',
        action: 'JOIN',
        participant: 'participant-1',
      }),
    ).resolves.toEqual({ accepted: true, eventId: 'join-1', memberCount: 301 });
    expect(first.tx.liaWhatsAppGroup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          memberCount: 301,
          externalMemberCount: 301,
        }),
      }),
    );
    expect(
      first.tx.liaWhatsAppGroup.update.mock.calls[0][0].data,
    ).not.toHaveProperty('isRoutingActive');

    const duplicate = createTransactionalPrisma(group, null, {
      eventId: 'join-1',
    });
    await expect(
      new GroupGrowthService(duplicate.prisma).ingestParticipantUpdate({
        tenantId: 'tenant-1',
        groupJid: 'group@g.us',
        eventId: 'join-1',
        action: 'JOIN',
        participant: 'participant-1',
      }),
    ).resolves.toEqual({ accepted: false, reason: 'DUPLICATE_EVENT' });
    expect(duplicate.tx.liaWhatsAppGroup.update).not.toHaveBeenCalled();
  });

  it('decrements the imported baseline for a historical unknown LEAVE', async () => {
    const group = {
      id: 'group-1',
      name: 'LIA Achou 1',
      memberCount: 300,
      externalMemberCount: 300,
      isRoutingActive: false,
    };
    const { prisma, tx } = createTransactionalPrisma(group);
    await expect(
      new GroupGrowthService(prisma).ingestParticipantUpdate({
        tenantId: 'tenant-1',
        groupJid: 'group@g.us',
        eventId: 'leave-1',
        action: 'LEAVE',
        participant: 'historical-participant',
      }),
    ).resolves.toEqual({
      accepted: true,
      eventId: 'leave-1',
      memberCount: 299,
    });
    expect(tx.liaWhatsAppGroup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          memberCount: 299,
          externalMemberCount: 299,
        }),
      }),
    );
  });

  it('does not decrement twice for the same LEAVE event', async () => {
    const group = {
      id: 'group-1',
      name: 'LIA Achou 1',
      memberCount: 299,
      externalMemberCount: 299,
      isRoutingActive: false,
    };
    const { prisma, tx } = createTransactionalPrisma(group, null, {
      eventId: 'leave-1',
    });
    await expect(
      new GroupGrowthService(prisma).ingestParticipantUpdate({
        tenantId: 'tenant-1',
        groupJid: 'group@g.us',
        eventId: 'leave-1',
        action: 'LEAVE',
        participant: 'historical-participant',
      }),
    ).resolves.toEqual({ accepted: false, reason: 'DUPLICATE_EVENT' });
    expect(tx.liaWhatsAppGroup.update).not.toHaveBeenCalled();
  });

  it('keeps routing disabled after JOIN, including near capacity', async () => {
    const group = {
      id: 'group-1',
      name: 'LIA Achou 1',
      memberCount: 899,
      externalMemberCount: 899,
      isRoutingActive: false,
    };
    const { prisma, tx } = createTransactionalPrisma(group);
    await new GroupGrowthService(prisma).ingestParticipantUpdate({
      tenantId: 'tenant-1',
      groupJid: 'group@g.us',
      eventId: 'join-near-capacity',
      action: 'JOIN',
      participant: 'participant-near-capacity',
    });
    expect(tx.liaWhatsAppGroup.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ status: 'NEAR_CAPACITY', memberCount: 900 }),
    );
    expect(tx.liaWhatsAppGroup.update.mock.calls[0][0].data).not.toHaveProperty(
      'isRoutingActive',
    );
  });

  it('reconciles a registered group from the live Evolution count without changing routing', async () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = 'a'.repeat(64);
    mockGetConnectionState.mockResolvedValue('open');
    mockFetchGroups.mockResolvedValue([
      { id: 'group@g.us', subject: 'LIA Achou 1', participants: 301 },
    ]);
    const prisma = {
      liaWhatsAppGroup: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'group-1',
            tenantId: 'tenant-1',
            externalGroupJid: 'group@g.us',
          },
        ]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      channelIntegration: {
        findMany: jest.fn().mockResolvedValue([
          {
            tenantId: 'tenant-1',
            externalInstanceName: 'lia-instance',
            encryptedAccessToken: 'encrypted',
            tokenIv: 'iv',
            tokenAuthTag: 'tag',
          },
        ]),
      },
    } as any;

    await new GroupGrowthService(prisma).reconcileRegisteredGroups();
    expect(prisma.liaWhatsAppGroup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalMemberCount: 301,
          memberCount: 301,
          status: 'ACTIVE',
        }),
      }),
    );
    expect(
      prisma.liaWhatsAppGroup.update.mock.calls[0][0].data,
    ).not.toHaveProperty('isRoutingActive');
  });

  it.each([
    [899, 'ACTIVE'],
    [900, 'NEAR_CAPACITY'],
    [1000, 'NEAR_CAPACITY'],
    [1024, 'FULL'],
  ])('uses safe capacity status for %s members', (memberCount, status) => {
    expect(capacityStatus(Number(memberCount))).toBe(status);
  });
});
