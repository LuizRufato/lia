const sendPrivateMessage = jest.fn();

jest.mock('@lia/integrations', () => ({
  decryptSecret: jest.fn((value: string) =>
    value === 'encrypted-recipient' ? '5511999991234' : 'instance-token',
  ),
  getEncryptionKey: jest.fn().mockReturnValue('encryption-key'),
  WhatsAppEvolutionProvider: jest.fn().mockImplementation(() => ({
    sendPrivateMessage,
  })),
}));

import {
  AdminAlertsProcessor,
  buildNewShopeeSaleMessage,
} from './admin-alerts.processor';

describe('AdminAlertsProcessor', () => {
  let prisma: any;
  let processor: AdminAlertsProcessor;
  const enabledAt = new Date('2026-08-24T20:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    sendPrivateMessage.mockResolvedValue('message-id');
    prisma = {
      adminAlert: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'alert-1',
          tenantId: 'tenant-a',
          type: 'NEW_SHOPEE_SALE',
          createdAt: new Date('2026-08-24T20:01:00.000Z'),
          deliveryStatus: 'PENDING',
          payload: {
            purchaseTime: '2026-08-24T20:01:00.000Z',
            commissionStatus: 'PENDING',
            totalCommissionCents: 350,
            orders: [
              {
                orderId: 'order-1',
                status: 'PENDING',
                items: [
                  {
                    itemName: 'Produto A',
                    qty: 1,
                    actualAmountCents: 1000,
                  },
                ],
              },
            ],
          },
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      adminAlertConfig: {
        findUnique: jest.fn().mockResolvedValue({
          enabled: true,
          newShopeeSaleEnabled: true,
          encryptedRecipient: 'encrypted-recipient',
          recipientIv: 'recipient-iv',
          recipientAuthTag: 'recipient-tag',
          adminWhatsappIntegrationId: 'sender-a',
          enabledAt,
        }),
      },
      channelIntegration: {
        findFirst: jest.fn().mockResolvedValue({
          externalInstanceName: 'lia-tenant-a',
          encryptedAccessToken: 'encrypted-token',
          tokenIv: 'token-iv',
          tokenAuthTag: 'token-tag',
        }),
      },
    };
    processor = new AdminAlertsProcessor(prisma);
  });

  const job = (attemptsMade = 0, attempts = 5) =>
    ({
      data: { alertId: 'alert-1' },
      attemptsMade,
      opts: { attempts },
    }) as any;

  it('sends an eligible alert once and marks it SENT', async () => {
    await expect(processor.process(job())).resolves.toEqual(
      expect.objectContaining({ success: true, messageId: 'message-id' }),
    );
    expect(sendPrivateMessage).toHaveBeenCalledWith(
      'lia-tenant-a',
      'instance-token',
      '5511999991234',
      expect.stringContaining('NOVA VENDA SHOPEE'),
    );
    expect(prisma.adminAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deliveryStatus: 'SENT' }),
      }),
    );
  });

  it('does not send alerts created before enabledAt', async () => {
    prisma.adminAlert.findUnique.mockResolvedValueOnce({
      id: 'alert-1',
      tenantId: 'tenant-a',
      type: 'NEW_SHOPEE_SALE',
      createdAt: new Date('2026-08-24T19:59:00.000Z'),
      deliveryStatus: 'PENDING',
      payload: {},
    });

    await expect(processor.process(job())).resolves.toMatchObject({
      skipped: true,
    });
    expect(sendPrivateMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['disabled config', { enabled: false }],
    ['disabled sale toggle', { newShopeeSaleEnabled: false }],
  ])('does not send when %s', async (_label, override) => {
    prisma.adminAlertConfig.findUnique.mockResolvedValueOnce({
      enabled: true,
      newShopeeSaleEnabled: true,
      encryptedRecipient: 'encrypted-recipient',
      recipientIv: 'recipient-iv',
      recipientAuthTag: 'recipient-tag',
      adminWhatsappIntegrationId: 'sender-a',
      enabledAt,
      ...override,
    });

    await processor.process(job());
    expect(sendPrivateMessage).not.toHaveBeenCalled();
  });

  it('does not send without a usable sender integration', async () => {
    prisma.channelIntegration.findFirst.mockResolvedValueOnce(null);
    await processor.process(job());
    expect(sendPrivateMessage).not.toHaveBeenCalled();
  });

  it('marks a permanent provider error FAILED without a retry loop', async () => {
    sendPrivateMessage.mockRejectedValueOnce(
      new Error(
        'Evolution sendText rejected request (HTTP 400): invalid number',
      ),
    );

    await expect(processor.process(job(0, 5))).resolves.toMatchObject({
      failed: true,
    });
    expect(prisma.adminAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryStatus: 'FAILED',
          lastDeliveryError: expect.stringContaining('HTTP 400'),
        }),
      }),
    );
    expect(sendPrivateMessage).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures and does not duplicate after SENT', async () => {
    sendPrivateMessage.mockRejectedValueOnce(
      new Error('WhatsApp provider response ambiguous'),
    );
    await expect(processor.process(job(0, 5))).rejects.toThrow('ambiguous');
    expect(prisma.adminAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deliveryStatus: 'PENDING' }),
      }),
    );

    sendPrivateMessage.mockResolvedValueOnce('message-id');
    await processor.process(job(1, 5));
    expect(sendPrivateMessage).toHaveBeenCalledTimes(2);

    prisma.adminAlert.findUnique.mockResolvedValueOnce({
      id: 'alert-1',
      tenantId: 'tenant-a',
      type: 'NEW_SHOPEE_SALE',
      createdAt: new Date('2026-08-24T20:01:00.000Z'),
      deliveryStatus: 'SENT',
      payload: {},
    });
    await processor.process(job());
    expect(sendPrivateMessage).toHaveBeenCalledTimes(2);
  });

  it('sanitizes recipient and credentials from delivery errors', async () => {
    sendPrivateMessage.mockRejectedValueOnce(
      new Error('provider failed for 5511999991234 token=secret-key'),
    );
    await processor.process(job(0, 1));
    const errors = prisma.adminAlert.update.mock.calls
      .map((call: any[]) => call[0]?.data?.lastDeliveryError)
      .filter(Boolean)
      .join(' ');
    expect(errors).not.toContain('5511999991234');
    expect(errors).not.toContain('secret-key');
  });

  it('formats multiple items with Campo Grande time and omits unavailable totals', () => {
    const message = buildNewShopeeSaleMessage({
      purchaseTime: '2026-08-24T20:01:00.000Z',
      commissionStatus: 'PENDING',
      totalCommissionCents: null,
      orders: [
        {
          items: [
            { itemName: 'Produto A', qty: 1, actualAmountCents: 1000 },
            { itemName: 'Produto B', qty: 2, actualAmountCents: null },
          ],
        },
      ],
    });
    expect(message).toContain('Pedido com 2 itens');
    expect(message).toContain('Produto A');
    expect(message).toContain('Horário:');
    expect(message).not.toContain('Comissão estimada');
    expect(message).not.toContain('Valor do pedido');
  });
});
