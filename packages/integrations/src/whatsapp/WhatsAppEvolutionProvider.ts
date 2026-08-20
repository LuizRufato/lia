import axios, { AxiosInstance } from "axios";
import { encryptSecret, decryptSecret } from "../security/encryption";
import { getEncryptionKey } from "../security/encryption-config";

export interface EvolutionConnectResponse {
  instanceName: string;
  qrcodeBase64: string;
  externalInstanceToken: string;
}

export interface EvolutionGroup {
  id: string;
  subject: string;
  participants: number;
}

export class WhatsAppEvolutionProvider {
  private api: AxiosInstance;

  constructor() {
    const baseURL = process.env.EVOLUTION_API_URL;
    if (!baseURL) {
      throw new Error("EVOLUTION_API_URL is not defined in environment.");
    }

    this.api = axios.create({
      baseURL,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  // Used only when creating/fetching instances
  private getGlobalApiKey() {
    const key = process.env.EVOLUTION_GLOBAL_API_KEY;
    if (!key) {
      throw new Error(
        "EVOLUTION_GLOBAL_API_KEY is not defined in environment.",
      );
    }
    return key;
  }

  async connectInstance(
    instanceName: string,
  ): Promise<EvolutionConnectResponse> {
    try {
      // Create or fetch instance
      const response = await this.api.post(
        "/instance/create",
        {
          instanceName,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
        },
        {
          headers: {
            apikey: this.getGlobalApiKey(),
          },
        },
      );

      const data = response.data;
      if (!data || !data.hash) {
        throw new Error("Evolution API did not return instance token (hash).");
      }

      // data.hash usually contains the instance auth token.
      // Alternatively data.instance.token may be the one depending on Evolution version.
      const externalInstanceToken =
        data.hash?.apikey || data.hash || data.instance?.token;

      let qrcodeBase64 = data.qrcode?.base64 || "";
      if (!qrcodeBase64 && data.qrcode) {
        qrcodeBase64 =
          typeof data.qrcode === "string"
            ? data.qrcode
            : data.qrcode.base64 || JSON.stringify(data.qrcode);
      }
      if (typeof qrcodeBase64 === "object") {
        qrcodeBase64 =
          (qrcodeBase64 as any).base64 || JSON.stringify(qrcodeBase64);
      }

      return {
        instanceName,
        qrcodeBase64,
        externalInstanceToken,
      };
    } catch (e: any) {
      console.error(
        "Error connecting to Evolution API:",
        e.response?.data || e.message,
      );
      throw new Error(`Failed to create/connect instance: ${e.message}`);
    }
  }

  async getConnectionState(
    instanceName: string,
    token: string,
  ): Promise<string> {
    try {
      const response = await this.api.get(
        `/instance/connectionState/${instanceName}`,
        {
          headers: {
            apikey: token,
          },
        },
      );
      return response.data?.instance?.state || "UNKNOWN"; // open, connecting, close
    } catch (e: any) {
      if (e.response?.status === 404) return "DISCONNECTED";
      console.error(
        "Error getting connection state:",
        e.response?.data || e.message,
      );
      throw new Error("Failed to get connection state");
    }
  }

  async logout(instanceName: string, token: string): Promise<boolean> {
    try {
      await this.api.delete(`/instance/logout/${instanceName}`, {
        headers: { apikey: token },
      });
      return true;
    } catch (e: any) {
      return false;
    }
  }

  async fetchGroups(
    instanceName: string,
    token: string,
  ): Promise<EvolutionGroup[]> {
    try {
      // Get groups requires get-all-groups endpoint or chat endpoint
      const response = await this.api.get(
        `/group/fetchAllGroups/${instanceName}?getParticipants=true`,
        {
          headers: { apikey: token },
        },
      );

      const groups = response.data || [];
      return groups.map((g: any) => ({
        id: g.id,
        subject: g.subject,
        participants: g.participants?.length || 0,
      }));
    } catch (e: any) {
      console.error("Error fetching groups:", e.response?.data || e.message);
      throw new Error(
        `Failed to fetch groups from Evolution API: ${e.message}`,
      );
    }
  }

  async sendGroupMessage(
    instanceName: string,
    token: string,
    groupJid: string,
    text: string,
  ): Promise<string> {
    try {
      const response = await this.api.post(
        `/message/sendText/${instanceName}`,
        {
          number: groupJid,
          options: {
            delay: 1200,
            presence: "composing",
          },
          textMessage: {
            text,
          },
        },
        {
          headers: { apikey: token },
        },
      );

      return response.data?.key?.id || `evo-msg-${Date.now()}`;
    } catch (e: any) {
      console.error("Error sending message:", e.response?.data || e.message);
      throw new Error(`Failed to send message: ${e.message}`);
    }
  }
}
