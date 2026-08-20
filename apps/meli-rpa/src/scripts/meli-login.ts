import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env") });

import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { RpaService } from "../rpa.service";
import { PrismaService } from "../prisma.service";
import { DistributedLockService } from "../distributed-lock.service";
import { chromium } from "playwright";
import * as readline from "readline";

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const lockService = app.get(DistributedLockService);
  const rpaService = app.get(RpaService);

  try {
    const tenant = await prisma.tenant.findFirst();
    if (!tenant) throw new Error("No tenant found in database");
    const tId = tenant.id;

    const key = process.env.MELI_RPA_SESSION_ENCRYPTION_KEY;
    if (!key || key.length !== 64)
      throw new Error("Invalid MELI_RPA_SESSION_ENCRYPTION_KEY length");

    // Acquire lock
    const lockKey = `lia:meli-rpa:lock:${tId}:MERCADO_LIVRE`;
    const ownerToken = await lockService.acquireLock(lockKey, 600000); // 10 minutes max for login
    if (!ownerToken) {
      throw new Error(
        `Another process is currently using/locking the Mercado Livre session. Key: ${lockKey}`,
      );
    }

    let heartbeatTimer = setInterval(async () => {
      await lockService.renewLock(lockKey, ownerToken, 600000);
    }, 60000);

    console.log(`=== PRE-FLIGHT OK ===`);
    console.log(`TENANT: ${tId}`);
    console.log(`REDIS: CONNECTED`);
    console.log(`DB: CONNECTED`);

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log(`\n======================================================`);
    console.log(
      `Navegador aberto. Faça login manualmente em mercadolivre.com.br`,
    );
    console.log(`Resolva qualquer confirmação/2FA no navegador.`);
    console.log(`======================================================\n`);

    await page.goto("https://www.mercadolivre.com.br");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log("=> AGUARDANDO CONFIRMAÇÃO...");
    console.log(
      "=> Pressione ENTER neste terminal (ou envie um comando) quando terminar o login e a página estabilizar.",
    );

    await new Promise((resolve) => rl.question("", resolve));
    rl.close();

    console.log("Capturando estado da sessão em RAM...");
    const storageState = await context.storageState();
    const stateStr = JSON.stringify(storageState);

    // Encrypt
    const { encryptedData, ivHex, authTagHex } = (
      rpaService as any
    ).encryptStorageState(stateStr);

    await prisma.marketplaceBrowserSession.upsert({
      where: {
        tenantId_provider: { tenantId: tId, provider: "MERCADO_LIVRE" },
      },
      create: {
        tenantId: tId,
        provider: "MERCADO_LIVRE",
        status: "CONNECTED",
        encryptedStorageState: encryptedData,
        iv: ivHex,
        authTag: authTagHex,
      },
      update: {
        status: "CONNECTED",
        encryptedStorageState: encryptedData,
        iv: ivHex,
        authTag: authTagHex,
        lastUsedAt: new Date(),
      },
    });

    console.log(`\n=== SESSÃO SALVA NO BANCO ===`);

    clearInterval(heartbeatTimer);
    await lockService.releaseLock(lockKey, ownerToken);
    await browser.close();

    console.log(`Lock liberado. Navegador fechado.`);
    console.log(`=== FIM ===`);
  } catch (err: any) {
    console.error("ERROR:", err.message);
  } finally {
    await app.close();
    process.exit(0);
  }
}

bootstrap();
