import { MeliAffiliatePageDriver } from "./meli-affiliate-page.driver";
import { Page, Locator } from "playwright";

describe("MeliAffiliatePageDriver", () => {
  let driver: MeliAffiliatePageDriver;
  let mockPage: jest.Mocked<Page>;
  let mockLocator: any;

  beforeEach(() => {
    mockLocator = {
      first: jest.fn().mockReturnThis(),
      last: jest.fn().mockReturnThis(),
      isVisible: jest.fn().mockResolvedValue(true),
      isDisabled: jest.fn().mockResolvedValue(false),
      fill: jest.fn().mockResolvedValue(undefined),
      press: jest.fn().mockResolvedValue(undefined),
      pressSequentially: jest.fn().mockResolvedValue(undefined),
      inputValue: jest
        .fn()
        .mockResolvedValue("https://www.mercadolivre.com.br/sec/mock"),
      textContent: jest.fn().mockResolvedValue("Gerar"),
      click: jest.fn().mockResolvedValue(undefined),
      waitFor: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn().mockResolvedValue({
        resultContainerTag: "div",
        resultContainerClasses: "andes-clipboard",
        urlTextElementTag: "span",
        urlTextElementClass: "text",
        urlSource: "textContent",
        urlFound: "SIM",
        extractedUrl: "https://www.mercadolivre.com.br/sec/mock",
      }),
      getAttribute: jest.fn().mockResolvedValue("Copiar link"),
      count: jest.fn().mockResolvedValue(1),
      nth: jest.fn().mockReturnThis(),
      elementHandle: jest.fn().mockResolvedValue({}),
    };

    mockPage = {
      url: jest
        .fn()
        .mockReturnValue(
          "https://www.mercadolivre.com.br/afiliados/linkbuilder",
        ),
      goto: jest.fn().mockResolvedValue(null),
      locator: jest.fn().mockReturnValue(mockLocator),
      getByRole: jest.fn().mockReturnValue(mockLocator),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForFunction: jest.fn().mockResolvedValue(undefined),
    } as any;

    driver = new MeliAffiliatePageDriver(mockPage);
  });

  it("A) textarea aceita URL + botão habilita", async () => {
    // validation message not visible
    mockLocator.isVisible.mockImplementationOnce(async () => true); // textarea
    mockLocator.isDisabled.mockImplementationOnce(async () => false); // textarea
    mockLocator.isVisible.mockImplementationOnce(async () => false); // validation msg
    mockLocator.isVisible.mockImplementationOnce(async () => true); // btn visible
    mockLocator.isDisabled.mockImplementationOnce(async () => false); // btn disabled? -> false

    const url = await driver.generateLink(
      "https://produto.mercadolivre.com.br/item",
    );
    expect(url).toBe("https://www.mercadolivre.com.br/sec/mock");
    expect(mockLocator.pressSequentially).toHaveBeenCalledWith(
      "https://produto.mercadolivre.com.br/item",
      { delay: 50 },
    );
    expect(mockLocator.press).toHaveBeenCalledWith("Tab");
  });

  it("B) botão permanece disabled -> erro diagnóstico fail-closed", async () => {
    mockLocator.isVisible
      .mockReset()
      .mockResolvedValueOnce(true) // productInput
      .mockResolvedValueOnce(false) // validationMessage
      .mockResolvedValueOnce(true); // generateBtn

    mockPage.waitForFunction.mockImplementationOnce(async () => {
      throw new Error("Timeout");
    }); // Wait for generate btn

    await expect(
      driver.generateLink("https://produto.mercadolivre.com.br/item"),
    ).rejects.toThrow(
      "FAIL-CLOSED: Generate button remained disabled after filling URL.",
    );
  });

  it("C) validation message -> fail-closed", async () => {
    mockLocator.isVisible
      .mockReset()
      .mockResolvedValueOnce(true) // productInput
      .mockResolvedValueOnce(true); // validationMessage

    mockLocator.textContent.mockReset().mockResolvedValue("URL inválida");

    await expect(
      driver.generateLink("https://produto.mercadolivre.com.br/item"),
    ).rejects.toThrow("FAIL-CLOSED: UI Validation error: URL inválida");
  });

  it("D) resultado não aparece -> fail-closed", async () => {
    mockLocator.isVisible
      .mockReset()
      .mockResolvedValueOnce(true) // productInput
      .mockResolvedValueOnce(false) // validationMessage
      .mockResolvedValueOnce(true) // generateBtn
      .mockResolvedValueOnce(false); // copyBtn

    mockLocator.count.mockReset().mockResolvedValue(0); // 0 readonly inputs & heuristic inputs

    await expect(
      driver.generateLink("https://produto.mercadolivre.com.br/item"),
    ).rejects.toThrow("FAIL-CLOSED: Generated link not found or invalid.");
  });
});
