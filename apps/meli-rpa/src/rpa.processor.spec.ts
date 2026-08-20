import { Test, TestingModule } from "@nestjs/testing";
import { RpaProcessor } from "./rpa.processor";
import { RpaService } from "./rpa.service";
import { PrismaService } from "./prisma.service";
import { Job } from "bullmq";

describe("RpaProcessor", () => {
  let processor: RpaProcessor;
  let service: RpaService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RpaProcessor,
        {
          provide: RpaService,
          useValue: {
            generateAffiliateLink: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            affiliateLink: {
              findUnique: jest.fn(),
              upsert: jest.fn(),
              update: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    processor = module.get<RpaProcessor>(RpaProcessor);
    service = module.get<RpaService>(RpaService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(processor).toBeDefined();
  });

  describe("Process Job", () => {
    it("should skip if link is already verified", async () => {
      (prisma.affiliateLink.findUnique as jest.Mock).mockResolvedValue({
        status: "VERIFIED",
        affiliateUrl: "http://existing",
      });

      const job = {
        data: { offerId: "1", tenantId: "t1", channelId: "c1" },
        id: "job-1",
      } as Job<any>;
      const result = await processor.process(job);

      expect(result).toEqual({
        success: true,
        affiliateUrl: "http://existing",
      });
      expect(service.generateAffiliateLink).not.toHaveBeenCalled();
    });

    it("should generate link and persist if not verified", async () => {
      (prisma.affiliateLink.findUnique as jest.Mock).mockResolvedValue(null);
      (service.generateAffiliateLink as jest.Mock).mockResolvedValue(
        "http://new",
      );
      (prisma.affiliateLink.upsert as jest.Mock).mockResolvedValue(true);

      const job = {
        data: {
          offerId: "1",
          tenantId: "t1",
          channelId: "c1",
          productUrl: "http://p",
          attributionContext: "ctx",
        },
        id: "job-1",
      } as Job<any>;
      const result = await processor.process(job);

      expect(result).toEqual({ success: true, affiliateUrl: "http://new" });
      expect(prisma.affiliateLink.upsert).toHaveBeenCalled();
    });

    it("should fail closed and update status to FAILED on error", async () => {
      (prisma.affiliateLink.findUnique as jest.Mock).mockResolvedValue({
        id: "link-1",
      });
      (service.generateAffiliateLink as jest.Mock).mockRejectedValue(
        new Error("DOM changed"),
      );

      const job = {
        data: { offerId: "1", tenantId: "t1", channelId: "c1" },
        id: "job-1",
      } as Job<any>;

      await expect(processor.process(job)).rejects.toThrow("DOM changed");
      expect(prisma.affiliateLink.update).toHaveBeenCalledWith({
        where: { id: "link-1" },
        data: { status: "FAILED" },
      });
    });
  });
});
