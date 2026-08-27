import type { Metadata } from "next";
import LandingClient from "./landing-client";

export const metadata: Metadata = {
  title: "LIA — A inteligência que encontra a melhor oferta",
  description:
    "Pesquise um produto ou cole um link. A LIA identifica o que você procura, compara as ofertas disponíveis nos marketplaces integrados e mostra onde vale mais a pena comprar.",
  alternates: { canonical: "https://botlia.com.br/" },
  openGraph: {
    title: "LIA Achou! — A inteligência que encontra a melhor oferta",
    description:
      "Você procura. A LIA acha. Compare oportunidades e descubra onde vale mais a pena comprar.",
    type: "website",
    locale: "pt_BR",
    siteName: "LIA",
    url: "https://botlia.com.br/",
    images: [{ url: "/brand/lia-achou.png", alt: "LIA Achou!" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "LIA Achou! — A inteligência que encontra a melhor oferta",
    description:
      "Você procura. A LIA acha. Compare oportunidades e descubra onde vale mais a pena comprar.",
    images: ["/brand/lia-achou.png"],
  },
};

export default function Home() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "LIA",
        url: "https://botlia.com.br/",
        logo: "https://botlia.com.br/brand/lia-achou.png",
        description:
          "Pesquise um produto ou cole um link. A LIA identifica o que você procura, compara as ofertas disponíveis nos marketplaces integrados e mostra onde vale mais a pena comprar.",
      },
      {
        "@type": "WebSite",
        name: "LIA",
        url: "https://botlia.com.br/",
        description:
          "Pesquise um produto ou cole um link. A LIA identifica o que você procura, compara as ofertas disponíveis nos marketplaces integrados e mostra onde vale mais a pena comprar.",
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <LandingClient />
    </>
  );
}
