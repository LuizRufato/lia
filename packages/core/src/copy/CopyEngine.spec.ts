import {
  CopyEngine,
  DEFAULT_PUBLICATION_TEMPLATES,
  PublicationTemplateRecord,
} from "./CopyEngine";

const context = (overrides: any = {}) => ({
  title: "Fone seguro",
  priceCents: 10000,
  finalLink: "https://go.botlia.com.br/abc",
  marketplace: "Shopee",
  currentObservedAt: new Date(),
  ...overrides,
});

describe("CopyEngine", () => {
  it("renders current price without inventing an old price", () => {
    const result = CopyEngine.render(
      DEFAULT_PUBLICATION_TEMPLATES[4],
      context(),
    );
    expect(result.text.replace(/\u00a0/g, " ")).toContain("R$ 100,00");
    expect(result.text).not.toContain("Antes observado");
    expect(result.text).not.toContain("{");
  });

  it("uses current original price as safe evidence", () => {
    const result = CopyEngine.render(
      DEFAULT_PUBLICATION_TEMPLATES[0],
      context({ currentOriginalPriceCents: 20000 }),
    );
    expect(result.previousPriceCents).toBe(20000);
    expect(result.text.replace(/\u00a0/g, " ")).toContain("R$ 200,00");
    expect(result.text).toContain("50% OFF");
  });

  it("uses a recent prior observation but rejects stale history", () => {
    const result = CopyEngine.render(
      DEFAULT_PUBLICATION_TEMPLATES[2],
      context({
        previousPrices: [
          {
            priceCents: 15000,
            observedAt: new Date(Date.now() - 2 * 86400000),
          },
        ],
      }),
    );
    expect(result.text.replace(/\u00a0/g, " ")).toContain("R$ 150,00");
    const stale = CopyEngine.render(
      DEFAULT_PUBLICATION_TEMPLATES[2],
      context({
        previousPrices: [
          {
            priceCents: 15000,
            observedAt: new Date(Date.now() - 60 * 86400000),
          },
        ],
      }),
    );
    expect(stale.previousPriceCents).toBeNull();
    expect(stale.text).not.toContain("Antes observado");
  });

  it("suppresses an inconsistent reported discount", () => {
    const result = CopyEngine.render(
      DEFAULT_PUBLICATION_TEMPLATES[0],
      context({
        currentOriginalPriceCents: 20000,
        discountBps: 1000,
      }),
    );
    expect(result.discountPercentage).toBeNull();
    expect(result.text).not.toContain("OFF");
  });

  it("selects price drop and sales templates only with evidence", () => {
    expect(
      CopyEngine.selectTemplate(
        DEFAULT_PUBLICATION_TEMPLATES,
        context({
          previousPrices: [
            { priceCents: 15000, observedAt: new Date(Date.now() - 86400000) },
          ],
        }),
      ).type,
    ).toBe("PRECO_CAIU");
    expect(
      CopyEngine.selectTemplate(
        DEFAULT_PUBLICATION_TEMPLATES,
        context({ salesCount: 100 }),
      ).type,
    ).toBe("MAIS_VENDIDO");
    expect(
      CopyEngine.selectTemplate(
        DEFAULT_PUBLICATION_TEMPLATES,
        context({ salesCount: 2 }),
      ).type,
    ).toBe("ACHADINHO");
  });

  it("honors disabled templates and falls back safely", () => {
    const templates: PublicationTemplateRecord[] = [
      { ...DEFAULT_PUBLICATION_TEMPLATES[0], enabled: false },
      { ...DEFAULT_PUBLICATION_TEMPLATES[4], enabled: false },
    ];
    const result = CopyEngine.renderPublication(templates, context());
    expect(result.templateType).toBe("GENERIC");
    expect(result.text).toContain("Ver detalhes");
    expect(result.text).not.toMatch(/\{[a-z_]+\}/);
  });

  it("uses a sanitized custom CTA and category-aware automatic CTA", () => {
    const custom = CopyEngine.render(
      {
        ...DEFAULT_PUBLICATION_TEMPLATES[4],
        ctaMode: "CUSTOM",
        customCta: "  Conferir agora\n<seguro>  ",
        body: "{cta}",
      },
      context(),
    );
    expect(custom.text).toBe("Conferir agora seguro");
    const automatic = CopyEngine.render(
      { ...DEFAULT_PUBLICATION_TEMPLATES[4], body: "{cta}" },
      context({ category: "eletrônicos" }),
    );
    expect(automatic.text).toBe("Ver detalhes");
  });

  it("removes missing and unknown variables instead of leaking placeholders", () => {
    const result = CopyEngine.render(
      {
        ...DEFAULT_PUBLICATION_TEMPLATES[4],
        body: "{titulo}\n{unknown}\n{rating}",
      },
      context(),
    );
    expect(result.text).toBe("Fone seguro");
    expect(result.text).not.toContain("{");
  });
});
