"use client";

import { useEffect, useState } from "react";
import { fetchAuth } from "@/lib/api";
import { AdsPageShell, ErrorMessage, statusLabel } from "../ads-ui";

export default function CreativesPage() {
  const [items, setItems] = useState<any[]>([]);
  const [concept, setConcept] = useState("AI_VALUE");
  const [format, setFormat] = useState("SQUARE");
  const [error, setError] = useState<string | null>(null);
  async function load() {
    const response = await fetchAuth("/ads/acquisition/creatives");
    const body = await response.json().catch(() => []);
    if (!response.ok)
      throw new Error(body.message || "Falha ao carregar criativos.");
    setItems(body);
  }
  useEffect(() => {
    void load().catch((reason) => setError(reason.message));
  }, []);
  async function approve(id: string) {
    const response = await fetchAuth(
      `/ads/acquisition/creatives/${id}/approve`,
      { method: "POST" },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.message || "Ação não permitida.");
      return;
    }
    await load();
  }
  async function create() {
    const response = await fetchAuth("/ads/acquisition/creatives", {
      method: "POST",
      body: JSON.stringify({ concept, format }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body.message || "Não foi possível criar o conceito.");
      return;
    }
    await load();
  }
  return (
    <AdsPageShell
      title="Criativos"
      description="Conceitos determinísticos e editáveis. Nenhuma imagem é apresentada como gerada por IA."
    >
      <ErrorMessage message={error} />
      <div className="flex flex-wrap gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <select
          value={concept}
          onChange={(event) => setConcept(event.target.value)}
          className="rounded-lg border p-2"
        >
          <option value="AI_VALUE">IA procurando ofertas</option>
          <option value="SAVE_MONEY">Pare de pagar preço cheio</option>
          <option value="URGENCY">Promoções acabam rápido</option>
          <option value="EXCLUSIVITY">Vagas no grupo</option>
          <option value="COMMUNITY">Comunidade de ofertas</option>
          <option value="PRICE_ALERT">Alerta de oportunidades</option>
        </select>
        <select
          value={format}
          onChange={(event) => setFormat(event.target.value)}
          className="rounded-lg border p-2"
        >
          <option value="SQUARE">1:1</option>
          <option value="PORTRAIT">4:5</option>
          <option value="STORY">9:16</option>
        </select>
        <button
          onClick={() => void create()}
          className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white"
        >
          Criar conceito
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500 md:col-span-2">
            Nenhum criativo criado.
          </div>
        ) : (
          items.map((item) => (
            <article
              key={item.id}
              className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                  {item.concept}
                </span>
                <span className="text-xs font-semibold text-slate-500">
                  {statusLabel(item.status)} · {item.format}
                </span>
              </div>
              <h2 className="mt-4 text-xl font-bold">{item.headline}</h2>
              <p className="mt-2 text-slate-600">{item.primaryText}</p>
              <p className="mt-4 text-xs text-slate-500">CTA: {item.cta}</p>
              {item.status === "DRAFT" && (
                <button
                  onClick={() => void approve(item.id)}
                  className="mt-5 rounded-lg bg-green-50 px-3 py-2 text-sm font-semibold text-green-700"
                >
                  Aprovar criativo
                </button>
              )}
            </article>
          ))
        )}
      </div>
      <p className="text-sm text-slate-500">
        Formatos preparados: 1:1, 4:5 e 9:16. Claims de escassez dependem de
        dados reais.
      </p>
    </AdsPageShell>
  );
}
