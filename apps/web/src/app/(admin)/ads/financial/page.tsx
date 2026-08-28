"use client";

import { useEffect, useState } from "react";
import { fetchAuth } from "@/lib/api";
import { AdsPageShell, ErrorMessage, money } from "../ads-ui";

export default function AdsFinancialPage() {
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchAuth("/ads/ledger")
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.message || "Falha ao carregar ledger.");
        setItems(b.data || []);
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <AdsPageShell
      title="Financeiro Ads"
      description="Ledger imutável de créditos e futuras movimentações Ads."
    >
      <ErrorMessage message={error} />
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Nenhuma cobrança por clique é executada nesta fase. O ledger abaixo
        mostra somente eventos reais.
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-gray-50">
            <tr>
              {[
                "Data",
                "Anunciante",
                "Campanha",
                "Tipo",
                "Valor",
                "Motivo",
              ].map((h) => (
                <th key={h} className="px-4 py-3 font-semibold text-gray-600">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-gray-500">
                  Nenhum evento financeiro.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3">
                    {new Date(item.createdAt).toLocaleString("pt-BR")}
                  </td>
                  <td className="px-4 py-3">{item.advertiser?.name}</td>
                  <td className="px-4 py-3">{item.campaign?.name || "—"}</td>
                  <td className="px-4 py-3">{item.type}</td>
                  <td className="px-4 py-3">{money(item.amountCents)}</td>
                  <td className="px-4 py-3">{item.reason || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AdsPageShell>
  );
}
