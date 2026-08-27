import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://botlia.com.br"),
  title: "LIA — A inteligência que encontra a melhor oferta",
  description:
    "Pesquise um produto ou cole um link. A LIA identifica o que você procura, compara as ofertas disponíveis nos marketplaces integrados e mostra onde vale mais a pena comprar.",
  applicationName: "LIA",
  alternates: { canonical: "https://botlia.com.br/" },
  icons: {
    icon: [
      {
        url: "/brand/lia-mascot.png",
        type: "image/png",
        sizes: "512x512",
      },
    ],
    apple: [
      {
        url: "/brand/lia-mascot.png",
        type: "image/png",
        sizes: "512x512",
      },
    ],
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "LIA",
    url: "https://botlia.com.br/",
    title: "LIA Achou! — A inteligência que encontra a melhor oferta",
    description:
      "Você procura. A LIA acha. Compare oportunidades e descubra onde vale mais a pena comprar.",
    images: [
      {
        url: "/brand/lia-achou.png",
        alt: "LIA Achou!",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "LIA Achou! — A inteligência que encontra a melhor oferta",
    description:
      "Você procura. A LIA acha. Compare oportunidades e descubra onde vale mais a pena comprar.",
    images: ["/brand/lia-achou.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
