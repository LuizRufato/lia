import {
  countCategoryPublicationsToday,
  findProductCooldown,
} from "./CatalogPublicationGuards";

const record = (overrides: any = {}) => ({
  tenantId: "tenant-1",
  channelId: "channel-a",
  externalId: "item-1",
  category: "casa",
  status: "PUBLISHED",
  createdAt: new Date("2026-08-25T12:00:00Z"),
  publishedAt: null,
  ...overrides,
});

describe("CatalogPublicationGuards", () => {
  const now = new Date("2026-08-25T15:00:00Z");

  it("blocks the same stable product even when a new candidate exists", () => {
    expect(
      findProductCooldown([record()], {
        tenantId: "tenant-1",
        channelId: "channel-a",
        externalId: "item-1",
        now,
        cooldownHours: 24,
      }).active,
    ).toBe(true);
  });

  it("is scoped by channel and releases after expiration", () => {
    expect(
      findProductCooldown([record()], {
        tenantId: "tenant-1",
        channelId: "channel-b",
        externalId: "item-1",
        now,
        cooldownHours: 24,
      }).active,
    ).toBe(false);
    expect(
      findProductCooldown(
        [record({ createdAt: new Date("2026-08-23T12:00:00Z") })],
        {
          tenantId: "tenant-1",
          channelId: "channel-a",
          externalId: "item-1",
          now,
          cooldownHours: 24,
        },
      ).active,
    ).toBe(false);
  });

  it("returns the exact cooldown release time for the newest matching publication", () => {
    const result = findProductCooldown([record()], {
      tenantId: "tenant-1",
      channelId: "channel-a",
      externalId: "item-1",
      now,
      cooldownHours: 24,
    });
    expect(result.until).toEqual(new Date("2026-08-26T12:00:00Z"));
  });

  it("does not treat another tenant or product as the same stable identity", () => {
    expect(
      findProductCooldown([record({ tenantId: "tenant-2" })], {
        tenantId: "tenant-1",
        channelId: "channel-a",
        externalId: "item-1",
        now,
        cooldownHours: 24,
      }).active,
    ).toBe(false);
    expect(
      findProductCooldown([record({ externalId: "item-2" })], {
        tenantId: "tenant-1",
        channelId: "channel-a",
        externalId: "item-1",
        now,
        cooldownHours: 24,
      }).active,
    ).toBe(false);
  });

  it("uses publishedAt instead of createdAt for the daily category cap", () => {
    expect(
      countCategoryPublicationsToday(
        [
          record({
            createdAt: new Date("2026-08-24T23:00:00Z"),
            publishedAt: new Date("2026-08-25T10:00:00Z"),
          }),
        ],
        {
          tenantId: "tenant-1",
          channelId: "channel-a",
          category: "casa",
          now,
          timezone: "America/Campo_Grande",
        },
      ),
    ).toBe(1);
  });

  it("counts DELIVERY_UNKNOWN but not FAILED, PENDING or DRY_RUN records", () => {
    const records = [
      record({ status: "DELIVERY_UNKNOWN" }),
      record({ status: "FAILED" }),
      record({ status: "PENDING" }),
      record({ status: "DRY_RUN" }),
    ];
    expect(
      countCategoryPublicationsToday(records, {
        tenantId: "tenant-1",
        channelId: "channel-a",
        category: "casa",
        now,
        timezone: "America/Campo_Grande",
      }),
    ).toBe(1);
  });

  it("uses the tenant timezone and isolates tenant/channel/category", () => {
    const records = [
      record(),
      record({ tenantId: "tenant-2" }),
      record({ channelId: "channel-b" }),
      record({ category: "beleza" }),
    ];
    expect(
      countCategoryPublicationsToday(records, {
        tenantId: "tenant-1",
        channelId: "channel-a",
        category: "casa",
        now,
        timezone: "America/Campo_Grande",
      }),
    ).toBe(1);
  });

  it("does not count a publication before the tenant's local day", () => {
    expect(
      countCategoryPublicationsToday(
        [record({ createdAt: new Date("2026-08-25T03:30:00Z") })],
        {
          tenantId: "tenant-1",
          channelId: "channel-a",
          category: "casa",
          now: new Date("2026-08-25T04:30:00Z"),
          timezone: "America/Campo_Grande",
        },
      ),
    ).toBe(0);
  });

  it("returns zero when no category is available for a category cap", () => {
    expect(
      countCategoryPublicationsToday([record()], {
        tenantId: "tenant-1",
        channelId: "channel-a",
        category: null,
        now,
        timezone: "America/Campo_Grande",
      }),
    ).toBe(0);
  });
});
