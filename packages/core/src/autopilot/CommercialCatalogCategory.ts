import { normalizeCatalogText } from "./CatalogPolicy";

export const COMMERCIAL_CATEGORIES = [
  { slug: "eletronicos", label: "Eletrônicos", group: "main" },
  { slug: "casa-decoracao", label: "Casa e Decoração", group: "main" },
  { slug: "tenis-calcados", label: "Tênis / Calçados", group: "main" },
  { slug: "moda-masculina", label: "Moda Masculina", group: "main" },
  { slug: "automotivo", label: "Automotivo", group: "main" },
  { slug: "moda-feminina", label: "Moda Feminina", group: "main" },
  { slug: "suplementos", label: "Suplementos", group: "main" },
  { slug: "maquiagem-skincare", label: "Maquiagem / Skincare", group: "main" },
  {
    slug: "brinquedos-infantil",
    label: "Brinquedos / Infantil",
    group: "main",
  },
  { slug: "esporte-fitness", label: "Esporte & Fitness", group: "other" },
  {
    slug: "ferramentas-construcao",
    label: "Ferramentas & Construção",
    group: "other",
  },
  { slug: "pet-shop", label: "Pet Shop", group: "other" },
  { slug: "cozinha-utilidades", label: "Cozinha & Utilidades", group: "other" },
  {
    slug: "relogios-acessorios",
    label: "Relógios & Acessórios",
    group: "other",
  },
  {
    slug: "papelaria-escritorio",
    label: "Papelaria & Escritório",
    group: "other",
  },
  { slug: "mercado-alimentos", label: "Mercado / Alimentos", group: "other" },
  { slug: "outros", label: "Outros / Não classificados", group: "other" },
] as const;

export type CommercialCatalogCategory = (typeof COMMERCIAL_CATEGORIES)[number];
export type CommercialCatalogCategorySlug = CommercialCatalogCategory["slug"];

type CategoryRule = {
  slug: CommercialCatalogCategorySlug;
  rawCategory?: string;
  titleIncludes: string[];
};

// These are only exact category paths observed with matching product titles.
// Unknown Shopee paths remain subject to the conservative title fallback.
const KNOWN_SHOPEE_CATEGORY_RULES: CategoryRule[] = [
  {
    rawCategory: "100630,100662,100881",
    slug: "maquiagem-skincare",
    titleIncludes: ["blush", "maquiagem", "skincare", "batom"],
  },
  {
    rawCategory: "100017,100099,100352",
    slug: "moda-feminina",
    titleIncludes: ["feminina", "mulher", "vestido", "blusa"],
  },
  {
    rawCategory: "100011,100052,100240",
    slug: "moda-masculina",
    titleIncludes: ["masculina", "homem", "masculino"],
  },
  {
    rawCategory: "100637,100716,101310",
    slug: "moda-feminina",
    titleIncludes: ["feminina", "mulher", "jaqueta"],
  },
  {
    rawCategory: "100636,100716,101201",
    slug: "casa-decoracao",
    titleIncludes: ["banheiro", "vaso sanitário", "vaso sanitario", "limpeza"],
  },
];

const TITLE_RULES: Array<{
  slug: CommercialCatalogCategorySlug;
  terms: string[];
}> = [
  {
    slug: "relogios-acessorios",
    terms: ["relógio", "relogio", "óculos", "oculos", "colar", "brinco"],
  },
  {
    slug: "tenis-calcados",
    terms: [
      "tênis",
      "tenis",
      "sapato",
      "sandália",
      "sandalia",
      "bota",
      "chinelo",
      "calçado",
      "calcado",
    ],
  },
  {
    slug: "automotivo",
    terms: [
      "automotivo",
      "carro",
      "moto",
      "motocicleta",
      "veículo",
      "veiculo",
      "pneu",
      "capacete",
    ],
  },
  {
    slug: "suplementos",
    terms: [
      "suplemento",
      "whey",
      "creatina",
      "vitamina",
      "colágeno",
      "colageno",
      "pré-treino",
      "pre treino",
      "proteína",
      "proteina",
    ],
  },
  {
    slug: "maquiagem-skincare",
    terms: [
      "maquiagem",
      "blush",
      "batom",
      "skincare",
      "sérum",
      "serum",
      "rímel",
      "rimel",
    ],
  },
  {
    slug: "brinquedos-infantil",
    terms: [
      "brinquedo",
      "infantil",
      "boneca",
      "boneco",
      "lego",
      "bebê",
      "bebe",
      "criança",
      "crianca",
    ],
  },
  {
    slug: "pet-shop",
    terms: [
      "pet",
      "cachorro",
      "gato",
      "ração",
      "racao",
      "coleira",
      "aquário",
      "aquario",
    ],
  },
  {
    slug: "ferramentas-construcao",
    terms: [
      "ferramenta",
      "furadeira",
      "parafusadeira",
      "construção",
      "construcao",
      "obra",
      "serra",
      "martelo",
    ],
  },
  {
    slug: "cozinha-utilidades",
    terms: [
      "cozinha",
      "panela",
      "frigideira",
      "talher",
      "liquidificador",
      "air fryer",
      "utensílio",
      "utensilio",
    ],
  },
  {
    slug: "papelaria-escritorio",
    terms: [
      "papelaria",
      "caderno",
      "caneta",
      "lápis",
      "lapis",
      "escritório",
      "escritorio",
      "agenda",
    ],
  },
  {
    slug: "mercado-alimentos",
    terms: [
      "mercado",
      "alimento",
      "comida",
      "café",
      "cafe",
      "chá",
      "cha",
      "biscoito",
      "chocolate",
      "bebida",
    ],
  },
  {
    slug: "casa-decoracao",
    terms: [
      "sofá",
      "sofa",
      "cama",
      "colchão",
      "colchao",
      "móvel",
      "movel",
      "decoração",
      "decoracao",
      "tapete",
      "cortina",
      "banheiro",
      "vaso sanitário",
      "vaso sanitario",
      "organizador",
      "limpeza",
    ],
  },
  { slug: "moda-masculina", terms: ["masculino", "masculina", "homem"] },
  {
    slug: "moda-feminina",
    terms: [
      "feminino",
      "feminina",
      "mulher",
      "vestido",
      "blusa",
      "saia",
      "cropped",
      "sutiã",
      "sut ia",
    ],
  },
  {
    slug: "esporte-fitness",
    terms: [
      "fitness",
      "academia",
      "esporte",
      "futebol",
      "yoga",
      "halter",
      "bicicleta",
      "camping",
      "corrida",
    ],
  },
  {
    slug: "eletronicos",
    terms: [
      "celular",
      "smartphone",
      "iphone",
      "notebook",
      "laptop",
      "computador",
      "tablet",
      "fone",
      "headphone",
      "earbud",
      "televisão",
      "televisao",
      "tv",
      "monitor",
      "câmera",
      "camera",
      "console",
      "playstation",
      "xbox",
      "carregador",
      "pendrive",
      "roteador",
    ],
  },
];

export function classifyCommercialCategory(input: {
  title?: string | null;
  rawCategory?: string | null;
}): CommercialCatalogCategorySlug {
  const title = normalizeCatalogText(input.title || "");
  const rawCategory = normalizeCatalogText(input.rawCategory || "").replace(
    /\s+/g,
    "",
  );

  const knownRule = KNOWN_SHOPEE_CATEGORY_RULES.find(
    (rule) =>
      rule.rawCategory === rawCategory &&
      rule.titleIncludes.some((term) =>
        title.includes(normalizeCatalogText(term)),
      ),
  );
  if (knownRule) return knownRule.slug;

  const titleRule = TITLE_RULES.find((rule) =>
    rule.terms.some((term) => title.includes(normalizeCatalogText(term))),
  );
  return titleRule?.slug || "outros";
}
