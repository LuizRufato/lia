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
    expect(result.text).toContain("50%");
    expect(result.text).not.toContain("Antes observado");
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
    expect(result.discountPercentage).toBe(50);
    expect(result.text).toContain("50%");
    expect(result.warnings).toContain("DISCOUNT_SOURCE_DIVERGENCE");
  });

  it("uses Shopee discount data when no old price is available", () => {
    const result = CopyEngine.render(
      { ...DEFAULT_PUBLICATION_TEMPLATES[1], body: "{preco_atual} {desconto}" },
      context({ discountBps: 2000 }),
    );

    expect(result.text.replace(/\u00a0/g, " ")).toBe("R$ 100,00 20%");
    expect(result.discountPercentage).toBe(20);
  });

  it("renders every official variable as data without adding presentation labels", () => {
    const result = CopyEngine.render(
      {
        ...DEFAULT_PUBLICATION_TEMPLATES[4],
        ctaMode: "CUSTOM",
        customCta: "Abrir oferta",
        body: "{titulo}\n{preco_atual}\n{preco_antigo}\n{desconto}\n{cta}\n{link}\n{marketplace}\n{sales_count}\n{rating}",
      },
      context({
        currentOriginalPriceCents: 20000,
        discountBps: 2500,
        salesCount: 1234,
        rating: 4.8,
      }),
    );
    const text = result.text.replace(/\u00a0/g, " ");

    expect(text).toContain("Fone seguro");
    expect(text).toContain("R$ 100,00");
    expect(text).toContain("R$ 200,00");
    expect(text).toContain("50%");
    expect(text).toContain("Abrir oferta");
    expect(text).toContain("https://go.botlia.com.br/abc");
    expect(text).toContain("Shopee");
    expect(text).toContain("1234");
    expect(text).toContain("4.8");
    expect(text).not.toContain("Antes observado");
    expect(text).not.toContain("Desconto:");
  });

  it("keeps optional labels out when their values are unavailable", () => {
    const result = CopyEngine.render(
      {
        ...DEFAULT_PUBLICATION_TEMPLATES[1],
        body: "Antes: ~{preco_antigo}~\n🎯 {desconto} OFF\n📦 {sales_count} vendidos\n{titulo}",
      },
      context(),
    );

    expect(result.text).toBe("Fone seguro");
    expect(result.text).not.toContain("Antes:");
    expect(result.text).not.toContain("OFF");
    expect(result.text).not.toContain("vendidos");
  });

  it("accepts only ratings in the real 0–5 range", () => {
    const valid = CopyEngine.render(
      { ...DEFAULT_PUBLICATION_TEMPLATES[4], body: "⭐ {rating}" },
      context({ rating: 4.8 }),
    );
    const invalid = CopyEngine.render(
      { ...DEFAULT_PUBLICATION_TEMPLATES[4], body: "⭐ {rating}" },
      context({ rating: 6 }),
    );

    expect(valid.text).toBe("⭐ 4.8");
    expect(invalid.text).not.toContain("6");
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

  it("prioritizes the matching type and uses the default only as fallback", () => {
    const templates: PublicationTemplateRecord[] = [
      {
        ...DEFAULT_PUBLICATION_TEMPLATES[0],
        name: "Achadinho editado",
        body: "ACHADINHO {titulo}",
      },
      {
        ...DEFAULT_PUBLICATION_TEMPLATES[4],
        name: "Fallback padrão",
        isDefault: true,
        body: "PADRÃO {titulo}",
      },
    ];

    expect(CopyEngine.selectTemplate(templates, context()).name).toBe(
      "Achadinho editado",
    );
    expect(
      CopyEngine.selectTemplate(
        templates.map((template) =>
          template.type === "ACHADINHO"
            ? { ...template, enabled: false }
            : template,
        ),
        context(),
      ).name,
    ).toBe("Fallback padrão");
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
