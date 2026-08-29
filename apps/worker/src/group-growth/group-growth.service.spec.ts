import { GroupGrowthService } from './group-growth.service';

describe('GroupGrowthService', () => {
  it('ignores events for groups outside the official registry', async () => {
    const prisma = {
      liaWhatsAppGroup: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any;
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
});
