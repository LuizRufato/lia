import { MarketplacePublicationPolicy } from "./MarketplacePublicationPolicy";

describe("MarketplacePublicationPolicy", () => {
  it("should block PRIVATE channels for MERCADO_LIVRE", () => {
    expect(
      MarketplacePublicationPolicy.canPublish("MERCADO_LIVRE", "PRIVATE"),
    ).toBe(false);
  });

  it("should allow PUBLIC channels for MERCADO_LIVRE", () => {
    expect(
      MarketplacePublicationPolicy.canPublish("MERCADO_LIVRE", "PUBLIC"),
    ).toBe(true);
  });

  it("should allow any visibility for SHOPEE by default", () => {
    expect(MarketplacePublicationPolicy.canPublish("SHOPEE", "PRIVATE")).toBe(
      true,
    );
    expect(MarketplacePublicationPolicy.canPublish("SHOPEE", "PUBLIC")).toBe(
      true,
    );
  });
});
