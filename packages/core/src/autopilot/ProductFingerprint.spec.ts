import { getCanonicalProductFingerprint } from "./ProductFingerprint";

const payload = (title: string, product: Record<string, unknown> = {}) => ({
  product: { title, ...product },
});

describe("getCanonicalProductFingerprint", () => {
  it("matches different listings for the same product after listing noise", () => {
    expect(
      getCanonicalProductFingerprint(
        "SHOPEE",
        payload("Oferta Air Fryer Philips Walita Série 3000 4L R$ 349,90"),
        "listing-a",
      ),
    ).toBe(
      getCanonicalProductFingerprint(
        "SHOPEE",
        payload("Air Fryer Philips Walita Série 3000 4L - 20% OFF"),
        "listing-b",
      ),
    );
  });

  it("keeps capacity variants different", () => {
    expect(
      getCanonicalProductFingerprint(
        "SHOPEE",
        payload("iPhone 17 Pro Max", { capacity: "256 GB" }),
        "listing-a",
      ),
    ).not.toBe(
      getCanonicalProductFingerprint(
        "SHOPEE",
        payload("iPhone 17 Pro Max", { capacity: "512 GB" }),
        "listing-b",
      ),
    );
  });

  it("keeps voltage variants different", () => {
    expect(
      getCanonicalProductFingerprint(
        "SHOPEE",
        payload("Liquidificador Turbo", { voltage: "110V" }),
        "listing-a",
      ),
    ).not.toBe(
      getCanonicalProductFingerprint(
        "SHOPEE",
        payload("Liquidificador Turbo", { voltage: "220V" }),
        "listing-b",
      ),
    );
  });

  it("keeps size variants different", () => {
    expect(
      getCanonicalProductFingerprint(
        "SHOPEE",
        payload("Smart TV Samsung Crystal UHD 4K 55"),
        "listing-a",
      ),
    ).not.toBe(
      getCanonicalProductFingerprint(
        "SHOPEE",
        payload("Smart TV Samsung Crystal UHD 4K 65"),
        "listing-b",
      ),
    );
  });

  it("does not merge similar titles with different models", () => {
    expect(
      getCanonicalProductFingerprint(
        "SHOPEE",
        payload("Notebook Lenovo IdeaPad 3 15ITL6"),
        "listing-a",
      ),
    ).not.toBe(
      getCanonicalProductFingerprint(
        "SHOPEE",
        payload("Notebook Lenovo IdeaPad 3 15ALC6"),
        "listing-b",
      ),
    );
  });

  it("falls back to the marketplace identifier when a safe title is unavailable", () => {
    expect(
      getCanonicalProductFingerprint("SHOPEE", payload("Oferta"), "listing-a"),
    ).not.toBe(
      getCanonicalProductFingerprint("SHOPEE", payload("Oferta"), "listing-b"),
    );
  });
});
