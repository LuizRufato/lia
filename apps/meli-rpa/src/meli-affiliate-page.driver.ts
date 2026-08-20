import { Page, Locator } from "playwright";

export class MeliAffiliatePageDriver {
  private readonly baseUrl =
    "https://www.mercadolivre.com.br/afiliados/linkbuilder";

  constructor(private readonly page: Page) {}

  async navigateToGenerator(): Promise<void> {
    await this.page.goto(this.baseUrl, { waitUntil: "domcontentloaded" });
  }

  async generateLink(productUrl: string): Promise<string> {
    console.log(`\n--- INICIANDO GERAÇÃO (DIAGNÓSTICO) ---`);
    const currentUrlObj = new URL(this.page.url());
    console.log(
      `CURRENT ORIGIN + PATH: ${currentUrlObj.origin}${currentUrlObj.pathname}`,
    );
    console.log(
      `SESSION AUTHENTICATED: ${currentUrlObj.pathname.includes("login") ? "NÃO" : "SIM"}`,
    );
    console.log(
      `GENERATOR PAGE: ${currentUrlObj.pathname.includes("/afiliados/linkbuilder") ? "SIM" : "NÃO"}`,
    );

    const productInput = this.page
      .locator('textarea[id^="url"], textarea[placeholder*="mercadolivre.com"]')
      .first();
    const isVisible = await productInput.isVisible();
    console.log(`TEXTAREA VISIBLE: ${isVisible ? "SIM" : "NÃO"}`);

    if (!isVisible) {
      throw new Error("FAIL-CLOSED: Textarea not visible.");
    }

    const isDisabled = await productInput.isDisabled();
    console.log(`TEXTAREA ENABLED: ${!isDisabled ? "SIM" : "NÃO"}`);

    // Fill the URL with real keyboard interaction
    await productInput.click();
    await productInput.press("Control+A");
    await productInput.press("Backspace");
    await productInput.pressSequentially(productUrl, { delay: 50 });
    await productInput.press("Tab");

    // Check if the value was actually set
    const val = await productInput.inputValue();
    console.log(`TEXTAREA VALUE SET: ${val === productUrl ? "SIM" : "NÃO"}`);
    console.log(`TEXTAREA INPUT METHOD: pressSequentially`);

    // Look for validation errors
    await this.page.waitForTimeout(1000);
    const validationMessage = this.page
      .locator(".andes-form-control__message")
      .first();
    const valVisible = await validationMessage.isVisible();
    if (valVisible) {
      const msg = await validationMessage.textContent();
      throw new Error(`FAIL-CLOSED: UI Validation error: ${msg}`);
    }

    // Wait for the generate button to become enabled
    const generateBtn = this.page
      .getByRole("button", { name: /^Gerar$|^Criar$/i })
      .first();

    try {
      // Wait for it to not have the disabled attribute
      await this.page.waitForFunction(
        (btn) => btn && !btn.hasAttribute("disabled"),
        await generateBtn.elementHandle(),
        { timeout: 15000 },
      );
      console.log(`GENERATE BUTTON ENABLED: SIM`);
    } catch (e) {
      console.log(`GENERATE BUTTON ENABLED: NÃO`);
      throw new Error(
        "FAIL-CLOSED: Generate button remained disabled after filling URL.",
      );
    }

    console.log(`GENERATE CLICK COUNT: 1`);
    await generateBtn.click();

    // 5. Aguardar o resultado e procurar heuristicamente
    // The result might be an input[readonly], a link, or a text area.
    console.log(`\n--- BUSCA HEURÍSTICA DE RESULTADO ---`);
    let generatedUrl = "";
    let resultTag = "NOT_FOUND";
    let copyButtonFound = "NÃO";

    try {
      // Wait for the UI to update
      await this.page.waitForTimeout(3000);

      const copyBtn = this.page
        .getByRole("button", { name: /Copiar/i })
        .first();

      if (await copyBtn.isVisible()) {
        copyButtonFound = "SIM";
        console.log(`COPY BUTTON TEXT: ${await copyBtn.textContent()}`);
        console.log(
          `COPY BUTTON ARIA-LABEL: ${await copyBtn.getAttribute("aria-label")}`,
        );

        // Evaluate DOM near the copy button
        const resultInfo = await copyBtn.evaluate((btn) => {
          let current: HTMLElement | null = btn.parentElement;

          // Climb up up to 3 levels to find a container
          for (let i = 0; i < 3; i++) {
            if (current && current.tagName.toLowerCase() !== "section") {
              if (current.parentElement) current = current.parentElement;
            }
          }

          const result: any = {
            containerTag: current ? current.tagName.toLowerCase() : "NOT_FOUND",
            containerClass: current ? current.className : "",
            descendants: [],
          };

          if (current) {
            const descendants = current.querySelectorAll("*");
            for (const desc of Array.from(descendants)) {
              result.descendants.push({
                tag: desc.tagName.toLowerCase(),
                className: desc.className,
                innerText: (desc as HTMLElement).innerText
                  ? (desc as HTMLElement).innerText.trim()
                  : "",
                textContent: desc.textContent ? desc.textContent.trim() : "",
                value: (desc as HTMLInputElement).value || "",
                href: (desc as HTMLAnchorElement).href || "",
              });
            }
          }
          return result;
        });

        console.log(`\n--- DOM INSPECTION RESULT ---`);
        console.log(`RESULT CONTAINER TAG: ${resultInfo.containerTag}`);
        console.log(
          `RESULT CONTAINER CLASS NAMES: ${resultInfo.containerClass}`,
        );
        console.log(
          `DESCENDANTS: ${JSON.stringify(resultInfo.descendants, null, 2)}`,
        );

        console.log(`\n--- FALLBACK PARA CLIPBOARD ---`);
        await copyBtn.click();
        console.log(`COPY CLICK COUNT: 1`);
        // Give it a tiny bit of time for clipboard operation
        await this.page.waitForTimeout(500);

        try {
          const rawClipboard = await this.page.evaluate(() =>
            navigator.clipboard.readText(),
          );
          console.log(`CLIPBOARD_ACCESS: PASS`);

          const clipboardTrimmed = rawClipboard ? rawClipboard.trim() : "";
          const jsonEscaped = JSON.stringify(rawClipboard);

          console.log(
            `CLIPBOARD LENGTH: ${rawClipboard ? rawClipboard.length : 0}`,
          );
          console.log(`CLIPBOARD JSON ESCAPED: ${jsonEscaped}`);
          console.log(`CLIPBOARD TRIMMED VALUE: ${clipboardTrimmed}`);

          const hasHttps = clipboardTrimmed.startsWith("https://");
          const hasHttp = clipboardTrimmed.startsWith("http://");
          const looksLikeHostPath =
            !hasHttps &&
            !hasHttp &&
            clipboardTrimmed.includes("/") &&
            clipboardTrimmed.includes(".");

          let parseable = "NÃO";
          try {
            new URL(clipboardTrimmed);
            parseable = "SIM";
          } catch (e) {
            // Not parseable as absolute URL
          }

          console.log(`HAS HTTPS SCHEME: ${hasHttps ? "SIM" : "NÃO"}`);
          console.log(`HAS HTTP SCHEME: ${hasHttp ? "SIM" : "NÃO"}`);
          console.log(
            `LOOKS LIKE HOST_PATH: ${looksLikeHostPath ? "SIM" : "NÃO"}`,
          );
          console.log(`PARSEABLE_AS_ABSOLUTE_URL: ${parseable}`);
          console.log(`RAW VALUE: ${clipboardTrimmed}`);

          generatedUrl = clipboardTrimmed;
          resultTag = "CLIPBOARD";
        } catch (e: any) {
          console.log(`CLIPBOARD_ACCESS: DENIED - ${e.message}`);
        }
      }
    } catch (e) {
      console.log("Error during result search:", e);
    }

    if (!generatedUrl) {
      throw new Error(
        `FAIL-CLOSED: Generated link not found or invalid. URL: ${generatedUrl}`,
      );
    }

    if (
      generatedUrl.includes("Este URL não é permitido pelo Programa") ||
      generatedUrl.includes("⚠️")
    ) {
      throw new Error(`ML_REJECTED_URL: ${generatedUrl}`);
    }

    return generatedUrl;
  }
}
