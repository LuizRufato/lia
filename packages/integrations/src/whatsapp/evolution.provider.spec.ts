import axios from "axios";
import {
  checkEvolutionWebhookHealth,
  WhatsAppEvolutionProvider,
} from "./WhatsAppEvolutionProvider";

jest.mock("axios", () => {
  const create = jest.fn();
  return { __esModule: true, default: { create }, create };
});

describe("WhatsAppEvolutionProvider lifecycle safety", () => {
  const api = {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(() => {
    process.env.EVOLUTION_API_URL = "http://evolution.test";
    process.env.EVOLUTION_GLOBAL_API_KEY = "global-key";
    jest.clearAllMocks();
    (axios.create as jest.Mock).mockReturnValue(api);
  });

  it("reuses an open instance instead of creating a timestamped duplicate", async () => {
    api.get.mockResolvedValueOnce({
      data: [
        { instanceName: "lia-tenant", state: "open", hash: "instance-key" },
      ],
    });
    const result = await new WhatsAppEvolutionProvider().connectInstance(
      "lia-tenant",
    );
    expect(result).toMatchObject({
      instanceName: "lia-tenant",
      state: "open",
      reused: true,
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("invalidates a stale instance before creating its replacement", async () => {
    api.get.mockResolvedValueOnce({
      data: [{ instanceName: "lia-tenant", state: "close", hash: "old-key" }],
    });
    api.delete.mockResolvedValue({});
    api.post.mockResolvedValueOnce({
      data: { hash: "new-key", qrcode: { base64: "qr" } },
    });
    const result = await new WhatsAppEvolutionProvider().connectInstance(
      "lia-tenant",
    );
    expect(api.delete).toHaveBeenCalledTimes(2);
    expect(api.post).toHaveBeenCalledWith(
      "/instance/create",
      expect.objectContaining({ instanceName: "lia-tenant", qrcode: true }),
      expect.anything(),
    );
    expect(result.externalInstanceToken).toBe("new-key");
  });

  it("supports pairing code as an alternative to QR", async () => {
    api.get.mockResolvedValueOnce({ data: [] });
    api.post
      .mockResolvedValueOnce({ data: { hash: "new-key" } })
      .mockResolvedValueOnce({ data: { pairingCode: "1234-5678" } });
    const result = await new WhatsAppEvolutionProvider().connectInstance(
      "lia-tenant",
      "+55 (11) 99999-9999",
    );
    expect(result.pairingCode).toBe("1234-5678");
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/instance/connect/lia-tenant",
      { number: "5511999999999" },
      expect.anything(),
    );
  });

  it("returns null when Evolution does not confirm a message id", async () => {
    api.post.mockResolvedValueOnce({ data: {} });
    await expect(
      new WhatsAppEvolutionProvider().sendGroupMessage(
        "lia-tenant",
        "key",
        "group@g.us",
        "test",
      ),
    ).resolves.toBeNull();
    expect(api.post).toHaveBeenCalledWith(
      "/message/sendText/lia-tenant",
      { number: "group@g.us", text: "test", linkPreview: false },
      { headers: { apikey: "key" } },
    );
  });

  it("sends a private message with the same safe sendText payload", async () => {
    api.post.mockResolvedValueOnce({
      data: { key: { id: "private-message-id" } },
    });
    await expect(
      new WhatsAppEvolutionProvider().sendPrivateMessage(
        "lia-tenant",
        "instance-key",
        "5511999991234",
        "✅ Teste de alertas LIA",
      ),
    ).resolves.toBe("private-message-id");
    expect(api.post).toHaveBeenCalledWith(
      "/message/sendText/lia-tenant",
      {
        number: "5511999991234",
        text: "✅ Teste de alertas LIA",
        linkPreview: false,
      },
      { headers: { apikey: "instance-key" } },
    );
  });

  it("uses the Evolution v2.3.7 top-level text payload and extracts the real message id", async () => {
    api.post.mockResolvedValueOnce({ data: { key: { id: "evo-message-id" } } });
    await expect(
      new WhatsAppEvolutionProvider().sendGroupMessage(
        "lia-tenant",
        "instance-key",
        "120@g.us",
        "Oferta teste",
      ),
    ).resolves.toBe("evo-message-id");
    expect(api.post).toHaveBeenCalledWith(
      "/message/sendText/lia-tenant",
      { number: "120@g.us", text: "Oferta teste", linkPreview: false },
      { headers: { apikey: "instance-key" } },
    );
  });

  it("enables the native preview only for an HTTPS URL in text messages", async () => {
    api.post.mockResolvedValueOnce({
      data: { key: { id: "preview-message-id" } },
    });
    await expect(
      new WhatsAppEvolutionProvider().sendGroupMessage(
        "lia-tenant",
        "instance-key",
        "120@g.us",
        "Oferta https://go.botlia.com.br/abc123",
      ),
    ).resolves.toBe("preview-message-id");
    expect(api.post).toHaveBeenCalledWith(
      "/message/sendText/lia-tenant",
      {
        number: "120@g.us",
        text: "Oferta https://go.botlia.com.br/abc123",
        linkPreview: true,
      },
      { headers: { apikey: "instance-key" } },
    );
  });

  it("sends a validated image URL with the rendered caption", async () => {
    api.post.mockResolvedValueOnce({ data: { key: { id: "media-id" } } });
    await expect(
      new WhatsAppEvolutionProvider().sendGroupMediaMessage(
        "lia-tenant",
        "instance-key",
        "120@g.us",
        {
          mediaUrl: "https://cdn.example/product.png?sig=1",
          caption: "Oferta atualizada",
        },
      ),
    ).resolves.toBe("media-id");
    expect(api.post).toHaveBeenCalledWith(
      "/message/sendMedia/lia-tenant",
      {
        number: "120@g.us",
        mediatype: "image",
        mimetype: "image/png",
        caption: "Oferta atualizada",
        media: "https://cdn.example/product.png?sig=1",
        fileName: "lia-product.png",
      },
      { headers: { apikey: "instance-key" } },
    );
  });

  it("rejects non-HTTPS media URLs before calling Evolution", async () => {
    await expect(
      new WhatsAppEvolutionProvider().sendGroupMediaMessage(
        "lia-tenant",
        "instance-key",
        "120@g.us",
        { mediaUrl: "http://private.example/product.jpg", caption: "Oferta" },
      ),
    ).rejects.toThrow("Imagem de publicação inválida");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("returns a sanitized provider message for a rejected 4xx request without secrets", async () => {
    api.post.mockRejectedValueOnce({
      response: {
        status: 400,
        data: {
          message: "text must be a string",
          apikey: "do-not-leak",
          token: "do-not-leak",
        },
        headers: { authorization: "do-not-leak" },
      },
    });
    let caught: unknown;
    try {
      await new WhatsAppEvolutionProvider().sendGroupMessage(
        "lia-tenant",
        "secret-key",
        "group@g.us",
        "test",
      );
    } catch (error) {
      caught = error;
    }
    expect(String(caught)).toContain(
      "Evolution sendText rejected request (HTTP 400): text must be a string",
    );
    expect(String(caught)).not.toContain("do-not-leak");
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("keeps 5xx and timeout failures ambiguous without retrying", async () => {
    api.post.mockRejectedValueOnce({ response: { status: 503 } });
    await expect(
      new WhatsAppEvolutionProvider().sendGroupMessage(
        "lia-tenant",
        "key",
        "group@g.us",
        "test",
      ),
    ).rejects.toThrow("WhatsApp provider response ambiguous");
    expect(api.post).toHaveBeenCalledTimes(1);

    api.post.mockRejectedValueOnce({ code: "ECONNABORTED" });
    await expect(
      new WhatsAppEvolutionProvider().sendGroupMessage(
        "lia-tenant",
        "key",
        "group@g.us",
        "test",
      ),
    ).rejects.toThrow("WhatsApp provider response ambiguous");
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it("normalizes the current Evolution group response shape", async () => {
    api.get.mockResolvedValueOnce({
      data: {
        groups: [
          {
            id: "123@g.us",
            subject: "Ofertas",
            participants: [{ id: "a" }, { id: "b" }],
          },
          { jid: "456@g.us", name: "Sem assunto", size: 4 },
        ],
      },
    });
    await expect(
      new WhatsAppEvolutionProvider().fetchGroups("lia-tenant", "instance-key"),
    ).resolves.toEqual([
      { id: "123@g.us", subject: "Ofertas", participants: 2 },
      { id: "456@g.us", subject: "Sem assunto", participants: 4 },
    ]);
    expect(api.get).toHaveBeenCalledWith(
      "/group/fetchAllGroups/lia-tenant?getParticipants=true",
      { headers: { apikey: "instance-key" } },
    );
  });

  it("reads the webhook configuration without exposing header values", async () => {
    api.get.mockResolvedValueOnce({
      data: {
        webhook: {
          enabled: true,
          url: "https://api.example/webhooks/evolution",
          events: ["group-participants.update"],
          headers: {
            "x-evolution-webhook-secret": "must-not-leak",
          },
          webhookByEvents: true,
          base64: false,
        },
      },
    });

    const result = await new WhatsAppEvolutionProvider().getWebhookConfig(
      "lia-tenant",
      "instance-key",
    );

    expect(result).toEqual({
      enabled: true,
      url: "https://api.example/webhooks/evolution",
      events: ["group-participants.update"],
      headerNames: ["x-evolution-webhook-secret"],
      headersPresent: true,
      webhookByEvents: true,
      webhookBase64: false,
    });
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
    expect(api.get).toHaveBeenCalledWith("/webhook/find/lia-tenant", {
      headers: { apikey: "instance-key" },
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("classifies webhook configuration without writing it", async () => {
    api.get.mockResolvedValueOnce({
      data: {
        enabled: true,
        url: "https://api.example/webhooks/evolution",
        events: ["GROUP_PARTICIPANTS_UPDATE"],
        headers: { "x-evolution-webhook-secret": "secret" },
        webhookByEvents: true,
      },
    });

    await expect(
      new WhatsAppEvolutionProvider().checkEvolutionWebhookHealth(
        "lia-tenant",
        "instance-key",
        {
          url: "https://api.example/webhooks/evolution",
          event: "group-participants.update",
          headerName: "x-evolution-webhook-secret",
          webhookByEvents: true,
        },
      ),
    ).resolves.toBe("HEALTHY");
    expect(api.post).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("classifies absent or drifted webhook configuration", () => {
    const expected = {
      url: "https://api.example/webhooks/evolution",
      event: "group-participants.update",
      headerName: "x-evolution-webhook-secret",
    };
    expect(
      checkEvolutionWebhookHealth(
        {
          enabled: false,
          url: null,
          events: [],
          headerNames: [],
          headersPresent: false,
          webhookByEvents: false,
          webhookBase64: false,
        },
        expected,
      ),
    ).toBe("NOT_CONFIGURED");
    expect(
      checkEvolutionWebhookHealth(
        {
          enabled: true,
          url: "https://wrong.example/webhook",
          events: ["group-participants.update"],
          headerNames: [],
          headersPresent: false,
          webhookByEvents: false,
          webhookBase64: false,
        },
        expected,
      ),
    ).toBe("DRIFTED");
  });

  it("reads a group invite with GET only and validates the URL", async () => {
    api.get.mockResolvedValueOnce({
      data: {
        inviteCode: "AbC123",
        inviteUrl: "https://chat.whatsapp.com/AbC123",
      },
    });

    await expect(
      new WhatsAppEvolutionProvider().fetchGroupInviteCode(
        "lia tenant",
        "instance-key",
        "120@g.us",
      ),
    ).resolves.toEqual({
      inviteCode: "AbC123",
      inviteUrl: "https://chat.whatsapp.com/AbC123",
    });
    expect(api.get).toHaveBeenCalledWith(
      "/group/inviteCode/lia%20tenant?groupJid=120%40g.us",
      { headers: { apikey: "instance-key" } },
    );
    expect(api.post).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("rejects an unsafe invite URL without any write operation", async () => {
    api.get.mockResolvedValueOnce({
      data: { inviteUrl: "http://chat.whatsapp.com/AbC123" },
    });

    await expect(
      new WhatsAppEvolutionProvider().fetchGroupInviteCode(
        "lia-tenant",
        "instance-key",
        "120@g.us",
      ),
    ).rejects.toThrow("Evolution returned an invalid group invite");
    expect(api.post).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("keeps repeated invite reads stable", async () => {
    api.get
      .mockResolvedValueOnce({
        data: {
          inviteCode: "StableCode",
          inviteUrl: "https://chat.whatsapp.com/StableCode",
        },
      })
      .mockResolvedValueOnce({
        data: {
          inviteCode: "StableCode",
          inviteUrl: "https://chat.whatsapp.com/StableCode",
        },
      });

    const provider = new WhatsAppEvolutionProvider();
    const first = await provider.fetchGroupInviteCode(
      "lia-tenant",
      "instance-key",
      "120@g.us",
    );
    const second = await provider.fetchGroupInviteCode(
      "lia-tenant",
      "instance-key",
      "120@g.us",
    );

    expect(first).toEqual(second);
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.post).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });
});
