import { Test, TestingModule } from "@nestjs/testing";
import * as playwright from "playwright";

jest.mock("playwright", () => ({
  chromium: {
    launch: jest.fn(),
  },
}));
import { RpaService } from "./rpa.service";
import { PrismaService } from "./prisma.service";
import { DistributedLockService } from "./distributed-lock.service";

describe("RpaService", () => {
  let service: RpaService;
  let prisma: PrismaService;

  beforeEach(async () => {
    // Generate a valid 64 character hex key for testing
    process.env.MELI_RPA_SESSION_ENCRYPTION_KEY = "a".repeat(64);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RpaService,
        {
          provide: PrismaService,
          useValue: {
            marketplaceBrowserSession: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: DistributedLockService,
          useValue: {
            acquireLock: jest.fn().mockResolvedValue("fake-token"),
            renewLock: jest.fn().mockResolvedValue(true),
            releaseLock: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    service = module.get<RpaService>(RpaService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("Storage State Encryption", () => {
    it("should encrypt and decrypt correctly without persisting plaintext", () => {
      const stateMock = { cookies: [{ name: "test", value: "123" }] };
      const { encryptedData, ivHex, authTagHex } = (
        service as any
      ).encryptStorageState(JSON.stringify(stateMock));

      expect(encryptedData).toBeDefined();
      expect(encryptedData).not.toContain("123"); // Ensure plaintext isn't there
      expect(ivHex).toBeDefined();
      expect(authTagHex).toBeDefined();

      const decrypted = (service as any).decryptStorageState(
        encryptedData,
        ivHex,
        authTagHex,
      );
      expect(JSON.parse(decrypted)).toEqual(stateMock);
    });

    it("should throw REAUTH_REQUIRED if session is locked", async () => {
      (
        prisma.marketplaceBrowserSession.findUnique as jest.Mock
      ).mockResolvedValue({
        status: "CHALLENGE_REQUIRED",
        encryptedStorageState: "enc",
        iv: "iv",
        authTag: "tag",
      });

      await expect(
        service.generateAffiliateLink(
          "tenant-1",
          "offer-1",
          "http://link",
          "ctx",
        ),
      ).rejects.toThrow("CHALLENGE_REQUIRED: Session is locked");
    });

    it("should fail if invalid key length", () => {
      process.env.MELI_RPA_SESSION_ENCRYPTION_KEY = "short";
      expect(() => (service as any).getEncryptionKey()).toThrow(
        "MELI_RPA_SESSION_ENCRYPTION_KEY is missing or not 64 hex characters",
      );
    });
  });

  describe("Teardown and Error Handling", () => {
    let mockBrowser: any;
    let mockContext: any;
    let mockLockService: any;
    let mockPage: any;

    beforeEach(() => {
      const mockLocatorObj = {
        first: jest.fn().mockReturnThis(),
        last: jest.fn().mockReturnThis(),
        isVisible: jest
          .fn()
          .mockResolvedValueOnce(true) // textarea
          .mockResolvedValueOnce(false) // validation message
          .mockResolvedValueOnce(true) // generate btn
          .mockResolvedValue(true), // default
        isDisabled: jest.fn().mockResolvedValue(false),
        fill: jest.fn().mockResolvedValue(undefined),
        click: jest.fn().mockResolvedValue(undefined),
        press: jest.fn().mockResolvedValue(undefined),
        pressSequentially: jest.fn().mockResolvedValue(undefined),
        inputValue: jest
          .fn()
          .mockResolvedValue("https://mercadolivre.com/sec/mock"),
        waitForTimeout: jest.fn().mockResolvedValue(undefined),
        textContent: jest.fn().mockResolvedValue("Gerar"),
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
        goto: jest.fn(),
        url: jest.fn().mockReturnValue("https://mercadolivre.com"),
        locator: jest.fn().mockReturnValue(mockLocatorObj),
        getByRole: jest.fn().mockReturnValue(mockLocatorObj),
        waitForTimeout: jest.fn().mockResolvedValue(undefined),
        waitForFunction: jest.fn().mockResolvedValue(undefined),
      };
      mockContext = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        storageState: jest.fn().mockResolvedValue({ cookies: [] }),
      };
      mockBrowser = {
        newContext: jest.fn().mockResolvedValue(mockContext),
        close: jest.fn().mockResolvedValue(undefined),
      };
      (playwright.chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);

      mockLockService = service["lockService"];

      const { encryptedData, ivHex, authTagHex } = (
        service as any
      ).encryptStorageState("{}");
      (
        prisma.marketplaceBrowserSession.findUnique as jest.Mock
      ).mockResolvedValue({
        id: "session-123",
        status: "CONNECTED",
        encryptedStorageState: encryptedData,
        iv: ivHex,
        authTag: authTagHex,
      });
    });

    it("E) context continua aberto ao capturar storageState & G) lock sempre liberado", async () => {
      await service.generateAffiliateLink(
        "tenant-1",
        "offer-1",
        "http://product",
        "ctx",
      );

      // storageState should be called before browser.close
      const storageStateOrder =
        mockContext.storageState.mock.invocationCallOrder[0];
      const browserCloseOrder = mockBrowser.close.mock.invocationCallOrder[0];

      expect(storageStateOrder).toBeLessThan(browserCloseOrder);

      expect(mockLockService.releaseLock).toHaveBeenCalledWith(
        "lia:meli-rpa:lock:tenant-1:MERCADO_LIVRE",
        "fake-token",
      );
    });

    it("F) erro primário é preservado mesmo se teardown falhar", async () => {
      // Simulate primary error in page logic
      mockPage.locator.mockImplementation(() => {
        throw new Error("Primary Error");
      });
      // Simulate teardown error
      mockBrowser.close.mockImplementation(() => {
        throw new Error("Teardown Error");
      });

      await expect(
        service.generateAffiliateLink(
          "tenant-1",
          "offer-1",
          "http://product",
          "ctx",
        ),
      ).rejects.toThrow("Primary Error"); // Should NOT throw Teardown Error

      expect(mockLockService.releaseLock).toHaveBeenCalled();
    });
  });
});
