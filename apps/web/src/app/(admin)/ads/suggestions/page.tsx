"use client";

import { useEffect, useState } from "react";
import { fetchAuth } from "@/lib/api";
import { AdsPageShell, ErrorMessage, statusLabel } from "../ads-ui";

export default function SuggestionsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void fetchAuth("/ads/acquisition/suggestions")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.message || "Falha ao carregar sugestões.");
        setItems(body);
      })
      .catch((reason) => setError(reason.message));
  }, []);
  return (
    <AdsPageShell
      title="Sugestões"
      description="Recomendações da LIA para aquisição. Nenhuma ação é aplicada automaticamente."
    >
      <ErrorMessage message={error} />
      <div className="space-y-3">
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
            Ainda não há sugestões baseadas em dados suficientes.
          </div>
        ) : (
          items.map((item) => (
            <article
              key={item.id}
              className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
            >
              <div className="flex justify-between">
                <h2 className="font-bold">{item.title}</h2>
                <span className="text-xs font-semibold text-slate-500">
                  {statusLabel(item.status)}
                </span>
              </div>
              <p className="mt-2 text-slate-600">{item.explanation}</p>
              <p className="mt-3 text-xs text-slate-500">
                Confiança: {item.confidence ?? "não informada"} · Impacto:{" "}
                {item.expectedImpact ?? "estimativa não disponível"}
              </p>
            </article>
          ))
        )}
      </div>
    </AdsPageShell>
  );
}
