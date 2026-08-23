"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Bot,
  DollarSign,
  HelpCircle,
  Loader2,
  MousePointerClick,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { fetchAuth } from "@/lib/api";

type RecentClick = {
  at: string;
  device: string;
  browser: string;
  channel: string;
  marketplace: string;
  product: string;
};

type AnalyticsData = {
  clicksToday: number;
  clicksNow: number;
  uniqueClicks: number;
  botsExcluded: number;
  publishedOffers: number;
  topProducts: Array<{ name: string; clicks: number }>;
  timeline: Array<{ at: string; clicks: number }>;
  recentClicks: RecentClick[];
};

const EMPTY: AnalyticsData = {
  clicksToday: 0,
  clicksNow: 0,
  uniqueClicks: 0,
  botsExcluded: 0,
  publishedOffers: 0,
  topProducts: [],
  timeline: [],
  recentClicks: [],
};

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const response = await fetchAuth("/analytics/realtime");
        if (!response.ok) throw new Error("analytics unavailable");
        const next = (await response.json()) as Partial<AnalyticsData>;
        if (mounted) {
          setData({ ...EMPTY, ...next });
          setError(false);
        }
      } catch {
        if (mounted) setError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    const interval = window.setInterval(load, 3000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const maxTimeline = useMemo(
    () => Math.max(1, ...data.timeline.map((item) => item.clicks)),
    [data.timeline],
  );

  const kpis = [
    { name: "Cliques", value: data.clicksToday, icon: MousePointerClick },
    { name: "Cliques Únicos", value: data.uniqueClicks, icon: Users },
    {
      name: "Cliques Válidos",
      value: data.clicksToday,
      icon: Target,
      tooltip: "Cliques humanos válidos; crawlers ficam fora desta métrica.",
    },
    { name: "Vendas", value: data.publishedOffers, icon: TrendingUp },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Analytics</h1>
          <p className="text-gray-500 mt-1">Métricas de conversão, cliques e performance da LIA.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Atualização automática a cada 3s
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Não foi possível atualizar agora. Tentaremos novamente automaticamente.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <div key={kpi.name} className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between text-gray-500 mb-2">
              <div className="flex items-center">
                <kpi.icon className="w-4 h-4 mr-2" />
                <span className="text-xs font-medium uppercase tracking-wider">{kpi.name}</span>
              </div>
              {kpi.tooltip && <span title={kpi.tooltip}><HelpCircle className="w-3 h-3 text-gray-300" /></span>}
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : kpi.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-6">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            <div>
              <h2 className="font-semibold text-gray-900">Cliques em Tempo Real</h2>
              <p className="text-xs text-gray-500">Janelas de cinco minutos, somente cliques válidos.</p>
            </div>
          </div>
          {data.timeline.length === 0 ? (
            <p className="text-sm text-gray-400 py-16 text-center">Aguardando cliques válidos.</p>
          ) : (
            <div className="flex items-end gap-2 h-48">
              {data.timeline.map((item) => (
                <div key={item.at} className="flex-1 h-full flex flex-col items-center justify-end gap-2">
                  <span className="text-[10px] text-gray-500">{item.clicks || ""}</span>
                  <div
                    className="w-full rounded-t bg-blue-500 min-h-1 transition-all"
                    style={{ height: `${Math.max(4, (item.clicks / maxTimeline) * 100)}%` }}
                    title={`${item.clicks} clique(s)`}
                  />
                  <span className="text-[10px] text-gray-400">{formatTime(item.at).slice(0, 5)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-5">
            <Activity className="w-5 h-5 text-blue-600" />
            <h2 className="font-semibold text-gray-900">Produtos mais clicados</h2>
          </div>
          {data.topProducts.length === 0 ? (
            <p className="text-sm text-gray-400 py-12 text-center">Aguardando engajamento.</p>
          ) : (
            <div className="space-y-4">
              {data.topProducts.map((item) => (
                <div key={item.name} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-700 truncate">{item.name}</span>
                  <span className="text-sm font-semibold text-gray-900">{item.clicks}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-6 pt-4 border-t text-xs text-gray-500 flex items-center gap-2">
            <Bot className="w-4 h-4" /> {data.botsExcluded} preview/bot(s) excluído(s)
          </div>
        </section>
      </div>

      <section className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">Atividade recente</h2>
            <p className="text-xs text-gray-500">Dados agregados, sem IP bruto.</p>
          </div>
          <span className="text-xs text-gray-500">{data.clicksNow} nos últimos 5 minutos</span>
        </div>
        {data.recentClicks.length === 0 ? (
          <p className="text-sm text-gray-400 py-12 text-center">Nenhum clique válido recente.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-6 py-3">Hora</th>
                  <th className="px-6 py-3">Produto</th>
                  <th className="px-6 py-3">Dispositivo</th>
                  <th className="px-6 py-3">Canal</th>
                  <th className="px-6 py-3">Marketplace</th>
                </tr>
              </thead>
              <tbody>
                {data.recentClicks.map((click) => (
                  <tr key={`${click.at}-${click.product}`} className="border-t">
                    <td className="px-6 py-3 text-gray-500 whitespace-nowrap">{formatTime(click.at)}</td>
                    <td className="px-6 py-3 text-gray-900 max-w-xs truncate">{click.product}</td>
                    <td className="px-6 py-3 text-gray-600">{click.device}</td>
                    <td className="px-6 py-3 text-gray-600">{click.channel}</td>
                    <td className="px-6 py-3 text-gray-600">{click.marketplace}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm"><div className="flex items-center gap-2 text-gray-500 mb-2"><DollarSign className="w-4 h-4" /><span className="text-xs uppercase">Comissão aprovada</span></div><div className="text-2xl font-bold text-gray-900">—</div></div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm"><div className="flex items-center gap-2 text-gray-500 mb-2"><ArrowUpRight className="w-4 h-4" /><span className="text-xs uppercase">EPC</span></div><div className="text-2xl font-bold text-gray-900">—</div></div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm"><div className="flex items-center gap-2 text-gray-500 mb-2"><TrendingUp className="w-4 h-4" /><span className="text-xs uppercase">Conversão</span></div><div className="text-2xl font-bold text-gray-900">—</div></div>
      </div>
    </div>
  );
}
