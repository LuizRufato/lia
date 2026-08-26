import type { Metadata } from "next";
import LandingClient from "./landing-client";

export const metadata: Metadata = {
  title: "LIA — Preço bom de verdade",
  description:
    "A LIA identifica produtos, compara oportunidades Shopee disponíveis e destaca uma opção de compra com link rastreável.",
  openGraph: {
    title: "LIA — Preço bom de verdade",
    description: "Inteligência que encontra. Você aproveita.",
    type: "website",
  },
};

export default function Home() {
  return <LandingClient />;
}
