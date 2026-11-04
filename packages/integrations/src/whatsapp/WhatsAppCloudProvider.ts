import { timingSafeEqual } from "crypto";
import { decryptSecret } from "../security/encryption";
import { getEncryptionKey } from "../security/encryption-config";

export interface WhatsAppConfig {
  wabaId: string;
  phoneNumberId: string;
  encryptedAccessToken: string;
  tokenIv: string;
  tokenAuthTag: string;
}

export interface WhatsAppMessagePayload {
  to: string;
  type: "template";
  template: {
    name: string;
    language: {
      code: string;
    };
    components?: any[];
  };
}

export interface WebhookChallengeParams {
  "hub.mode": string;
  "hub.verify_token": string;
  "hub.challenge": string;
}

export class WhatsAppCloudProvider {
  private readonly graphApiVersion: string;
  private readonly baseUrl: string;

  constructor() {
    if (!process.env.META_GRAPH_API_VERSION) {
      throw new Error(
        "META_GRAPH_API_VERSION is missing in environment variables.",
      );
    }
    this.graphApiVersion = process.env.META_GRAPH_API_VERSION;
    this.baseUrl = `https://graph.facebook.com/${this.graphApiVersion}`;
  }

  /**
   * Decrypts the access token and returns it.
   */
  private getDecryptedToken(config: WhatsAppConfig): string {
    // INTEGRATION_SECRET_KEY was a divergent env name (only this provider
    // used it, while the rest of the system uses INTEGRATION_ENCRYPTION_KEY
    // via getEncryptionKey()). Tokens encrypted by the rest of the system
    // were produced with INTEGRATION_ENCRYPTION_KEY, so that key must be
    // tried first; fall back to the legacy name for tokens stored that way.
    const candidates = [
      getEncryptionKey(),
      process.env.INTEGRATION_SECRET_KEY,
    ].filter(Boolean) as string[];
    let lastError: unknown;
    for (const key of candidates) {
      try {
        return decryptSecret(
          config.encryptedAccessToken,
          config.tokenIv,
          config.tokenAuthTag,
          key,
        );
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError ?? new Error("INTEGRATION_ENCRYPTION_KEY is not configured.");
  }

  /**
   * Verifies the Webhook Challenge from Meta.
   */
  public verifyWebhookChallenge(
    params: WebhookChallengeParams,
    expectedVerifyToken: string,
  ): string | null {
    if (params["hub.mode"] !== "subscribe") return null;
    const given = Buffer.from(params["hub.verify_token"] ?? "");
    const expected = Buffer.from(expectedVerifyToken ?? "");
    const matches =
      given.length === expected.length &&
      timingSafeEqual(given, expected);
    if (matches) return params["hub.challenge"];
    return null;
  }

  /**
   * Validates if the Phone Number ID and WABA ID are correct by making a read-only request to the Meta API.
   * Uses GET /{phone_number_id}
   */
  public async testConnection(config: WhatsAppConfig): Promise<boolean> {
    const token = this.getDecryptedToken(config);
    const url = `${this.baseUrl}/${config.phoneNumberId}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      return !!data.id;
    } catch (error) {
      return false;
    }
  }

  /**
   * Sends a message through WhatsApp Cloud API.
   */
  public async sendMessage(
    config: WhatsAppConfig,
    payload: WhatsAppMessagePayload,
  ): Promise<any> {
    const token = this.getDecryptedToken(config);
    const url = `${this.baseUrl}/${config.phoneNumberId}/messages`;

    const requestBody = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      ...payload,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      const responseData = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error(
            `WhatsApp API Rate Limited (429): ${JSON.stringify(responseData)}`,
          );
        }
        if (response.status >= 500) {
          throw new Error(
            `WhatsApp API Server Error (${response.status}): ${JSON.stringify(responseData)}`,
          );
        }
        throw new Error(
          `WhatsApp API Error (${response.status}): ${JSON.stringify(responseData)}`,
        );
      }

      return responseData;
    } catch (error: any) {
      if (error.name === "AbortError") {
        throw new Error("WhatsApp API Timeout Ambíguo (Possível Envio)");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
