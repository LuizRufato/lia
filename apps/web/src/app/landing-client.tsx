"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type PublicOffer = {
  title: string;
  imageUrl?: string | null;
  marketplace: string;
  priceCents: number;
  originalPriceCents?: number | null;
  discountBps?: number | null;
  rating?: number | null;
  salesCount?: number | null;
  liaScore?: number | null;
  trackedUrl?: string | null;
  searchQuery?: string;
};

type SearchResult = {
  status: string;
  message?: string;
  identification?: { name?: string; brand?: string; model?: string };
  recommendation?: PublicOffer & { recommendation?: string };
  alternatives?: PublicOffer[];
  source?: string;
  limitation?: string;
};

const VIP_LINK = "https://chat.whatsapp.com/DTcQ7Wnk1UxAKSM9LIIX6m";
const SUGGESTIONS = ["iPhone 16", "Air Fryer", "Tênis", "TV"];
const CATEGORIES = [
  "Eletrônicos",
  "Casa e Decoração",
  "Tênis / Calçados",
  "Moda Feminina",
  "Moda Masculina",
  "Automotivo",
];

function formatPrice(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

function discountLabel(offer: PublicOffer) {
  if (offer.discountBps && offer.discountBps > 0)
    return `-${Math.round(offer.discountBps / 100)}%`;
  if (offer.originalPriceCents && offer.originalPriceCents > offer.priceCents) {
    return `-${Math.round((1 - offer.priceCents / offer.originalPriceCents) * 100)}%`;
  }
  return null;
}

function OfferCard({
  offer,
  onSearch,
}: {
  offer: PublicOffer;
  onSearch: (query: string) => void;
}) {
  const discount = discountLabel(offer);
  return (
    <article className="offer-card">
      <div className="offer-image-wrap">
        {discount && <span className="discount-badge">{discount}</span>}
        {offer.imageUrl ? (
          <img
            src={offer.imageUrl}
            alt={offer.title}
            width={240}
            height={180}
            className="offer-image"
            loading="lazy"
          />
        ) : (
          <div className="offer-image-placeholder">LIA</div>
        )}
      </div>
      <div className="offer-card-body">
        <span className="marketplace-pill">{offer.marketplace}</span>
        <h3>{offer.title}</h3>
        <strong>{formatPrice(offer.priceCents)}</strong>
        {offer.originalPriceCents &&
          offer.originalPriceCents > offer.priceCents && (
            <del>{formatPrice(offer.originalPriceCents)}</del>
          )}
        <div className="offer-signals">
          {offer.rating != null && <span>★ {offer.rating.toFixed(1)}</span>}
          {offer.salesCount != null && (
            <span>{offer.salesCount.toLocaleString("pt-BR")} vendas</span>
          )}
        </div>
        {offer.trackedUrl ? (
          <a className="offer-cta" href={offer.trackedUrl}>
            Ver oferta <span>↗</span>
          </a>
        ) : (
          <button
            className="offer-cta"
            type="button"
            onClick={() => onSearch(offer.searchQuery || offer.title)}
          >
            Buscar esta oferta <span>→</span>
          </button>
        )}
      </div>
    </article>
  );
}

export default function LandingClient() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [featured, setFeatured] = useState<PublicOffer[]>([]);
  const [loading, setLoading] = useState(false);
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [error, setError] = useState("");
  const searchMessages = useMemo(
    () => [
      "Identificando seu produto…",
      "Procurando oportunidades…",
      "Comparando opções…",
    ],
    [],
  );

  useEffect(() => {
    let active = true;
    fetch("/api/public/search")
      .then((response) => (response.ok ? response.json() : { data: [] }))
      .then((data) => {
        if (active) setFeatured(Array.isArray(data.data) ? data.data : []);
      })
      .catch(() => undefined)
      .finally(() => active && setFeaturedLoading(false));
    return () => {
      active = false;
    };
  }, []);

  async function search(event?: FormEvent) {
    event?.preventDefault();
    const value = query.trim();
    if (value.length < 2) {
      setError("Digite pelo menos 2 caracteres para começar.");
      return;
    }
    setError("");
    setResult(null);
    setLoading(true);
    try {
      const response = await fetch("/api/public/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: value }),
      });
      const data = (await response.json()) as SearchResult;
      setResult(data);
      if (!response.ok && !data.message)
        setError("Não foi possível concluir a busca agora.");
    } catch {
      setError(
        "A LIA está atualizando as oportunidades. Tente novamente em instantes.",
      );
    } finally {
      setLoading(false);
    }
  }

  function useSuggestion(value: string) {
    setQuery(value);
    setResult(null);
    setError("");
  }

  return (
    <main className="landing-page">
      <header className="landing-header glass-panel">
        <Link href="/" className="brand-mark" aria-label="LIA — início">
          <Image
            src="/brand/lia-achou.png"
            alt="LIA Achou!"
            width={64}
            height={52}
            priority
          />
        </Link>
        <nav className="landing-nav" aria-label="Navegação principal">
          <a href="#como-funciona">Como funciona</a>
          <a href="#ofertas">Ofertas</a>
          <a href="#categorias">Categorias</a>
        </nav>
        <div className="header-actions">
          <Link href="/login" className="login-link">
            Entrar
          </Link>
          <a
            className="primary-button compact"
            href={VIP_LINK}
            target="_blank"
            rel="noopener noreferrer"
          >
            Entrar no grupo VIP <span>→</span>
          </a>
        </div>
      </header>

      <section className="hero-shell">
        <div className="hero-copy">
          <span className="eyebrow">
            <span>ϟ</span> INTELIGÊNCIA QUE ENCONTRA. VOCÊ APROVEITA.
          </span>
          <h1>
            A inteligência artificial que encontra as <em>melhores ofertas</em>{" "}
            para você.
          </h1>
          <p className="hero-lede">
            A LIA analisa ofertas Shopee disponíveis, compara oportunidades e
            destaca uma opção de compra baseada em dados reais.
          </p>
          <form id="public-search" className="search-box" onSubmit={search}>
            <span className="search-icon" aria-hidden="true">
              ⌕
            </span>
            <label className="sr-only" htmlFor="public-search-input">
              Busque um produto ou cole um link
            </label>
            <input
              id="public-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Busque um produto ou cole um link"
              maxLength={500}
            />
            <button type="submit" className="primary-button" disabled={loading}>
              {loading ? "Analisando…" : "Buscar →"}
            </button>
          </form>
          <div className="suggestion-row">
            <span>Sugestões populares:</span>
            {SUGGESTIONS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => useSuggestion(item)}
              >
                {item}
              </button>
            ))}
          </div>
          {loading && (
            <div className="search-progress" role="status" aria-live="polite">
              {searchMessages.map((message) => (
                <span key={message}>{message}</span>
              ))}
            </div>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="hero-visual">
          <div className="hero-glow" />
          <Image
            src="/brand/lia-mascot.png"
            alt="Mascote oficial da LIA"
            width={620}
            height={620}
            priority
            className="mascot-image"
          />
          <div className="floating-note glass-panel">
            <span>◈</span>
            <strong>
              Preço bom
              <br />
              de verdade.
            </strong>
            <small>Oportunidades reais, sem pegadinhas.</small>
          </div>
        </div>
      </section>

      {result && (
        <section className="result-section" aria-live="polite">
          {result.status === "FOUND" && result.recommendation ? (
            <div className="result-layout">
              <div className="result-heading">
                <span className="eyebrow orange">LIA ACHOU!</span>
                <h2>A melhor oportunidade encontrada pela LIA.</h2>
                <p>{result.identification?.name}</p>
              </div>
              <div className="result-main-card glass-panel">
                <OfferCard
                  offer={result.recommendation}
                  onSearch={useSuggestion}
                />
                <div className="recommendation-note">
                  {result.recommendation.recommendation}
                </div>
              </div>
              {!!result.alternatives?.length && (
                <div className="alternatives">
                  <h3>Outras correspondências exatas</h3>
                  {result.alternatives.map((offer) => (
                    <OfferCard
                      key={offer.title}
                      offer={offer}
                      onSearch={useSuggestion}
                    />
                  ))}
                </div>
              )}
              {result.limitation && (
                <p className="limitation-note">{result.limitation}</p>
              )}
            </div>
          ) : (
            <div className="empty-result glass-panel">
              <span className="eyebrow orange">A LIA ANALISOU</span>
              <h2>{result.message}</h2>
              <p>
                Você pode tentar informar marca, modelo, capacidade, cor ou
                voltagem para aumentar a precisão.
              </p>
            </div>
          )}
        </section>
      )}

      <section
        className="benefits-strip glass-panel"
        aria-label="Benefícios da LIA"
      >
        {[
          [
            "◷",
            "Análise contínua",
            "A LIA monitora e atualiza oportunidades disponíveis.",
          ],
          [
            "✧",
            "Melhor opção primeiro",
            "Preço, reputação e sinais reais entram na análise.",
          ],
          [
            "↗",
            "Links prontos para comprar",
            "Acesse diretamente a oportunidade encontrada.",
          ],
          [
            "♧",
            "Ofertas para você",
            "As descobertas também podem chegar pelo grupo VIP.",
          ],
        ].map(([icon, title, text]) => (
          <div className="benefit-item" key={title}>
            <span className="benefit-icon">{icon}</span>
            <div>
              <strong>{title}</strong>
              <p>{text}</p>
            </div>
          </div>
        ))}
      </section>

      <section id="ofertas" className="offers-section">
        <div className="section-intro">
          <div className="achou-wordmark">
            <Image
              src="/brand/lia-achou.png"
              alt="LIA Achou!"
              width={180}
              height={100}
            />
          </div>
          <p>As melhores oportunidades encontradas agora pela LIA.</p>
          <a href="#public-search">
            Ver todas as ofertas <span>→</span>
          </a>
        </div>
        <div className="offer-grid">
          {featuredLoading && (
            <div className="section-loading">
              Carregando oportunidades reais…
            </div>
          )}
          {!featuredLoading && featured.length === 0 && (
            <div className="section-empty">
              As ofertas reais aparecem aqui conforme a LIA encontra
              oportunidades verificadas. Comece buscando um produto.
            </div>
          )}
          {featured.slice(0, 4).map((offer) => (
            <OfferCard
              key={offer.title}
              offer={offer}
              onSearch={useSuggestion}
            />
          ))}
        </div>
      </section>

      <section id="como-funciona" className="how-section glass-panel">
        <div className="section-title">
          <span className="eyebrow">
            <span>ϟ</span> Como funciona
          </span>
          <h2>Você busca. A LIA encontra.</h2>
        </div>
        <div className="steps-grid">
          {[
            [
              "1",
              "Você busca",
              "Digite o que procura ou cole um link de produto.",
              "⌕",
            ],
            [
              "2",
              "A LIA analisa",
              "A LIA identifica o produto e compara as oportunidades disponíveis.",
              "✧",
            ],
            [
              "3",
              "Você aproveita",
              "Veja a melhor opção encontrada e acesse a oferta.",
              "✓",
            ],
          ].map(([number, title, text, icon]) => (
            <div className="step-card" key={number}>
              <div className="step-icon">{icon}</div>
              <span className="step-number">{number}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="technology-section">
        <div>
          <span className="eyebrow">
            <span>ϟ</span> INTELIGÊNCIA APLICADA
          </span>
          <h2>
            Tecnologia própria para encontrar <em>preço bom de verdade.</em>
          </h2>
          <p>
            A LIA combina Discovery, LIA Score, preço, desconto, vendas,
            reputação e tracking para transformar dados reais em uma
            recomendação clara.
          </p>
          <div className="tech-tags">
            <span>LIA Score</span>
            <span>Dados reais</span>
            <span>Análise de reputação</span>
            <span>Atualização contínua</span>
          </div>
        </div>
        <div className="tech-art glass-panel">
          <Image
            src="/brand/lia-brand.png"
            alt="Identidade visual LIA"
            width={520}
            height={330}
          />
        </div>
      </section>

      <section id="categorias" className="categories-section">
        <span className="eyebrow">
          <span>ϟ</span> EXPLORE POR CATEGORIA
        </span>
        <h2>Comece pelo que você procura.</h2>
        <div className="category-pills">
          {CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => useSuggestion(category)}
            >
              {category}
            </button>
          ))}
        </div>
      </section>

      <section className="vip-cta glass-panel">
        <div>
          <span className="eyebrow orange">LIA ACHOU!</span>
          <h2>Não quer ficar procurando?</h2>
          <p>
            A LIA procura por você. Entre no grupo e receba oportunidades
            encontradas pela nossa inteligência.
          </p>
        </div>
        <a
          className="primary-button"
          href={VIP_LINK}
          target="_blank"
          rel="noopener noreferrer"
        >
          Entrar no grupo VIP →
        </a>
      </section>
      <footer className="landing-footer">
        <div className="footer-brand">
          <Image src="/brand/lia-brand.png" alt="LIA" width={86} height={38} />
          <span>Preço bom de verdade.</span>
        </div>
        <div className="footer-links">
          <a href="#como-funciona">Como funciona</a>
          <a href="#ofertas">Ofertas</a>
          <a href="#categorias">Categorias</a>
          <Link href="/login">Entrar</Link>
        </div>
        <p>Inteligência que encontra. Você aproveita.</p>
      </footer>
    </main>
  );
}
