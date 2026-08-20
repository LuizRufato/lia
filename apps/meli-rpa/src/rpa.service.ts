import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { chromium, BrowserContext, Page } from "playwright";
import * as crypto from "crypto";
import {
  DistributedLockService,
  LockLostError,
} from "./distributed-lock.service";
import { MeliAffiliatePageDriver } from "./meli-affiliate-page.driver";

@Injectable()
export class RpaService {
  private readonly logger = new Logger(RpaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lockService: DistributedLockService,
  ) {}

  private getEncryptionKey(): Buffer {
    const keyStr = process.env.MELI_RPA_SESSION_ENCRYPTION_KEY;
    if (!keyStr || keyStr.length !== 64) {
      throw new Error(
        "MELI_RPA_SESSION_ENCRYPTION_KEY is missing or not 64 hex characters",
      );
    }
    return Buffer.from(keyStr, "hex");
  }

  private decryptStorageState(
    encryptedData: string,
    ivHex: string,
    authTagHex: string,
  ): string {
    const key = this.getEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  private encryptStorageState(stateJson: string): {
    encryptedData: string;
    ivHex: string;
    authTagHex: string;
  } {
    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    let encrypted = cipher.update(stateJson, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();
    return {
      encryptedData: encrypted,
      ivHex: iv.toString("hex"),
      authTagHex: authTag.toString("hex"),
    };
  }

  async generateAffiliateLink(
    tenantId: string,
    offerId: string,
    productUrl: string,
    attributionContext: string,
  ): Promise<string> {
    this.logger.log(`Starting RPA for tenant ${tenantId}, offer ${offerId}`);

    // 0. Acquire Distributed Lock
    // tenantId + provider + browserSession is scoped to just the tenant and provider, since there is only one session per tenant+provider.
    const lockKey = `lia:meli-rpa:lock:${tenantId}:MERCADO_LIVRE`;
    const lockTtlMs = 120000; // 120 seconds
    const heartbeatIntervalMs = 30000; // 30 seconds

    const ownerToken = await this.lockService.acquireLock(lockKey, lockTtlMs);
    if (!ownerToken) {
      throw new Error(
        `LOCK_BUSY: Another instance is currently using the Mercado Livre session for tenant ${tenantId}`,
      );
    }

    let heartbeatTimer: NodeJS.Timeout | null = null;
    let lockLost = false;

    // Start heartbeat
    heartbeatTimer = setInterval(async () => {
      try {
        const renewed = await this.lockService.renewLock(
          lockKey,
          ownerToken,
          lockTtlMs,
        );
        if (!renewed) {
          this.logger.error(`HEARTBEAT FAILED: Lock lost for ${lockKey}`);
          lockLost = true;
        }
      } catch (err) {
        this.logger.error(`Error during lock renewal for ${lockKey}`, err);
      }
    }, heartbeatIntervalMs);

    const checkLock = () => {
      if (lockLost)
        throw new LockLostError(
          `Ownership of ${lockKey} was lost during execution`,
        );
    };

    let browser: any = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let session: any = null;

    try {
      // 1. Fetch Session
      session = await this.prisma.marketplaceBrowserSession.findUnique({
        where: { tenantId_provider: { tenantId, provider: "MERCADO_LIVRE" } },
      });

      if (
        !session ||
        !session.encryptedStorageState ||
        !session.iv ||
        !session.authTag
      ) {
        throw new Error(
          "REAUTH_REQUIRED: No valid session found for this tenant",
        );
      }

      if (
        session.status === "REAUTH_REQUIRED" ||
        session.status === "CHALLENGE_REQUIRED"
      ) {
        throw new Error(`${session.status}: Session is locked`);
      }

      // 2. Decrypt Storage State
      const storageStateStr = this.decryptStorageState(
        session.encryptedStorageState,
        session.iv,
        session.authTag,
      );
      const storageStateObj = JSON.parse(storageStateStr);

      // 3. Open Browser
      checkLock();
      const isHeadless = process.env.PLAYWRIGHT_HEADLESS !== "false";
      browser = await chromium.launch({ headless: isHeadless });

      try {
        // Criar novo context isolado
        context = await browser.newContext({
          storageState: storageStateObj,
          permissions: ["clipboard-read", "clipboard-write"],
        });
        page = await context!.newPage();

        this.logger.log(
          `Navigating to Meli Affiliate Central for product: ${productUrl}`,
        );
        const driver = new MeliAffiliatePageDriver(page!);

        checkLock();
        await driver.navigateToGenerator();

        checkLock();
        // Nota Arquitetural: Não passaremos attributionContext pois ML não tem "Etiqueta" nativa na tela de gerador no momento.
        // Se tentarmos concatenar manualmente podemos quebrar tracking nativo (DEC-003).
        const affiliateUrl = await driver.generateLink(productUrl);

        this.logger.log(`Successfully generated link: ${affiliateUrl}`);

        return affiliateUrl;
      } catch (innerErr) {
        throw innerErr;
      }
    } catch (e: any) {
      this.logger.error(`RPA Failed: ${e.message}`);
      if (session) {
        await this.prisma.marketplaceBrowserSession.update({
          where: { id: session.id },
          data: {
            status: "ERROR",
            lastErrorAt: new Date(),
            lastErrorSanitized: e.message,
          },
        });
      }
      throw e;
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);

      if (context && session && !lockLost) {
        try {
          // Save back state securely just in case cookies were refreshed
          const newState = await context.storageState();
          const { encryptedData, ivHex, authTagHex } = this.encryptStorageState(
            JSON.stringify(newState),
          );
          await this.prisma.marketplaceBrowserSession.update({
            where: { id: session.id },
            data: {
              encryptedStorageState: encryptedData,
              iv: ivHex,
              authTag: authTagHex,
              lastUsedAt: new Date(),
            },
          });
        } catch (saveErr) {
          this.logger.error(
            "Failed to save browser state on teardown",
            saveErr,
          );
        }
      }

      if (browser) {
        try {
          await browser.close();
        } catch (e) {}
      }

      await this.lockService.releaseLock(lockKey, ownerToken);
    }
  }
}
