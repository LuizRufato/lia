const getConnectionState = jest.fn();

jest.mock('@lia/integrations', () => ({
  decryptSecret: jest.fn(() => 'instance-token'),
  getEncryptionKey: jest.fn(() => 'encryption-key'),
  WhatsAppEvolutionProvider: jest.fn().mockImplementation(() => ({
    getConnectionState,
  })),
}));

import { EvolutionReconciliationService } from './evolution-reconciliation.service';

describe('EvolutionReconciliationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps a connected integration connected on a transient health-check error', async () => {
    getConnectionState.mockRejectedValueOnce(new Error('request timeout'));
    const prisma = {
      channelIntegration: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'integration-a',
            tenantId: 'tenant-a',
            status: 'CONNECTED',
            externalInstanceName: 'lia',
            encryptedAccessToken: 'encrypted-token',
            tokenIv: 'token-iv',
            tokenAuthTag: 'token-tag',
          },
        ]),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    const events = { createEvolutionOfflineAlert: jest.fn() };
    const service = new EvolutionReconciliationService(
      prisma as any,
      events as any,
    );

    await service.reconcile();

    expect(prisma.channelIntegration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CONNECTED' }),
      }),
    );
    expect(events.createEvolutionOfflineAlert).not.toHaveBeenCalled();
  });

  it('reports a confirmed disconnected state', async () => {
    getConnectionState.mockResolvedValueOnce('close');
    const prisma = {
      channelIntegration: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'integration-a',
            tenantId: 'tenant-a',
            status: 'CONNECTED',
            externalInstanceName: 'lia',
            encryptedAccessToken: 'encrypted-token',
            tokenIv: 'token-iv',
            tokenAuthTag: 'token-tag',
            connectedAt: null,
          },
        ]),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    const events = {
      createEvolutionOfflineAlert: jest.fn().mockResolvedValue(undefined),
    };
    const service = new EvolutionReconciliationService(
      prisma as any,
      events as any,
    );

    await service.reconcile();

    expect(events.createEvolutionOfflineAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        integrationId: 'integration-a',
        state: 'NEEDS_REAUTH',
      }),
    );
  });
});
