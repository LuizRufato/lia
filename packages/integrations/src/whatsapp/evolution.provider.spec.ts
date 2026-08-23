import axios from 'axios';
import { WhatsAppEvolutionProvider } from './WhatsAppEvolutionProvider';

jest.mock('axios', () => {
  const create = jest.fn();
  return { __esModule: true, default: { create }, create };
});

describe('WhatsAppEvolutionProvider lifecycle safety', () => {
  const api = {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(() => {
    process.env.EVOLUTION_API_URL = 'http://evolution.test';
    process.env.EVOLUTION_GLOBAL_API_KEY = 'global-key';
    jest.clearAllMocks();
    (axios.create as jest.Mock).mockReturnValue(api);
  });

  it('reuses an open instance instead of creating a timestamped duplicate', async () => {
    api.get.mockResolvedValueOnce({
      data: [{ instanceName: 'lia-tenant', state: 'open', hash: 'instance-key' }],
    });
    const result = await new WhatsAppEvolutionProvider().connectInstance('lia-tenant');
    expect(result).toMatchObject({ instanceName: 'lia-tenant', state: 'open', reused: true });
    expect(api.post).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('invalidates a stale instance before creating its replacement', async () => {
    api.get.mockResolvedValueOnce({
      data: [{ instanceName: 'lia-tenant', state: 'close', hash: 'old-key' }],
    });
    api.delete.mockResolvedValue({});
    api.post.mockResolvedValueOnce({ data: { hash: 'new-key', qrcode: { base64: 'qr' } } });
    const result = await new WhatsAppEvolutionProvider().connectInstance('lia-tenant');
    expect(api.delete).toHaveBeenCalledTimes(2);
    expect(api.post).toHaveBeenCalledWith(
      '/instance/create',
      expect.objectContaining({ instanceName: 'lia-tenant', qrcode: true }),
      expect.anything(),
    );
    expect(result.externalInstanceToken).toBe('new-key');
  });

  it('supports pairing code as an alternative to QR', async () => {
    api.get.mockResolvedValueOnce({ data: [] });
    api.post
      .mockResolvedValueOnce({ data: { hash: 'new-key' } })
      .mockResolvedValueOnce({ data: { pairingCode: '1234-5678' } });
    const result = await new WhatsAppEvolutionProvider().connectInstance('lia-tenant', '+55 (11) 99999-9999');
    expect(result.pairingCode).toBe('1234-5678');
    expect(api.post).toHaveBeenNthCalledWith(2, '/instance/connect/lia-tenant', { number: '5511999999999' }, expect.anything());
  });

  it('returns null when Evolution does not confirm a message id', async () => {
    api.post.mockResolvedValueOnce({ data: {} });
    await expect(
      new WhatsAppEvolutionProvider().sendGroupMessage('lia-tenant', 'key', 'group@g.us', 'test'),
    ).resolves.toBeNull();
    expect(api.post).toHaveBeenCalledWith(
      '/message/sendText/lia-tenant',
      { number: 'group@g.us', text: 'test' },
      { headers: { apikey: 'key' } },
    );
  });

  it('uses the Evolution v2.3.7 top-level text payload and extracts the real message id', async () => {
    api.post.mockResolvedValueOnce({ data: { key: { id: 'evo-message-id' } } });
    await expect(
      new WhatsAppEvolutionProvider().sendGroupMessage('lia-tenant', 'instance-key', '120@g.us', 'Oferta teste'),
    ).resolves.toBe('evo-message-id');
    expect(api.post).toHaveBeenCalledWith(
      '/message/sendText/lia-tenant',
      { number: '120@g.us', text: 'Oferta teste' },
      { headers: { apikey: 'instance-key' } },
    );
  });

  it('returns a sanitized provider message for a rejected 4xx request without secrets', async () => {
    api.post.mockRejectedValueOnce({
      response: {
        status: 400,
        data: {
          message: 'text must be a string',
          apikey: 'do-not-leak',
          token: 'do-not-leak',
        },
        headers: { authorization: 'do-not-leak' },
      },
    });
    let caught: unknown;
    try {
      await new WhatsAppEvolutionProvider().sendGroupMessage('lia-tenant', 'secret-key', 'group@g.us', 'test');
    } catch (error) {
      caught = error;
    }
    expect(String(caught)).toContain('Evolution sendText rejected request (HTTP 400): text must be a string');
    expect(String(caught)).not.toContain('do-not-leak');
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('keeps 5xx and timeout failures ambiguous without retrying', async () => {
    api.post.mockRejectedValueOnce({ response: { status: 503 } });
    await expect(
      new WhatsAppEvolutionProvider().sendGroupMessage('lia-tenant', 'key', 'group@g.us', 'test'),
    ).rejects.toThrow('WhatsApp provider response ambiguous');
    expect(api.post).toHaveBeenCalledTimes(1);

    api.post.mockRejectedValueOnce({ code: 'ECONNABORTED' });
    await expect(
      new WhatsAppEvolutionProvider().sendGroupMessage('lia-tenant', 'key', 'group@g.us', 'test'),
    ).rejects.toThrow('WhatsApp provider response ambiguous');
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it('normalizes the current Evolution group response shape', async () => {
    api.get.mockResolvedValueOnce({
      data: {
        groups: [
          { id: '123@g.us', subject: 'Ofertas', participants: [{ id: 'a' }, { id: 'b' }] },
          { jid: '456@g.us', name: 'Sem assunto', size: 4 },
        ],
      },
    });
    await expect(new WhatsAppEvolutionProvider().fetchGroups('lia-tenant', 'instance-key'))
      .resolves.toEqual([
        { id: '123@g.us', subject: 'Ofertas', participants: 2 },
        { id: '456@g.us', subject: 'Sem assunto', participants: 4 },
      ]);
    expect(api.get).toHaveBeenCalledWith(
      '/group/fetchAllGroups/lia-tenant?getParticipants=true',
      { headers: { apikey: 'instance-key' } },
    );
  });
});
