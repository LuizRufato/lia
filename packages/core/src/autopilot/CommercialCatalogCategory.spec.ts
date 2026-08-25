import {
  classifyCommercialCategory,
  COMMERCIAL_CATEGORIES,
} from "./CommercialCatalogCategory";

describe("CommercialCatalogCategory", () => {
  it("keeps the requested commercial order and puts Outros last", () => {
    expect(COMMERCIAL_CATEGORIES.map((category) => category.label)).toEqual([
      "Eletrônicos",
      "Casa e Decoração",
      "Tênis / Calçados",
      "Moda Masculina",
      "Automotivo",
      "Moda Feminina",
      "Suplementos",
      "Maquiagem / Skincare",
      "Brinquedos / Infantil",
      "Esporte & Fitness",
      "Ferramentas & Construção",
      "Pet Shop",
      "Cozinha & Utilidades",
      "Relógios & Acessórios",
      "Papelaria & Escritório",
      "Mercado / Alimentos",
      "Outros / Não classificados",
    ]);
  });

  it("uses observed Shopee category evidence when the title agrees", () => {
    expect(
      classifyCommercialCategory({
        rawCategory: "100630,100662,100881",
        title: "Paleta Trio de Blush",
      }),
    ).toBe("maquiagem-skincare");
    expect(
      classifyCommercialCategory({
        rawCategory: "100017,100099,100352",
        title: "Kit 3 Camisetas Feminina",
      }),
    ).toBe("moda-feminina");
  });

  it("uses deterministic title fallback and one conservative default", () => {
    expect(
      classifyCommercialCategory({ title: "Notebook com 16GB de memória" }),
    ).toBe("eletronicos");
    expect(
      classifyCommercialCategory({ title: "Furadeira profissional" }),
    ).toBe("ferramentas-construcao");
    expect(classifyCommercialCategory({ title: "Produto sem descrição" })).toBe(
      "outros",
    );
  });
});
