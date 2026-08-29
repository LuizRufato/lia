"use client";

import { useEffect, useState } from "react";
import { fetchAuth } from "@/lib/api";
import { AdsPageShell, ErrorMessage, MetricCard, money } from "./ads-ui";

export default function AdsDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAuth("/ads/acquisition/overview")
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(
            body.message || "Não foi possível carregar o LIA Ads.",
          );
        setData(body);
      })
      .catch((reason) => setError(reason.message));
  }, []);

  return (
    <AdsPageShell
      title="LIA Ads"
      description="Aquisição de membros para os grupos LIA Achou. A publicação Meta permanece desligada."
    >
      <ErrorMessage message={error} />
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        As métricas de entrega, impressões e cliques permanecem em zero até a
        ativação explícita das fases futuras.
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Membros"
          value={data?.members?.totalMembers ?? "—"}
          detail="Somente grupos oficiais registrados"
        />
        <MetricCard
          label="Entraram hoje"
          value={data?.members?.joinsToday ?? "—"}
          detail="Confirmação real do grupo"
        />
        <MetricCard
          label="Crescimento líquido"
          value={data?.members?.netGrowthToday ?? "—"}
        />
        <MetricCard
          label="Join intents hoje"
          value={data?.events?.joinIntentsToday ?? "—"}
          detail="Cliques no CTA, não membros"
        />
        <MetricCard
          label="Capacidade restante"
          value={data?.members?.remainingCapacity ?? "—"}
        />
        <MetricCard
          label="CPA meta"
          value={data ? money(data.cpa?.targetCents) : "—"}
          detail="Meta padrão: R$ 1,00"
        />
        <MetricCard
          label="Campanhas ativas"
          value={data?.activeCampaigns ?? "—"}
        />
        <MetricCard
          label="Sugestões abertas"
          value={data?.openSuggestions ?? "—"}
        />
        <MetricCard
          label="Meta"
          value={data?.metaConnection?.status || "NOT_CONFIGURED"}
        />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
        <p className="font-semibold text-slate-900">Estado desta fase</p>
        <p className="mt-2">
          Os dados de crescimento vêm apenas do registro de grupos e dos eventos
          reais. Gasto, impressões e alcance ficam indisponíveis até uma conexão
          Meta aprovada.
        </p>
        <p className="mt-2 font-medium">
          Publicação automática e criação de grupos: desabilitadas.
        </p>
      </div>
    </AdsPageShell>
  );
}
