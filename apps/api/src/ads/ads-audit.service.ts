import { Injectable } from '@nestjs/common';

@Injectable()
export class AdsAuditService {
  async record(
    db: any,
    input: {
      tenantId: string;
      advertiserId?: string;
      campaignId?: string;
      adminUserId: string;
      action: string;
      entityType: string;
      entityId: string;
      previousState?: unknown;
      newState?: unknown;
      metadata?: unknown;
    },
  ) {
    return db.adAuditEvent.create({
      data: {
        tenantId: input.tenantId,
        advertiserId: input.advertiserId,
        campaignId: input.campaignId,
        adminUserId: input.adminUserId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        previousState: input.previousState,
        newState: input.newState,
        metadata: input.metadata,
      },
    });
  }
}
