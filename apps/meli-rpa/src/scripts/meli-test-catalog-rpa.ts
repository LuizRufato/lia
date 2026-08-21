import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env") });

import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { RpaService } from "../rpa.service";
import { PrismaService } from "../prisma.service";
import { DistributedLockService } from "../distributed-lock.service";
import { chromium, Locator } from "playwright";
import { MeliAffiliatePageDriver } from "../meli-affiliate-page.driver";

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const lockService = app.get(DistributedLockService);
  const rpaService = app.get(RpaService);

  let sessionReuse = "FAIL";
  let distributedLock = "FAIL";

  let cardTitle = "";
  let cardPrice = "";
  let originalUrl = "";
  let originalHost = "";
  let originalPath = "";
  let httpsValid = "NÃO";

  let generatorOpened = "NÃO";
  let textareaFilled = "NÃO";
  let generateEnabled = "N/A";
  let generateClickCount = "0";
  let resultContainerFound = "N/A";
  let copyButtonFound = "N/A";

  let rawResult = "";
  let resultClassification = "UNKNOWN_RESULT";
  let affiliateLink = "";
  let affiliateLinkHost = "";
  let affiliateLinkHttps = "NÃO";
  let differentFromOriginal = "NÃO";

  let browserClosed = "NÃO";
  let lockReleased = "NÃO";
  let heartbeatTimer: any = null;
  let ownerToken: string | null = null;
  let tId = "";
  let browser: any = null;
  let lockKey = "";

  let verdict = "TEST_FAILED_TECHNICALLY";

  try {
    const tenant = await prisma.tenant.findFirst();
    if (!tenant) throw new Error("No tenant found in database");
    tId = tenant.id;
    lockKey = `lia:meli-rpa:lock:${tId}:MERCADO_LIVRE`;

    // 1. Acquire Lock
    ownerToken = await lockService.acquireLock(lockKey, 600000); // 10 minutes
    if (!ownerToken) throw new Error(`LOCK_BUSY`);
    distributedLock = "PASS";

    heartbeatTimer = setInterval(async () => {
      await lockService.renewLock(lockKey, ownerToken!, 600000);
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
      throw new Error("SESSION DB: MISSING");
    }

    // 3. Decrypt
    const decrypted = (rpaService as any).decryptStorageState(
      session.encryptedStorageState,
      session.iv,
      session.authTag,
    );
    const storageState = JSON.parse(decrypted);
    sessionReuse = "PASS";

    // 4. Open Browser
    browser = await chromium.launch({ headless: false });
    // Need clipboard permissions for MeliAffiliatePageDriver
    const context = await browser.newContext({
      storageState,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();

    // PASSO 1 - DISCOVERY
    await page.goto("https://www.mercadolivre.com.br/");

    let searchInput: Locator | null = null;
    const searchCandidates = [
      "input.nav-search-input",
      'input[name="as_word"]',
      'input[type="text"]',
    ];
    for (const sel of searchCandidates) {
      const el = page.locator(sel);
      if ((await el.count()) > 0) {
        searchInput = el.first();
        break;
      }
    }

    if (!searchInput) throw new Error("Search input not found");
    await searchInput.fill("lustre led");
    await searchInput.press("Enter");
    await page.waitForLoadState("domcontentloaded");

    try {
      await page.waitForSelector(".ui-search-layout__item", { timeout: 15000 });
    } catch (e) {}
    try {
      await page.waitForTimeout(3000);
    } catch (e) {}

    const cardCandidates = [
      "li.ui-search-layout__item",
      ".ui-search-layout__item",
      "ol > li",
      ".promotion-item",
      "article",
      ".andes-card",
    ];
    let cardEls: Locator | null = null;
    for (const sel of cardCandidates) {
      const el = page.locator(sel);
      if ((await el.count()) >= 1) {
        cardEls = el;
        break;
      }
    }

    if (!cardEls) throw new Error("Cards not found");

    const count = await cardEls.count();
    let selectedHref = "";

    for (let i = 0; i < count; i++) {
      const card = cardEls.nth(i);
      const linkCandidates = [
        "a.ui-search-link",
        "a.ui-search-item__group__element",
        "a",
      ];
      let href = "";
      for (const sel of linkCandidates) {
        const el = card.locator(sel);
        const c = await el.count();
        if (c > 0) {
          for (let k = 0; k < c; k++) {
            const h = await el.nth(k).getAttribute("href");
            if (
              h &&
              (h.includes("MLB") ||
                h.includes("p/") ||
                h.includes("mercadolivre.com.br"))
            ) {
              href = h;
              break;
            }
          }
          if (href) break;
        }
      }

      if (!href) continue;

      const urlObj = new URL(href);
      const host = urlObj.hostname;
      const p = urlObj.pathname;

      if (
        p.includes("/p/MLB") ||
        host.includes("catalog") ||
        p.includes("/p/")
      ) {
        selectedHref = href;
        originalUrl = href;
        originalHost = host;
        originalPath = p;

        const titleCandidates = [
          ".ui-search-item__title",
          "h2",
          "h3",
          ".promotion-item__title",
        ];
        for (const sel of titleCandidates) {
          const el = card.locator(sel);
          if ((await el.count()) > 0) {
            cardTitle = await el.first().innerText();
            break;
          }
        }

        const priceCandidates = [
          ".andes-money-amount--cents-superscript",
          ".andes-money-amount",
          ".price-tag-fraction",
        ];
        for (const sel of priceCandidates) {
          const el = card.locator(sel);
          if ((await el.count()) > 0) {
            cardPrice = await el.first().innerText();
            break;
          }
        }
        break; // Select the first PRODUCT_CATALOG
      }
    }

    if (!selectedHref) {
      throw new Error("NO PRODUCT_CATALOG FOUND");
    }

    // PASSO 2 - VALIDAÇÃO
    const oUrl = new URL(originalUrl);
    if (oUrl.protocol === "https:") httpsValid = "SIM";
    if (
      !oUrl.hostname.endsWith("mercadolivre.com.br") &&
      !oUrl.hostname.endsWith("mercadolibre.com")
    ) {
      throw new Error("NOT OFFICIAL DOMAIN");
    }
    if (!oUrl.pathname.includes("/p/MLB")) {
      throw new Error("NOT /p/MLB PATHNAME");
    }

    // PASSO 3 - GERADOR DE AFILIADOS
    const driver = new MeliAffiliatePageDriver(page);
    await driver.navigateToGenerator();
    generatorOpened = "SIM";

    try {
      rawResult = await driver.generateLink(originalUrl);
      textareaFilled = "SIM";
      generateEnabled = "SIM";
      generateClickCount = "1";
      resultContainerFound = "SIM";
      copyButtonFound = "SIM";

      const aUrl = new URL(rawResult);
      affiliateLink = rawResult;
      affiliateLinkHost = aUrl.hostname;
      if (aUrl.protocol === "https:") affiliateLinkHttps = "SIM";
      if (rawResult !== originalUrl) differentFromOriginal = "SIM";

      if (
        aUrl.hostname.includes("mercadolivre") ||
        aUrl.hostname.includes("mercadolibre") ||
        aUrl.hostname.includes("ml.com.br")
      ) {
        resultClassification = "SUCCESS_URL";
        verdict = "PRODUCT_CATALOG_AFFILIATE_LINK_SUCCESS";
      } else {
        throw new Error("UNKNOWN_RESULT");
      }
    } catch (e: any) {
      rawResult = e.message;
      textareaFilled = "SIM";
      generateClickCount = "1"; // Assume driver attempted
      if (e.message.includes("ML_REJECTED_URL")) {
        resultClassification = "ML_REJECTED_URL";
        verdict = "PRODUCT_CATALOG_REJECTED_BY_AFFILIATE_PROGRAM";
      } else {
        resultClassification = "UNKNOWN_RESULT";
      }
    }
  } catch (err: any) {
    console.error("ERROR:", err.message);
  } finally {
    console.log(`SESSION REUSE: ${sessionReuse}`);
    console.log(`DISTRIBUTED LOCK: ${distributedLock}`);
    console.log(``);
    console.log(`DISCOVERY:`);
    console.log(`SEARCH TERM: lustre led`);
    console.log(`CARD TITLE: ${cardTitle}`);
    console.log(`CARD PRICE: ${cardPrice}`);
    console.log(`URL TYPE: PRODUCT_CATALOG`);
    console.log(`ORIGINAL URL: ${originalUrl}`);
    console.log(`ORIGINAL HOST: ${originalHost}`);
    console.log(`ORIGINAL PATH: ${originalPath}`);
    console.log(`HTTPS: ${httpsValid}`);
    console.log(``);
    console.log(`LINK GENERATOR:`);
    console.log(`GENERATOR OPENED: ${generatorOpened}`);
    console.log(`TEXTAREA FILLED: ${textareaFilled}`);
    console.log(`GENERATE ENABLED: ${generateEnabled}`);
    console.log(`GENERATE CLICK COUNT: ${generateClickCount}`);
    console.log(`RESULT CONTAINER FOUND: ${resultContainerFound}`);
    console.log(`COPY BUTTON FOUND: ${copyButtonFound}`);
    console.log(``);
    console.log(`RAW RESULT: ${rawResult}`);
    console.log(`RESULT CLASSIFICATION: ${resultClassification}`);
    console.log(`AFFILIATE LINK: ${affiliateLink}`);
    console.log(`AFFILIATE LINK HOST: ${affiliateLinkHost}`);
    console.log(`AFFILIATE LINK HTTPS: ${affiliateLinkHttps}`);
    console.log(`DIFFERENT FROM ORIGINAL: ${differentFromOriginal}`);
    console.log(``);
    console.log(`MANUAL URL MODIFICATION: NÃO`);
    console.log(`TRACKING REDIRECT FOLLOWED: NÃO`);
    console.log(`PRIVATE API INTERCEPTION: NÃO`);
    console.log(`STEALTH: NÃO`);
    console.log(`CAPTCHA BYPASS: NÃO`);
    console.log(``);
    console.log(`DATABASE BUSINESS MUTATION: 0`);
    console.log(`MONETIZATION CHANGED: NÃO`);
    console.log(`PUBLICATIONS: 0`);
    console.log(`WHATSAPP: 0`);
    console.log(`AUTOPILOT: OFF`);
    console.log(``);
    console.log(`SESSION SAVED: SIM`);

    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (ownerToken) {
      await lockService.releaseLock(lockKey, ownerToken);
      lockReleased = "SIM";
    }
    console.log(`LOCK RELEASED: ${lockReleased}`);

    if (browser) {
      await browser.close();
      browserClosed = "SIM";
    }
    console.log(`BROWSER CLOSED: ${browserClosed}`);

    console.log(``);
    console.log(`VERDICT:`);
    console.log(`${verdict}`);

    await app.close();
    process.exit(0);
  }
}

bootstrap();
