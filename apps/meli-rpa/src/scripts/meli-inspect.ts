import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env") });

import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { RpaService } from "../rpa.service";
import { PrismaService } from "../prisma.service";
import { DistributedLockService } from "../distributed-lock.service";
import { chromium, Locator } from "playwright";
import * as readline from "readline";

async function checkElementDetails(
  page: any,
  query: string,
  roleName?: RegExp,
): Promise<any> {
  try {
    const locators = await page.locator(query);
    const count = await locators.count();

    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const el = locators.nth(i);
        if (await el.isVisible()) {
          const details = await el.evaluate((node: any) => {
            return {
              tagName: node.tagName.toLowerCase(),
              id: node.id || "NONE",
              type: node.getAttribute("type") || "NONE",
              role: node.getAttribute("role") || "NONE",
              label: node.getAttribute("aria-label") || "NONE",
              placeholder: node.getAttribute("placeholder") || "NONE",
              readonly: node.hasAttribute("readonly"),
              disabled: node.hasAttribute("disabled"),
              visible: true,
              outerHTMLSnippet:
                node.outerHTML.substring(0, 100).replace(/\n/g, "") + "...",
            };
          });
          return details;
        }
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const lockService = app.get(DistributedLockService);
  const rpaService = app.get(RpaService);

  try {
    const tenant = await prisma.tenant.findFirst();
    if (!tenant) throw new Error("No tenant found in database");
    const tId = tenant.id;

    console.log(`=== STARTING INSPECTION PRE-FLIGHT ===`);

    // 1. Acquire Lock
    const lockKey = `lia:meli-rpa:lock:${tId}:MERCADO_LIVRE`;
    const ownerToken = await lockService.acquireLock(lockKey, 600000); // 10 minutes
    if (!ownerToken) {
      throw new Error(`LOCK_BUSY: Session is currently in use`);
    }

    let heartbeatTimer = setInterval(async () => {
      await lockService.renewLock(lockKey, ownerToken, 600000);
    }, 60000);

    // 2. Fetch Session
    const session = await prisma.marketplaceBrowserSession.findUnique({
      where: {
        tenantId_provider: { tenantId: tId, provider: "MERCADO_LIVRE" },
      },
    });

    if (
      !session ||
      !session.encryptedStorageState ||
      !session.iv ||
      !session.authTag
    ) {
      throw new Error("SESSION DB: MISSING OR INCOMPLETE");
    }
    console.log(`[x] SESSION DB: FOUND`);

    // 3. Decrypt
    let storageState: any;
    try {
      const decrypted = (rpaService as any).decryptStorageState(
        session.encryptedStorageState,
        session.iv,
        session.authTag,
      );
      storageState = JSON.parse(decrypted);
      console.log(`[x] DECRYPT: PASS`);
    } catch (e: any) {
      console.log(`[ ] DECRYPT: FAIL`);
      throw e;
    }

    // 4. Open Browser
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();

    console.log(`\n======================================================`);
    console.log(`Acessando Mercado Livre para validar a sessão...`);
    console.log(`======================================================\n`);

    // 5. Navigate to Home
    await page.goto("https://www.mercadolivre.com.br");

    // Simple heuristic to guess if we are logged in: look for user avatar or name, or absence of "Entrar" link
    // But we will let the user verify
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log(
      "=> A página abriu. Verifique no navegador se você CONTINUA AUTENTICADO.",
    );
    console.log(
      "=> Navegue manualmente até a Central de Afiliados e encontre a tela do Gerador de Links.",
    );
    console.log(
      "=> QUANDO O GERADOR DE LINKS ESTIVER VISÍVEL NA TELA, pressione ENTER.",
    );

    await new Promise((resolve) => rl.question("", resolve));
    rl.close();

    console.log("\n=== INICIANDO INSPEÇÃO DO DOM SOMENTE-LEITURA ===");

    const productInput = await checkElementDetails(
      page,
      'textarea[id^="url"], input[type="url"], input[placeholder*="http"]',
    );
    const generateBtn = await checkElementDetails(
      page,
      'button:has-text("Gerar"), button:has-text("Criar")',
    );
    const resultInput = await checkElementDetails(page, "input[readonly]");
    const copyBtn = await checkElementDetails(
      page,
      'button:has-text("Copiar")',
    );

    // Etiqueta
    const hasEtiquetaText =
      (await page.locator("text=Etiqueta, text=Etiquetas").count()) > 0;

    console.log(`\n=== RELATÓRIO FINAL ===`);

    // Check URL safely
    const currentUrlObj = new URL(page.url());
    const origin = currentUrlObj.origin;
    const pathname = currentUrlObj.pathname;
    const loginRequestedAgain = currentUrlObj.pathname.includes("login")
      ? "SIM"
      : "NÃO";
    const sessionReuse = currentUrlObj.pathname.includes("login")
      ? "FAIL"
      : "PASS";

    console.log(`SESSION REUSE: ${sessionReuse}`);
    console.log(`GENERATOR ORIGIN: ${origin}`);
    console.log(`GENERATOR PATH: ${pathname}`);

    if (productInput) {
      console.log(
        `PRODUCT INPUT LOCATOR CANDIDATE: <${productInput.tagName} id="${productInput.id}"> (role: ${productInput.role}, placeholder: ${productInput.placeholder}, readonly: ${productInput.readonly}, visible: ${productInput.visible})`,
      );
    } else {
      console.log(`PRODUCT INPUT LOCATOR CANDIDATE: NOT_FOUND`);
    }

    if (generateBtn) {
      console.log(
        `GENERATE BUTTON LOCATOR CANDIDATE: <${generateBtn.tagName} id="${generateBtn.id}"> (type: ${generateBtn.type}, role: ${generateBtn.role}, disabled: ${generateBtn.disabled}, label: ${generateBtn.label})`,
      );
    } else {
      console.log(`GENERATE BUTTON LOCATOR CANDIDATE: NOT_FOUND`);
    }

    if (resultInput) {
      console.log(
        `RESULT ELEMENT TYPE: <${resultInput.tagName} type="${resultInput.type}" readonly="${resultInput.readonly}" visible="${resultInput.visible}">`,
      );
    } else {
      console.log(
        `RESULT ELEMENT TYPE: NOT_FOUND (RESULT DOM REQUIRES GENERATION)`,
      );
    }

    if (copyBtn) {
      console.log(`COPY BUTTON: FOUND <${copyBtn.tagName} id="${copyBtn.id}">`);
    } else {
      console.log(`COPY BUTTON: NOT_FOUND (RESULT DOM REQUIRES GENERATION)`);
    }

    if (!resultInput && !copyBtn) {
      console.log(`RESULT DOM REQUIRES GENERATION: SIM`);
    } else {
      console.log(`RESULT DOM REQUIRES GENERATION: NÃO`);
    }

    console.log(
      `ETIQUETA NO GERADOR: ${hasEtiquetaText ? "FOUND" : "NOT_FOUND"}`,
    );

    console.log(`DATABASE MUTATION: 0`);
    console.log(`AFFILIATE LINKS GENERATED: 0`);
    console.log(`PUBLICATIONS: 0`);
    console.log(`WHATSAPP: 0`);

    clearInterval(heartbeatTimer);
    await lockService.releaseLock(lockKey, ownerToken);
    console.log(`LOCK RELEASED: PASS`);

    await browser.close();
    console.log(`BROWSER CLOSED: PASS`);

    console.log(`\n=== FIM ===`);
  } catch (err: any) {
    console.error("ERROR:", err.message);
  } finally {
    await app.close();
    process.exit(0);
  }
}

bootstrap();
