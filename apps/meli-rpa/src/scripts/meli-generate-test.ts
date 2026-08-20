import * as dotenv from "dotenv";
import * as path from "path";
// We set PLAYWRIGHT_HEADLESS to false so the user can see it
process.env.PLAYWRIGHT_HEADLESS = "false";
dotenv.config({ path: path.join(process.cwd(), ".env") });

import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { RpaService } from "../rpa.service";
import { PrismaService } from "../prisma.service";
import * as readline from "readline";

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const rpaService = app.get(RpaService);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const tenant = await prisma.tenant.findFirst();
    if (!tenant) throw new Error("No tenant found in database");
    const tId = tenant.id;

    console.log(`\n======================================================`);
    console.log(`TESTE DE GERAÇÃO DE LINK - MERCADO LIVRE RPA`);
    console.log(`======================================================\n`);

    const productUrl: string = await new Promise((resolve) => {
      rl.question(
        "Cole UMA URL pública de produto do Mercado Livre:\n> ",
        resolve,
      );
    });

    if (!productUrl || !productUrl.includes("mercadolivre.com.br")) {
      throw new Error(
        `URL inválida. Deve pertencer ao mercadolivre.com.br. Recebido: ${productUrl}`,
      );
    }

    // Extract Item ID if present in the URL
    // ex: /up/MLB3906429796?pdp_filters=item_id%3AMLB4606243003
    let itemId: string | null = null;
    const itemMatch =
      productUrl.match(/item_id(?:%3A|:)(MLB\d+)/i) ||
      productUrl.match(/(MLB\d+)/i);
    if (itemMatch && itemMatch[1]) {
      itemId = itemMatch[1];
    }

    console.log(`\n--- ITEM URL RESOLUTION ---`);
    console.log(`ITEM ID: ${itemId || "NOT_FOUND"}`);

    let officialPermalink = "";

    if (itemId) {
      try {
        const res = await fetch(`https://api.mercadolibre.com/items/${itemId}`);
        console.log(`ITEM API HTTP: ${res.status}`);
        const data = await res.json();

        console.log(`ITEM STATUS: ${data.status || "UNKNOWN"}`);
        if (data.permalink) {
          officialPermalink = data.permalink;
          console.log(`PERMALINK PRESENT: SIM`);
          console.log(`OFFICIAL PERMALINK: ${officialPermalink}`);
          console.log(`PERMALINK HOST: ${new URL(officialPermalink).host}`);
        } else {
          console.log(`PERMALINK PRESENT: NÃO`);
        }
      } catch (err: any) {
        console.log(`API FETCH ERROR: ${err.message}`);
      }
    }

    if (!officialPermalink) {
      console.log(`\nFAIL-CLOSED: ML_ITEM_URL_RESOLUTION_FAILED`);
      console.log(`\n======================================================`);
      console.log(`RESULTADO DA INSPEÇÃO`);
      console.log(`ITEM URL RESOLUTION: FAIL`);
      console.log(`ITEM ID: ${itemId || "NOT_FOUND"}`);
      console.log(`OFFICIAL PERMALINK: NONE`);
      console.log(`RPA CALLED: NÃO`);
      console.log(`GENERATE CLICK COUNT: 0`);
      console.log(`RAW RESULT: NONE`);
      console.log(`AFFILIATE LINK: NONE`);
      console.log(`AFFILIATE LINK HOST: NONE`);
      console.log(`ML_REJECTED_URL: NÃO`);
      console.log(`DATABASE MUTATION: 0`);
      console.log(`PUBLICATIONS: 0`);
      console.log(`WHATSAPP: 0`);
      console.log(`AUTOPILOT: OFF`);
      console.log(`LOCK RELEASED: SIM (Não adquirido)`);
      console.log(
        `VERDICT: Resolução falhou. Falhando fechado antes de chamar o RPA.`,
      );
      console.log(`======================================================\n`);
      return;
    }

    console.log(
      `\n=> Iniciando RPA para gerar link de afiliado usando Official Permalink...`,
    );

    // We pass a dummy offerId and context
    const offerId = "test-offer-id";
    const attributionContext = "TEST-CONTEXT";

    const affiliateUrl = await rpaService.generateAffiliateLink(
      tId,
      offerId,
      officialPermalink,
      attributionContext,
    );

    console.log(`\n======================================================`);
    console.log(`SUCESSO! O Link de Afiliado Gerado foi:`);
    console.log(affiliateUrl);
    console.log(`======================================================\n`);
  } catch (err: any) {
    console.error("\nERROR:", err.message);
  } finally {
    rl.close();
    await app.close();
    process.exit(0);
  }
}

bootstrap();
