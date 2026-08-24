import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { decryptSecret, encryptSecret } from '@lia/integrations';
import { AdminAlertsService } from './admin-alerts.service';

describe('AdminAlertsService', () => {
  const encryptionKey = 'a'.repeat(64);
  let service: AdminAlertsService;
  let prisma: {
    adminAlertConfig: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
  };

  beforeEach(() => {
    process.env.INTEGRATION_ENCRYPTION_KEY = encryptionKey;
    prisma = {
      adminAlertConfig: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
    };
    service = new AdminAlertsService(prisma as any);
  });

  it('returns safe defaults when no configuration exists', async () => {
    await expect(service.getConfig('tenant-a', 'OWNER')).resolves.toEqual({
      enabled: false,
      hasRecipient: false,
      recipientMasked: null,
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

    await service.updateConfig('tenant-a', 'ADMIN', { enabled: true });
    const firstEnabledAt =
      prisma.adminAlertConfig.upsert.mock.calls[0][0].update.enabledAt;
    expect(firstEnabledAt).toBeInstanceOf(Date);

    prisma.adminAlertConfig.findUnique.mockResolvedValue({
      ...recipient,
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
});
