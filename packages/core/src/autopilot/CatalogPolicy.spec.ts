import { evaluateCatalogPolicy, normalizeCatalogText } from "./CatalogPolicy";

const open = (overrides: any = {}) => ({
  mode: "OPEN" as const,
  allowedCategories: [],
  blockedCategories: [],
  blockedKeywords: [],
  minSalesCount: null,
  minRating: null,
  ...overrides,
});

const offer = (overrides: any = {}) => ({
  title: "Produto útil",
  category: "Casa",
  salesCount: 100,
  rating: 4.5,
  ...overrides,
});

describe("CatalogPolicy", () => {
  it("keeps OPEN with null controls equivalent to the old behavior", () => {
    expect(evaluateCatalogPolicy(open(), offer())).toEqual({ allowed: true });
  });

  it("allows selected categories and rejects categories outside the selection", () => {
    expect(
      evaluateCatalogPolicy(
        open({ mode: "SELECTED_CATEGORIES", allowedCategories: ["Casa"] }),
        offer(),
      ),
    ).toEqual({ allowed: true });
    expect(
      evaluateCatalogPolicy(
        open({ mode: "SELECTED_CATEGORIES", allowedCategories: ["Games"] }),
        offer(),
      ),
    ).toMatchObject({ reason: "REJECTED_CATEGORY" });
  });

  it("makes blocked categories win over allowed categories", () => {
    expect(
      evaluateCatalogPolicy(
        open({
          mode: "SELECTED_CATEGORIES",
          allowedCategories: ["Casa"],
          blockedCategories: ["Casa"],
        }),
        offer(),
      ),
    ).toMatchObject({ reason: "REJECTED_BLOCKED_CATEGORY" });
  });

  it("matches blocked keywords case-insensitively and without accents", () => {
    expect(
      evaluateCatalogPolicy(
        open({ blockedKeywords: ["volumetox"] }),
        offer({ title: "VOLUMÉTOX sérum" }),
      ),
    ).toMatchObject({ reason: "REJECTED_BLOCKED_KEYWORD" });
    expect(normalizeCatalogText("  Ação   Rápida ")).toBe("acao rapida");
  });

  it("matches a blocked keyword in the category as well as the title", () => {
    expect(
      evaluateCatalogPolicy(
        open({ blockedKeywords: ["adulto"] }),
        offer({ title: "Produto neutro", category: "Conteúdo adulto" }),
      ),
    ).toMatchObject({ reason: "REJECTED_BLOCKED_KEYWORD" });
  });

  it("treats keyword punctuation as literal text, never as a regular expression", () => {
    expect(
      evaluateCatalogPolicy(
        open({ blockedKeywords: ["a+b"] }),
        offer({ title: "aab" }),
      ),
    ).toEqual({ allowed: true });
    expect(
      evaluateCatalogPolicy(
        open({ blockedKeywords: ["a+b"] }),
        offer({ title: "Oferta a+b" }),
      ),
    ).toMatchObject({ reason: "REJECTED_BLOCKED_KEYWORD" });
  });

  it("allows exact threshold values for sales and rating", () => {
    expect(
      evaluateCatalogPolicy(
        open({ minSalesCount: 100, minRating: 4.5 }),
        offer({ salesCount: 100, rating: 4.5 }),
      ),
    ).toEqual({ allowed: true });
  });

  it("does not block when an optional signal is undefined", () => {
    expect(
      evaluateCatalogPolicy(
        open({ minSalesCount: 100, minRating: 4 }),
        offer({ salesCount: undefined, rating: undefined }),
      ),
    ).toEqual({ allowed: true });
  });

  it("keeps OPEN mode permissive when the category is absent", () => {
    expect(evaluateCatalogPolicy(open(), offer({ category: null }))).toEqual({
      allowed: true,
    });
  });

  it("applies minimum sales only when salesCount is known", () => {
    expect(
      evaluateCatalogPolicy(
        open({ minSalesCount: 100 }),
        offer({ salesCount: 99 }),
      ),
    ).toMatchObject({ reason: "REJECTED_MIN_SALES" });
    expect(
      evaluateCatalogPolicy(
        open({ minSalesCount: 100 }),
        offer({ salesCount: null }),
      ),
    ).toEqual({ allowed: true });
  });

  it("applies minimum rating only when rating is known", () => {
    expect(
      evaluateCatalogPolicy(open({ minRating: 4.5 }), offer({ rating: 4.4 })),
    ).toMatchObject({ reason: "REJECTED_MIN_RATING" });
    expect(
      evaluateCatalogPolicy(open({ minRating: 4.5 }), offer({ rating: null })),
    ).toEqual({ allowed: true });
  });

  it("rejects an unidentified category in selected mode", () => {
    expect(
      evaluateCatalogPolicy(
        open({ mode: "SELECTED_CATEGORIES", allowedCategories: ["Casa"] }),
        offer({ category: null }),
      ),
    ).toMatchObject({ reason: "REJECTED_CATEGORY" });
  });
});
