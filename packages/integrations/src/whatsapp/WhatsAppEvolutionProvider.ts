import axios, { AxiosInstance } from "axios";

export type EvolutionConnectionState =
  | "open"
  | "connecting"
  | "close"
  | "DISCONNECTED"
  | "UNAUTHORIZED"
  | "UNKNOWN";

export interface EvolutionConnectResponse {
  instanceName: string;
  qrcodeBase64: string;
  pairingCode?: string;
  externalInstanceToken: string;
  state?: EvolutionConnectionState;
  reused?: boolean;
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
      headers: { "Content-Type": "application/json" },
    });
  }

  private getGlobalApiKey() {
    const key = process.env.EVOLUTION_GLOBAL_API_KEY;
    if (!key) throw new Error("EVOLUTION_GLOBAL_API_KEY is not defined in environment.");
    return key;
  }

  private parseInstanceToken(data: any): string {
    return String(
      data?.hash?.apikey || data?.hash || data?.instance?.token ||
        data?.instance?.apikey || data?.apikey || "",
    );
  }

  private parseQr(data: any): string {
    const qr = data?.qrcode ?? data?.qr ?? data?.base64;
    if (!qr) return "";
    if (typeof qr === "string") return qr;
    return String(qr.base64 || qr.code || "");
  }

  private parsePairingCode(data: any): string | undefined {
    const code = data?.pairingCode || data?.pairing_code || data?.code;
    return code ? String(code) : undefined;
  }

  private normalizeState(value: unknown): EvolutionConnectionState {
    const state = String(value || "UNKNOWN").toLowerCase();
    if (state === "open" || state === "connected") return "open";
    if (state === "connecting" || state === "qrcode") return "connecting";
    if (state === "close" || state === "closed") return "close";
    if (state === "unauthorized" || state === "unpaired") return "UNAUTHORIZED";
    if (state === "disconnected") return "DISCONNECTED";
    return "UNKNOWN";
  }

  async findInstance(instanceName: string): Promise<any | null> {
    try {
      const response = await this.api.get("/instance/fetchInstances", {
        headers: { apikey: this.getGlobalApiKey() },
      });
      const instances = Array.isArray(response.data)
        ? response.data
        : response.data?.instances || [];
      return instances.find((instance: any) =>
        instance?.instance?.instanceName === instanceName ||
        instance?.instanceName === instanceName || instance?.name === instanceName,
      ) || null;
    } catch (error: any) {
      if (error.response?.status === 404) return null;
      throw new Error("Failed to list Evolution instances");
    }
  }

  async connectInstance(
    instanceName: string,
    phoneNumber?: string,
    knownToken?: string,
  ): Promise<EvolutionConnectResponse> {
    try {
      const existing = await this.findInstance(instanceName);
      if (existing) {
        const existingToken = this.parseInstanceToken(existing) || knownToken || "";
        const existingState = this.normalizeState(
          existing?.connectionStatus || existing?.state || existing?.instance?.state,
        );
        const state = existingState === "UNKNOWN" && knownToken
          ? await this.getConnectionState(instanceName, knownToken)
          : existingState;
        if (state === "open" || state === "connecting") {
          let pairingCode: string | undefined;
          if (phoneNumber && state !== "open") {
            const pairing = await this.requestPairingCode(
              instanceName, phoneNumber, existingToken || this.getGlobalApiKey(),
            );
            pairingCode = pairing.pairingCode;
          }
          return {
            instanceName,
            qrcodeBase64: this.parseQr(existing),
            pairingCode,
            externalInstanceToken: existingToken,
            state,
            reused: true,
          };
        }
        await this.disconnectInstance(instanceName, existingToken || this.getGlobalApiKey());
      }

      const response = await this.api.post(
        "/instance/create",
        { instanceName, qrcode: !phoneNumber, integration: "WHATSAPP-BAILEYS" },
        { headers: { apikey: this.getGlobalApiKey() } },
      );
      const data = response.data;
      const externalInstanceToken = this.parseInstanceToken(data);
      if (!externalInstanceToken) throw new Error("Evolution API did not return instance token.");

      let pairingCode = this.parsePairingCode(data);
      let qrcodeBase64 = this.parseQr(data);
      if (phoneNumber && !pairingCode) {
        const pairing = await this.requestPairingCode(instanceName, phoneNumber, externalInstanceToken);
        pairingCode = pairing.pairingCode;
        qrcodeBase64 = pairing.qrcodeBase64 || qrcodeBase64;
      }
      return {
        instanceName,
        qrcodeBase64,
        pairingCode,
        externalInstanceToken,
        state: "connecting",
        reused: false,
      };
    } catch (error: any) {
      console.error("Error connecting to Evolution API:", error.response?.data || error.message);
      throw new Error(`Failed to create/connect instance: ${error.message}`);
    }
  }

  async requestPairingCode(instanceName: string, phoneNumber: string, token?: string) {
    const normalized = phoneNumber.replace(/\D/g, "");
    if (normalized.length < 8) throw new Error("A valid phone number is required for pairing code.");
    try {
      const response = await this.api.post(
        `/instance/connect/${instanceName}`,
        { number: normalized },
        { headers: { apikey: token || this.getGlobalApiKey() } },
      );
      return {
        pairingCode: this.parsePairingCode(response.data),
        qrcodeBase64: this.parseQr(response.data),
      };
    } catch (error: any) {
      throw new Error(`Failed to request pairing code: ${error.message}`);
    }
  }

  async getConnectionState(instanceName: string, token: string): Promise<EvolutionConnectionState> {
    try {
      const response = await this.api.get(`/instance/connectionState/${instanceName}`, {
        headers: { apikey: token },
      });
      return this.normalizeState(response.data?.instance?.state || response.data?.state);
    } catch (error: any) {
      if (error.response?.status === 401 || error.response?.status === 403) return "UNAUTHORIZED";
      if (error.response?.status === 404) return "DISCONNECTED";
      throw new Error("Failed to get connection state");
    }
  }

  async disconnectInstance(instanceName: string, token?: string): Promise<boolean> {
    const apiKey = token || this.getGlobalApiKey();
    let loggedOut = false;
    try {
      await this.api.delete(`/instance/logout/${instanceName}`, { headers: { apikey: apiKey } });
      loggedOut = true;
    } catch { /* delete is still attempted */ }
    try {
      await this.api.delete(`/instance/delete/${instanceName}`, { headers: { apikey: apiKey } });
      return true;
    } catch {
      return loggedOut;
    }
  }

  async logout(instanceName: string, token: string): Promise<boolean> {
    return this.disconnectInstance(instanceName, token);
  }

  async fetchGroups(instanceName: string, token: string): Promise<EvolutionGroup[]> {
    try {
      const response = await this.api.get(`/group/fetchAllGroups/${instanceName}?getParticipants=true`, {
        headers: { apikey: token },
      });
      const groups = response.data?.groups || response.data || [];
      return groups.map((group: any) => ({
        id: String(group.id || group.jid),
        subject: String(group.subject || group.name || "Sem nome"),
        participants: Array.isArray(group.participants) ? group.participants.length : Number(group.size || 0),
      }));
    } catch (error: any) {
      throw new Error(`Failed to fetch groups from Evolution API: ${error.message}`);
    }
  }

  async sendGroupMessage(instanceName: string, token: string, groupJid: string, text: string): Promise<string | null> {
    try {
      const response = await this.api.post(`/message/sendText/${instanceName}`, {
        number: groupJid,
        options: { delay: 1200, presence: "composing" },
        textMessage: { text },
      }, { headers: { apikey: token } });
      return response.data?.key?.id || response.data?.message?.key?.id || null;
    } catch (error: any) {
      const status = error.response?.status;
      if (!status || status >= 500 || error.code === "ECONNABORTED") {
        throw new Error("WhatsApp provider response ambiguous");
      }
      throw new Error(`Failed to send message: ${error.message}`);
    }
  }
}
