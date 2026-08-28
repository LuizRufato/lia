"use client";

import { useEffect, useState } from "react";
import { fetchAuth } from "@/lib/api";
import { AdsPageShell, ErrorMessage, MetricCard, money } from "./ads-ui";

export default function AdsDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAuth("/ads/dashboard")
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(body.message || "Não foi possível carregar o Ads.");
        setData(body);
      })
      .catch((reason) => setError(reason.message));
  }, []);

  return (
    <AdsPageShell
      title="LIA Ads"
      description="Fundação administrativa para campanhas Shopee. A entrega real permanece desligada."
    >
      <ErrorMessage message={error} />
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        As métricas de entrega, impressões e cliques permanecem em zero até a
        ativação explícita das fases futuras.
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Créditos adicionados"
          value={data ? money(data.totalCreditsCents) : "—"}
        />
        <MetricCard
          label="Receita Ads"
          value={data ? money(data.adRevenueCents) : "—"}
          detail="Cobranças reais do ledger"
        />
        <MetricCard
          label="Saldo disponível"
          value={data ? money(data.availableBalanceCents) : "—"}
        />
        <MetricCard
          label="Campanhas ativas"
          value={data?.activeCampaigns ?? "—"}
        />
        <MetricCard
          label="Aguardando revisão"
          value={data?.pendingReviewCampaigns ?? "—"}
        />
        <MetricCard label="Anunciantes" value={data?.advertisersCount ?? "—"} />
      </div>
    </AdsPageShell>
  );
}
