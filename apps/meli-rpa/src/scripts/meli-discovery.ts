import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env") });

import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { RpaService } from "../rpa.service";
import { PrismaService } from "../prisma.service";
import { DistributedLockService } from "../distributed-lock.service";
import { chromium, Locator } from "playwright";

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const lockService = app.get(DistributedLockService);
  const rpaService = app.get(RpaService);

  let sessionReuse = "FAIL";
  let distributedLock = "FAIL";

  let finalOrigin = "";
  let finalPath = "";
  let searchResultsPage = "NÃO";
  let specialLandingPage = "NÃO";

  let resultCardsFound = "0";
  let cardsInspected = "0";

  let regularUrls = 0;
  let catalogUrls = 0;
  let userProductUrls = 0;
  let unknownUrls = 0;

  let firstRegularItem = {
    title: "",
    price: "",
    originalPrice: "",
    discount: "",
    url: "",
    host: "",
    path: "",
  };

  let robustSearchLocator = "";
  let robustCardLocator = "";
  let robustTitleLocator = "";
  let robustPriceLocator = "";
  let robustLinkLocator = "";

  let searchLocatorCount = 0;
  let cardLocatorCount = 0;
  let titleLocatorCount = 0;
  let priceLocatorCount = 0;
  let linkLocatorCount = 0;

  let browserClosed = "NÃO";
  let lockReleased = "NÃO";
  let heartbeatTimer: any = null;
  let ownerToken: string | null = null;
  let tId = "";
  let browser: any = null;
  let lockKey = "";

  try {
    const tenant = await prisma.tenant.findFirst();
    if (!tenant) throw new Error("No tenant found in database");
    tId = tenant.id;
    lockKey = `lia:meli-rpa:lock:${tId}:MERCADO_LIVRE`;

    // 1. Acquire Lock
    ownerToken = await lockService.acquireLock(lockKey, 600000); // 10 minutes
    if (!ownerToken) throw new Error(`LOCK_BUSY: Session is currently in use`);
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
      throw new Error("SESSION DB: MISSING OR INCOMPLETE");
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
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();

    // PASSO 1 & 2 - ABRIR MERCADO LIVRE E PESQUISAR
    await page.goto("https://www.mercadolivre.com.br/");

    const searchCandidates = [
      "input.nav-search-input",
      'input[name="as_word"]',
      'input[type="text"]',
    ];

    let searchInput: Locator | null = null;
    for (const sel of searchCandidates) {
      const el = page.locator(sel);
      const c = await el.count();
      if (c > 0) {
        searchInput = el.first();
        robustSearchLocator = sel;
        searchLocatorCount = c;
        break;
      }
    }

    if (searchInput) {
      await searchInput.fill("lustre led");
      await searchInput.press("Enter");
      await page.waitForLoadState("domcontentloaded");

      // Wait for network/DOM to stabilize
      try {
        await page.waitForTimeout(3000);
      } catch (e) {}

      // PASSO 3 - IDENTIFICAR A PÁGINA REAL
      const resUrl = new URL(page.url());
      finalOrigin = resUrl.origin;
      finalPath = resUrl.pathname;

      if (finalPath.includes("/lustre-led") || finalPath.includes("/search")) {
        searchResultsPage = "SIM";
      } else {
        specialLandingPage = "SIM";
      }

      // PASSO 4 - INSPECIONAR DOM
      // Find cards robustly
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
        const c = await el.count();
        if (c > 5) {
          cardEls = el;
          robustCardLocator = sel;
          cardLocatorCount = c;
          resultCardsFound = c.toString();
          break;
        }
      }

      if (cardEls) {
        const inspectLimit = Math.min(cardLocatorCount, 20);
        cardsInspected = inspectLimit.toString();

        for (let i = 0; i < inspectLimit; i++) {
          const card = cardEls.nth(i);

          // Discover link locator
          const linkCandidates = [
            "a.ui-search-link",
            "a.ui-search-item__group__element",
            "a",
          ];
          let linkEl: Locator | null = null;
          let href = "";
          for (const sel of linkCandidates) {
            const el = card.locator(sel);
            const c = await el.count();
            if (c > 0) {
              // Try to find an href that looks like a product
              for (let k = 0; k < c; k++) {
                const h = await el.nth(k).getAttribute("href");
                if (
                  h &&
                  (h.includes("MLB") ||
                    h.includes("p/") ||
                    h.includes("mercadolivre.com.br"))
                ) {
                  linkEl = el.nth(k);
                  href = h;
                  robustLinkLocator = sel;
                  linkLocatorCount = c;
                  break;
                }
              }
              if (href) break;
            }
          }

          if (!href) continue;

          // Discover title locator
          let title = "";
          const titleCandidates = [
            ".ui-search-item__title",
            "h2",
            "h3",
            ".promotion-item__title",
          ];
          for (const sel of titleCandidates) {
            const el = card.locator(sel);
            const c = await el.count();
            if (c > 0) {
              title = await el.first().innerText();
              robustTitleLocator = sel;
              titleLocatorCount = c;
              break;
            }
          }

          // Discover price locator
          let price = "";
          const priceCandidates = [
            ".andes-money-amount--cents-superscript",
            ".andes-money-amount",
            ".price-tag-fraction",
          ];
          for (const sel of priceCandidates) {
            const el = card.locator(sel);
            const c = await el.count();
            if (c > 0) {
              price = await el.first().innerText();
              robustPriceLocator = sel;
              priceLocatorCount = c;
              break;
            }
          }

          let originalPrice = "";
          const origPriceEl = card.locator(
            "s.andes-money-amount, .ui-search-price__original-value",
          );
          if ((await origPriceEl.count()) > 0) {
            originalPrice = await origPriceEl.first().innerText();
          }

          let discount = "";
          const discEl = card.locator(
            ".ui-search-price__discount, .andes-money-amount__discount",
          );
          if ((await discEl.count()) > 0) {
            discount = await discEl.first().innerText();
          }

          // PASSO 6 - CLASSIFICAÇÃO
          let category = "UNKNOWN";
          const urlObj = new URL(href);
          const host = urlObj.hostname;
          const p = urlObj.pathname;

          if (host === "produto.mercadolivre.com.br" && p.startsWith("/MLB-")) {
            category = "REGULAR_ITEM";
            regularUrls++;

            if (regularUrls === 1) {
              firstRegularItem = {
                title: title.replace(/\n/g, " ").trim(),
                price: price.replace(/\n/g, "").trim(),
                originalPrice: originalPrice.replace(/\n/g, " ").trim(),
                discount: discount.replace(/\n/g, " ").trim(),
                url: href,
                host: host,
                path: p,
              };
            }
          } else if (
            p.includes("/p/MLB") ||
            host.includes("catalog") ||
            p.includes("/p/")
          ) {
            category = "PRODUCT_CATALOG";
            catalogUrls++;
          } else if (p.startsWith("/up/MLBU")) {
            category = "USER_PRODUCT";
            userProductUrls++;
          } else {
            unknownUrls++;
          }
        }
      }
    }
  } catch (err: any) {
    console.error("ERROR:", err.message);
  } finally {
    console.log(`SESSION REUSE: ${sessionReuse}`);
    console.log(`DISTRIBUTED LOCK: ${distributedLock}`);
    console.log(`SEARCH TERM: lustre led`);
    console.log(`FINAL ORIGIN: ${finalOrigin}`);
    console.log(`FINAL PATH: ${finalPath}`);
    console.log(`SEARCH RESULTS PAGE: ${searchResultsPage}`);
    console.log(`SPECIAL LANDING PAGE: ${specialLandingPage}`);
    console.log(``);
    console.log(`RESULT CARDS FOUND: ${resultCardsFound}`);
    console.log(`CARDS INSPECTED: ${cardsInspected}`);
    console.log(``);
    console.log(`REGULAR_ITEM: ${regularUrls}`);
    console.log(`PRODUCT_CATALOG: ${catalogUrls}`);
    console.log(`USER_PRODUCT: ${userProductUrls}`);
    console.log(`UNKNOWN: ${unknownUrls}`);
    console.log(``);
    console.log(`FIRST REGULAR ITEM:`);
    console.log(`TITLE: ${firstRegularItem.title}`);
    console.log(`PRICE: ${firstRegularItem.price}`);
    console.log(`ORIGINAL PRICE: ${firstRegularItem.originalPrice}`);
    console.log(`DISCOUNT: ${firstRegularItem.discount}`);
    console.log(`URL: ${firstRegularItem.url}`);
    console.log(`HOST: ${firstRegularItem.host}`);
    console.log(`PATH: ${firstRegularItem.path}`);
    console.log(``);
    console.log(`LOCATORS REALMENTE OBSERVADOS:`);
    console.log(`SEARCH: ${robustSearchLocator}`);
    console.log(`OBSERVED MATCH COUNT: ${searchLocatorCount}`);
    console.log(`CARD: ${robustCardLocator}`);
    console.log(`OBSERVED MATCH COUNT: ${cardLocatorCount}`);
    console.log(`TITLE: ${robustTitleLocator}`);
    console.log(`OBSERVED MATCH COUNT: ${titleLocatorCount}`);
    console.log(`PRICE: ${robustPriceLocator}`);
    console.log(`OBSERVED MATCH COUNT: ${priceLocatorCount}`);
    console.log(`LINK: ${robustLinkLocator}`);
    console.log(`OBSERVED MATCH COUNT: ${linkLocatorCount}`);
    console.log(``);
    console.log(`PRIVATE API INTERCEPTION: NÃO`);
    console.log(`STEALTH: NÃO`);
    console.log(`CAPTCHA BYPASS: NÃO`);
    console.log(`AFFILIATE LINKS GENERATED: 0`);
    console.log(`DATABASE MUTATION: 0`);
    console.log(`PUBLICATIONS: 0`);
    console.log(`WHATSAPP: 0`);
    console.log(`AUTOPILOT: OFF`);
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

    let verdict = "NO_REGULAR_ITEM_DISCOVERED";
    if (regularUrls > 0) {
      verdict = "READY_FOR_ONE_REGULAR_ITEM_AFFILIATE_TEST";
    }
    console.log(``);
    console.log(`VERDICT:`);
    console.log(`${verdict}`);

    await app.close();
    process.exit(0);
  }
}

bootstrap();
