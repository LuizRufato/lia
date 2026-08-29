"use client";

import { useEffect, useState } from "react";
import { fetchAuth } from "@/lib/api";
import { AdsPageShell, ErrorMessage, statusLabel } from "../ads-ui";

export default function MetaPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void fetchAuth("/ads/meta/status")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.message || "Falha ao carregar a conexão Meta.");
        setData(body);
      })
      .catch((reason) => setError(reason.message));
  }, []);
  return (
    <AdsPageShell
      title="Meta"
      description="Conexão oficial somente para leitura nesta fundação."
    >
      <ErrorMessage message={error} />
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">Status</p>
        <p className="mt-2 text-2xl font-bold">
          {statusLabel(data?.status || "NOT_CONFIGURED")}
        </p>
        <p className="mt-3 text-slate-600">
          {data?.status === "NOT_CONFIGURED"
            ? "Meta ainda não configurada."
            : "Os ativos são exibidos de forma mascarada e nenhum token é enviado à interface."}
        </p>
        {data?.assets && (
          <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
            {Object.entries(data.assets).map(([key, value]) => (
              <div key={key} className="rounded-lg bg-slate-50 p-3">
                <dt className="text-slate-500">{key}</dt>
                <dd className="font-semibold">
                  {String(value || "não selecionado")}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-6 text-sm font-semibold text-amber-700">
          Escrita Meta: desabilitada. Campanhas reais: zero.
        </p>
      </div>
    </AdsPageShell>
  );
}
