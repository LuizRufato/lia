"use client";

import { useEffect, useState } from "react";
import { fetchAuth } from "@/lib/api";
import { AdsPageShell, ErrorMessage, MetricCard, money } from "../ads-ui";

export default function AcquisitionAnalyticsPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void fetchAuth("/ads/acquisition/analytics")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.message || "Falha ao carregar analytics.");
        setData(body);
      })
      .catch((reason) => setError(reason.message));
  }, []);
  return (
    <AdsPageShell
      title="Analytics"
      description="Aquisição medida sem confundir intenção de entrada com membro confirmado."
    >
      <ErrorMessage message={error} />
      {data?.emptyState && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          Meta ainda não está conectada. Métricas de gasto e CPA ficam vazias
          até haver dados reais.
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Landing views hoje"
          value={data?.landingViewsToday ?? "—"}
        />
        <MetricCard
          label="Cliques Entrar"
          value={data?.joinIntentsToday ?? "—"}
          detail="GROUP_JOIN_INTENT"
        />
        <MetricCard
          label="Membros confirmados"
          value={data?.confirmedJoinsToday ?? "—"}
        />
        <MetricCard
          label="Crescimento líquido"
          value={data?.netGrowthToday ?? "—"}
        />
        <MetricCard
          label="Custo por intenção"
          value={
            data?.spend?.available
              ? money(data.costPerJoinIntentCents)
              : "Indisponível"
          }
        />
        <MetricCard
          label="Custo por membro"
          value={
            data?.spend?.available
              ? money(data.costPerConfirmedMemberCents)
              : "Indisponível"
          }
        />
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-slate-600">
        <p>
          <strong>JOIN_CTA_CLICK</strong> mede intenção.{" "}
          <strong>CONFIRMED_GROUP_JOIN</strong> só é usado quando o evento do
          grupo é confiável. Crescimento líquido é entradas confirmadas menos
          saídas.
        </p>
      </div>
    </AdsPageShell>
  );
}
