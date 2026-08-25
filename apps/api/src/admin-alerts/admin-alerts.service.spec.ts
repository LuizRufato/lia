import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  decryptSecret,
  encryptSecret,
  WhatsAppEvolutionProvider,
} from '@lia/integrations';
import { AdminAlertsService } from './admin-alerts.service';

describe('AdminAlertsService', () => {
  const encryptionKey = 'a'.repeat(64);
  let service: AdminAlertsService;
  let prisma: {
    adminAlertConfig: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
    adminAlertRecipient: {
      count: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    adminAlertDelivery: { count: jest.Mock };
  };

  beforeEach(() => {
    process.env.INTEGRATION_ENCRYPTION_KEY = encryptionKey;
    process.env.EVOLUTION_API_URL = 'http://evolution.test';
    prisma = {
      adminAlertConfig: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
      channelIntegration: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      adminAlertRecipient: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      adminAlertDelivery: { count: jest.fn().mockResolvedValue(0) },
    };
    service = new AdminAlertsService(prisma as any);
    jest
      .spyOn(WhatsAppEvolutionProvider.prototype, 'getConnectionState')
      .mockResolvedValue('open');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns safe defaults when no configuration exists', async () => {
    await expect(service.getConfig('tenant-a', 'OWNER')).resolves.toEqual({
      enabled: false,
      hasRecipient: false,
      recipientMasked: null,
      recipients: [],
      maxRecipients: 5,
      adminWhatsappIntegrationId: null,
      senderIntegrationName: null,
      senderIntegrations: [],
      newShopeeSaleEnabled: true,
      commissionConfirmedEnabled: false,
      saleCancelledEnabled: false,
      highValueSaleEnabled: false,
      criticalErrorEnabled: false,
      dailySummaryEnabled: false,
      enabledAt: null,
    });
    expect(prisma.adminAlertConfig.findUnique).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a' },
    });
  });

  it('stores a normalized recipient encrypted and only returns a mask', async () => {
    prisma.adminAlertConfig.upsert.mockImplementation(async (args: any) => ({
      id: 'config-a',
      ...args.create,
    }));

    const result = await service.updateConfig('tenant-a', 'ADMIN', {
      recipient: '+55 (11) 99999-1234',
    });
    const create = prisma.adminAlertConfig.upsert.mock.calls[0][0].create;

    expect(create.encryptedRecipient).toBeDefined();
    expect(create.encryptedRecipient).not.toContain('5511999991234');
    expect(
      decryptSecret(
        create.encryptedRecipient,
        create.recipientIv,
        create.recipientAuthTag,
        encryptionKey,
      ),
    ).toBe('5511999991234');
    expect(result).toMatchObject({
      hasRecipient: true,
      recipientMasked: '*********1234',
    });
    expect(JSON.stringify(result)).not.toContain('5511999991234');
    expect(JSON.stringify(result)).not.toContain('encryptedRecipient');
  });

  it('updates toggles without replacing the recipient', async () => {
    const encrypted = encryptSecret('5511999991234', encryptionKey);
    const existing = {
      id: 'config-a',
      tenantId: 'tenant-a',
      enabled: false,
      encryptedRecipient: encrypted.encryptedSecret,
      recipientIv: encrypted.iv,
      recipientAuthTag: encrypted.authTag,
      enabledAt: null,
      newShopeeSaleEnabled: true,
      commissionConfirmedEnabled: false,
      saleCancelledEnabled: false,
      highValueSaleEnabled: false,
      criticalErrorEnabled: false,
      dailySummaryEnabled: false,
    };
    prisma.adminAlertConfig.findUnique.mockResolvedValue(existing);
    prisma.adminAlertConfig.upsert.mockResolvedValue({
      ...existing,
      commissionConfirmedEnabled: true,
    });

    await service.updateConfig('tenant-a', 'OWNER', {
      commissionConfirmedEnabled: true,
    });

    const args = prisma.adminAlertConfig.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ tenantId: 'tenant-a' });
    expect(args.update).toMatchObject({
      commissionConfirmedEnabled: true,
      encryptedRecipient: encrypted.encryptedSecret,
      recipientIv: encrypted.iv,
      recipientAuthTag: encrypted.authTag,
    });
  });

  it('supports replacing and explicitly removing the recipient', async () => {
    const encrypted = encryptSecret('5511999991234', encryptionKey);
    const existing = {
      id: 'config-a',
      tenantId: 'tenant-a',
      enabled: false,
      encryptedRecipient: encrypted.encryptedSecret,
      recipientIv: encrypted.iv,
      recipientAuthTag: encrypted.authTag,
      enabledAt: null,
      newShopeeSaleEnabled: true,
      commissionConfirmedEnabled: false,
      saleCancelledEnabled: false,
      highValueSaleEnabled: false,
      criticalErrorEnabled: false,
      dailySummaryEnabled: false,
    };
    prisma.adminAlertConfig.findUnique.mockResolvedValue(existing);
    prisma.adminAlertConfig.upsert.mockImplementation(async (args: any) => ({
      ...existing,
      ...args.update,
    }));

    await service.updateConfig('tenant-a', 'OWNER', {
      recipient: '5511999995678',
    });
    const replacement = prisma.adminAlertConfig.upsert.mock.calls[0][0].update;
    expect(replacement.encryptedRecipient).not.toBe('old-encrypted');

    prisma.adminAlertConfig.findUnique.mockResolvedValue({
      ...existing,
      ...replacement,
    });
    await service.updateConfig('tenant-a', 'OWNER', { removeRecipient: true });
    expect(
      prisma.adminAlertConfig.upsert.mock.calls[1][0].update,
    ).toMatchObject({
      encryptedRecipient: null,
      recipientIv: null,
      recipientAuthTag: null,
    });
  });

  it('does not allow enabling without a valid recipient', async () => {
    await expect(
      service.updateConfig('tenant-a', 'OWNER', { enabled: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.adminAlertConfig.upsert).not.toHaveBeenCalled();
  });

  it('does not allow enabling without a usable sender integration', async () => {
    prisma.adminAlertConfig.upsert.mockImplementation(async (args: any) => ({
      ...args.create,
    }));

    await expect(
      service.updateConfig('tenant-a', 'OWNER', {
        enabled: true,
        recipient: '5511999991234',
        adminWhatsappIntegrationId: 'sender-a',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.adminAlertConfig.upsert).not.toHaveBeenCalled();
  });

  it('rejects a sender integration from another tenant', async () => {
    await expect(
      service.updateConfig('tenant-a', 'ADMIN', {
        adminWhatsappIntegrationId: 'sender-from-tenant-b',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.channelIntegration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'sender-from-tenant-b',
          tenantId: 'tenant-a',
        }),
      }),
    );
  });

  it('sends only the explicit manual test through the private provider', async () => {
    const encrypted = encryptSecret('5511999991234', encryptionKey);
    const encryptedToken = encryptSecret('instance-token', encryptionKey);
    const config = {
      enabled: true,
      encryptedRecipient: encrypted.encryptedSecret,
      recipientIv: encrypted.iv,
      recipientAuthTag: encrypted.authTag,
      adminWhatsappIntegrationId: 'sender-a',
    };
    prisma.adminAlertConfig.findUnique.mockResolvedValue(config);
    prisma.channelIntegration.findFirst.mockResolvedValue({
      id: 'sender-a',
      externalInstanceName: 'lia-tenant-a',
      encryptedAccessToken: encryptedToken.encryptedSecret,
      tokenIv: encryptedToken.iv,
      tokenAuthTag: encryptedToken.authTag,
    });
    const sendPrivateMessage = jest
      .spyOn(WhatsAppEvolutionProvider.prototype, 'sendPrivateMessage')
      .mockResolvedValue('test-message-id');

    await expect(service.sendTestMessage('tenant-a', 'ADMIN')).resolves.toEqual(
      expect.objectContaining({
        success: true,
        status: 'PROVIDER_ACCEPTED',
        sent: 1,
        failed: 0,
        results: [
          {
            recipientId: 'legacy:tenant-a',
            maskedRecipient: '*********1234',
            providerAccepted: true,
            messageId: 'test-message-id',
            error: null,
          },
        ],
      }),
    );
    expect(sendPrivateMessage).toHaveBeenCalledWith(
      'lia-tenant-a',
      expect.any(String),
      '5511999991234',
      expect.stringContaining('Teste de alertas LIA'),
    );
    expect(
      JSON.stringify(prisma.adminAlertConfig.upsert.mock.calls),
    ).not.toContain('5511999991234');
    sendPrivateMessage.mockRestore();
  });

  it('sets enabledAt on activation and refreshes it after reactivation', async () => {
    const encrypted = encryptSecret('5511999991234', encryptionKey);
    const recipient = {
      encryptedRecipient: encrypted.encryptedSecret,
      recipientIv: encrypted.iv,
      recipientAuthTag: encrypted.authTag,
    };
    prisma.adminAlertConfig.findUnique.mockResolvedValue({
      tenantId: 'tenant-a',
      enabled: false,
      enabledAt: null,
      ...recipient,
      adminWhatsappIntegrationId: 'sender-a',
      newShopeeSaleEnabled: true,
      commissionConfirmedEnabled: false,
      saleCancelledEnabled: false,
      highValueSaleEnabled: false,
      criticalErrorEnabled: false,
      dailySummaryEnabled: false,
    });
    prisma.adminAlertConfig.upsert.mockImplementation(async (args: any) => ({
      ...args.update,
    }));
    prisma.channelIntegration.findFirst.mockResolvedValue({
      id: 'sender-a',
      externalInstanceName: 'lia-tenant-a',
      encryptedAccessToken: 'encrypted-token',
      tokenIv: 'token-iv',
      tokenAuthTag: 'token-tag',
    });

    await service.updateConfig('tenant-a', 'ADMIN', { enabled: true });
    const firstEnabledAt =
      prisma.adminAlertConfig.upsert.mock.calls[0][0].update.enabledAt;
    expect(firstEnabledAt).toBeInstanceOf(Date);

    prisma.adminAlertConfig.findUnique.mockResolvedValue({
      ...recipient,
      adminWhatsappIntegrationId: 'sender-a',
      enabled: true,
      enabledAt: firstEnabledAt,
      newShopeeSaleEnabled: true,
      commissionConfirmedEnabled: false,
      saleCancelledEnabled: false,
      highValueSaleEnabled: false,
      criticalErrorEnabled: false,
      dailySummaryEnabled: false,
    });
    await service.updateConfig('tenant-a', 'ADMIN', { enabled: false });
    expect(
      prisma.adminAlertConfig.upsert.mock.calls[1][0].update.enabledAt,
    ).toBe(firstEnabledAt);

    prisma.adminAlertConfig.findUnique.mockResolvedValue({
      ...recipient,
      adminWhatsappIntegrationId: 'sender-a',
      enabled: false,
      enabledAt: firstEnabledAt,
      newShopeeSaleEnabled: true,
      commissionConfirmedEnabled: false,
      saleCancelledEnabled: false,
      highValueSaleEnabled: false,
      criticalErrorEnabled: false,
      dailySummaryEnabled: false,
    });
    await service.updateConfig('tenant-a', 'ADMIN', { enabled: true });
    const secondEnabledAt =
      prisma.adminAlertConfig.upsert.mock.calls[2][0].update.enabledAt;
    expect(secondEnabledAt).toBeInstanceOf(Date);
    expect(secondEnabledAt.getTime()).toBeGreaterThanOrEqual(
      firstEnabledAt.getTime(),
    );
  });

  it('keeps tenant scope from the authenticated request and enforces roles', async () => {
    await expect(
      service.getConfig('tenant-b', 'MEMBER'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await service.getConfig('tenant-a', 'OWNER');
    expect(prisma.adminAlertConfig.findUnique).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a' },
    });
    expect(prisma.adminAlertConfig.findUnique).not.toHaveBeenCalledWith({
      where: { tenantId: 'tenant-b' },
    });
  });

  it('normalizes national Brazilian numbers and supports five independent recipients', async () => {
    const encrypted = encryptSecret('5511999991234', encryptionKey);
    const config = { id: 'config-a', tenantId: 'tenant-a', enabled: false };
    prisma.adminAlertConfig.upsert.mockResolvedValue(config);
    prisma.adminAlertRecipient.findMany.mockResolvedValue([]);
    await service.addRecipient('tenant-a', 'OWNER', '(11) 99999-1234');
    const args = prisma.adminAlertRecipient.create.mock.calls[0][0];
    expect(
      decryptSecret(
        args.data.encryptedRecipient,
        args.data.recipientIv,
        args.data.recipientAuthTag,
        encryptionKey,
      ),
    ).toBe('5511999991234');
    expect(args.data.recipientHash).toBeDefined();
    expect(encrypted.encryptedSecret).not.toBe(args.data.encryptedRecipient);
  });

  it('sends manual tests to every enabled recipient and does not cool down all-failed sends', async () => {
    const encryptedToken = encryptSecret('instance-token', encryptionKey);
    const first = encryptSecret('5511999991234', encryptionKey);
    const second = encryptSecret('5511999995678', encryptionKey);
    prisma.adminAlertConfig.findUnique.mockResolvedValue({
      id: 'config-a',
      enabled: true,
      adminWhatsappIntegrationId: 'sender-a',
    });
    prisma.adminAlertRecipient.findMany.mockResolvedValue([
      {
        id: 'r1',
        encryptedRecipient: first.encryptedSecret,
        recipientIv: first.iv,
        recipientAuthTag: first.authTag,
        enabled: true,
      },
      {
        id: 'r2',
        encryptedRecipient: second.encryptedSecret,
        recipientIv: second.iv,
        recipientAuthTag: second.authTag,
        enabled: true,
      },
    ]);
    prisma.channelIntegration.findFirst.mockResolvedValue({
      id: 'sender-a',
      externalInstanceName: 'lia-tenant-a',
      encryptedAccessToken: encryptedToken.encryptedSecret,
      tokenIv: encryptedToken.iv,
      tokenAuthTag: encryptedToken.authTag,
    });
    const sendPrivateMessage = jest
      .spyOn(WhatsAppEvolutionProvider.prototype, 'sendPrivateMessage')
      .mockRejectedValue(new Error('timeout'));
    const firstResult = await service.sendTestMessage('tenant-a', 'ADMIN');
    expect(firstResult).toMatchObject({
      success: false,
      status: 'FAILED',
      sent: 0,
      failed: 2,
      results: [
        {
          recipientId: 'r1',
          maskedRecipient: '*********1234',
          providerAccepted: false,
          messageId: null,
          error: 'timeout',
        },
        {
          recipientId: 'r2',
          maskedRecipient: '*********5678',
          providerAccepted: false,
          messageId: null,
          error: 'timeout',
        },
      ],
    });
    await expect(
      service.sendTestMessage('tenant-a', 'ADMIN'),
    ).resolves.toMatchObject({
      success: false,
      sent: 0,
      failed: 2,
    });
    expect(sendPrivateMessage).toHaveBeenCalledTimes(4);
    sendPrivateMessage.mockRestore();
  });

  it('exposes sanitized Evolution 4xx and 5xx errors per recipient', async () => {
    const encryptedToken = encryptSecret('instance-token', encryptionKey);
    const first = encryptSecret('5511999991234', encryptionKey);
    const second = encryptSecret('5511999995678', encryptionKey);
    prisma.adminAlertConfig.findUnique.mockResolvedValue({
      id: 'config-a',
      enabled: true,
      adminWhatsappIntegrationId: 'sender-a',
    });
    prisma.adminAlertRecipient.findMany.mockResolvedValue([
      {
        id: 'r1',
        encryptedRecipient: first.encryptedSecret,
        recipientIv: first.iv,
        recipientAuthTag: first.authTag,
        enabled: true,
      },
      {
        id: 'r2',
        encryptedRecipient: second.encryptedSecret,
        recipientIv: second.iv,
        recipientAuthTag: second.authTag,
        enabled: true,
      },
    ]);
    prisma.channelIntegration.findFirst.mockResolvedValue({
      id: 'sender-a',
      externalInstanceName: 'lia-tenant-a',
      encryptedAccessToken: encryptedToken.encryptedSecret,
      tokenIv: encryptedToken.iv,
      tokenAuthTag: encryptedToken.authTag,
    });
    const sendPrivateMessage = jest
      .spyOn(WhatsAppEvolutionProvider.prototype, 'sendPrivateMessage')
      .mockRejectedValueOnce(
        new Error(
          'Evolution sendText rejected request (HTTP 400): invalid number',
        ),
      )
      .mockRejectedValueOnce(new Error('WhatsApp provider response ambiguous'));

    const result = await service.sendTestMessage('tenant-a', 'ADMIN');

    expect(result.status).toBe('FAILED');
    expect(result.results[0].error).toContain('HTTP 400');
    expect(result.results[1].error).toBe(
      'WhatsApp provider response ambiguous',
    );
    expect(JSON.stringify(result)).not.toContain('5511999991234');
    expect(JSON.stringify(result)).not.toContain('5511999995678');
    sendPrivateMessage.mockRestore();
  });

  it('does not send while the real Evolution instance is disconnected', async () => {
    const encrypted = encryptSecret('5511999991234', encryptionKey);
    const encryptedToken = encryptSecret('instance-token', encryptionKey);
    prisma.adminAlertConfig.findUnique.mockResolvedValue({
      enabled: true,
      adminWhatsappIntegrationId: 'sender-a',
    });
    prisma.adminAlertConfig.findUnique.mockResolvedValue({
      id: 'config-a',
      enabled: true,
      adminWhatsappIntegrationId: 'sender-a',
    });
    prisma.adminAlertRecipient.findMany.mockResolvedValue([
      {
        id: 'r1',
        encryptedRecipient: encrypted.encryptedSecret,
        recipientIv: encrypted.iv,
        recipientAuthTag: encrypted.authTag,
        enabled: true,
      },
    ]);
    prisma.channelIntegration.findFirst.mockResolvedValue({
      id: 'sender-a',
      externalInstanceName: 'lia-tenant-a',
      encryptedAccessToken: encryptedToken.encryptedSecret,
      tokenIv: encryptedToken.iv,
      tokenAuthTag: encryptedToken.authTag,
    });
    jest
      .spyOn(WhatsAppEvolutionProvider.prototype, 'getConnectionState')
      .mockResolvedValue('DISCONNECTED');
    const sendPrivateMessage = jest.spyOn(
      WhatsAppEvolutionProvider.prototype,
      'sendPrivateMessage',
    );

    const result = await service.sendTestMessage('tenant-a', 'ADMIN');

    expect(result).toMatchObject({
      success: false,
      status: 'FAILED',
      sent: 0,
      failed: 1,
    });
    expect(result.results[0].error).toBe(
      'Instância WhatsApp não está conectada.',
    );
    expect(sendPrivateMessage).not.toHaveBeenCalled();
  });

  it('processes only active recipients and reports each active result', async () => {
    const encryptedToken = encryptSecret('instance-token', encryptionKey);
    const active = encryptSecret('5511999991234', encryptionKey);
    const inactive = encryptSecret('5511999995678', encryptionKey);
    prisma.adminAlertConfig.findUnique.mockResolvedValue({
      id: 'config-a',
      enabled: true,
      adminWhatsappIntegrationId: 'sender-a',
    });
    prisma.adminAlertRecipient.findMany.mockResolvedValue([
      {
        id: 'active',
        encryptedRecipient: active.encryptedSecret,
        recipientIv: active.iv,
        recipientAuthTag: active.authTag,
        enabled: true,
      },
      {
        id: 'inactive',
        encryptedRecipient: inactive.encryptedSecret,
        recipientIv: inactive.iv,
        recipientAuthTag: inactive.authTag,
        enabled: false,
      },
    ]);
    prisma.channelIntegration.findFirst.mockResolvedValue({
      id: 'sender-a',
      externalInstanceName: 'lia-tenant-a',
      encryptedAccessToken: encryptedToken.encryptedSecret,
      tokenIv: encryptedToken.iv,
      tokenAuthTag: encryptedToken.authTag,
    });
    const sendPrivateMessage = jest
      .spyOn(WhatsAppEvolutionProvider.prototype, 'sendPrivateMessage')
      .mockResolvedValue('message-active');

    const result = await service.sendTestMessage('tenant-a', 'ADMIN');

    expect(sendPrivateMessage).toHaveBeenCalledTimes(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].recipientId).toBe('active');
    expect(result.results[0].maskedRecipient).toBe('*********1234');
    expect(JSON.stringify(result)).not.toContain('5511999991234');
    expect(JSON.stringify(result)).not.toContain('5511999995678');
  });

  it('treats a missing messageId as a failed provider result', async () => {
    const encrypted = encryptSecret('5511999991234', encryptionKey);
    const encryptedToken = encryptSecret('instance-token', encryptionKey);
    prisma.adminAlertConfig.findUnique.mockResolvedValue({
      id: 'config-a',
      enabled: true,
      adminWhatsappIntegrationId: 'sender-a',
    });
    prisma.adminAlertRecipient.findMany.mockResolvedValue([
      {
        id: 'r1',
        encryptedRecipient: encrypted.encryptedSecret,
        recipientIv: encrypted.iv,
        recipientAuthTag: encrypted.authTag,
        enabled: true,
      },
    ]);
    prisma.channelIntegration.findFirst.mockResolvedValue({
      id: 'sender-a',
      externalInstanceName: 'lia-tenant-a',
      encryptedAccessToken: encryptedToken.encryptedSecret,
      tokenIv: encryptedToken.iv,
      tokenAuthTag: encryptedToken.authTag,
    });
    jest
      .spyOn(WhatsAppEvolutionProvider.prototype, 'sendPrivateMessage')
      .mockResolvedValue(null);

    const result = await service.sendTestMessage('tenant-a', 'ADMIN');

    expect(result).toMatchObject({
      status: 'FAILED',
      sent: 0,
      failed: 1,
    });
    expect(result.results[0].error).toBe('Evolution não retornou messageId.');
  });
});
