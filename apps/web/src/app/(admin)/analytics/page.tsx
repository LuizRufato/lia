"use client";

import { useEffect, useState } from "react";
import {
  BarChart3,
  Bot,
  DollarSign,
  HelpCircle,
  Loader2,
  MousePointerClick,
  Receipt,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { PeriodKey, PeriodSelector } from "@/components/PeriodSelector";
import { fetchAuth } from "@/lib/api";

type Report = {
  clicks: number;
  uniqueClicks: number;
  botsExcluded: number;
  sales: number;
  grossSalesCents: number;
  expectedCommissionCents: number;
  confirmedCommissionCents: number;
  conversionRate: number | null;
  epcExpectedCents: number | null;
  history: Array<{
    at: string;
    clicks: number;
    sales: number;
    grossSalesCents: number;
    expectedCommissionCents: number;
  }>;
  topProducts: {
    clicked: Array<{ name: string; count: number }>;
    sold: Array<{ name: string; qty: number }>;
    commission: Array<{ name: string; commissionCents: number }>;
  };
  period: { timezone: string };
};

const EMPTY: Report = {
  clicks: 0,
  uniqueClicks: 0,
  botsExcluded: 0,
  sales: 0,
  grossSalesCents: 0,
  expectedCommissionCents: 0,
  confirmedCommissionCents: 0,
  conversionRate: null,
  epcExpectedCents: null,
  history: [],
  topProducts: { clicked: [], sold: [], commission: [] },
  period: { timezone: "America/Campo_Grande" },
};

const currency = (cents: number | null | undefined) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    (cents || 0) / 100,
  );

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<PeriodKey>("today");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [data, setData] = useState<Report>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (period === "custom" && (!dateFrom || !dateTo)) return;
      try {
        const params = new URLSearchParams({ period });
        if (period === "custom") {
          params.set("dateFrom", dateFrom);
          params.set("dateTo", dateTo);
        }
        const response = await fetchAuth(
          `/analytics/report?${params.toString()}`,
        );
        if (!response.ok) throw new Error("analytics unavailable");
        const next = (await response.json()) as Report;
        if (mounted) {
          setData({
            ...EMPTY,
            ...next,
            topProducts: next.topProducts || EMPTY.topProducts,
          });
          setError(false);
        }
      } catch {
        if (mounted) setError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    const interval = window.setInterval(
      load,
      period === "today" ? 5000 : 45000,
    );
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [period, dateFrom, dateTo]);

  const maxChart = Math.max(1, ...data.history.map((item) => item.clicks));
  const kpis = [
    ["Cliques válidos", data.clicks, MousePointerClick],
    ["Cliques únicos", data.uniqueClicks, Users],
    ["Vendas", data.sales, TrendingUp],
    ["Valor vendido", currency(data.grossSalesCents), Receipt],
    ["Comissão prevista", currency(data.expectedCommissionCents), DollarSign],
    ["Comissão confirmada", currency(data.confirmedCommissionCents), Target],
    [
      "Conversão",
      data.conversionRate == null
        ? "—"
        : `${(data.conversionRate * 100).toFixed(2)}%`,
      TrendingUp,
    ],
    [
      "EPC previsto",
      data.epcExpectedCents == null ? "—" : currency(data.epcExpectedCents),
      BarChart3,
    ],
  ] as const;
  const topSections: Array<{ title: string; items: string[] }> = [
    {
      title: "Produtos mais clicados",
      items: data.topProducts.clicked.map(
        (item) => `${item.name} · ${item.count}`,
      ),
    },
    {
      title: "Produtos mais vendidos",
      items: data.topProducts.sold.map((item) => `${item.name} · ${item.qty}`),
    },
    {
      title: "Maior comissão",
      items: data.topProducts.commission.map(
        (item) => `${item.name} · ${currency(item.commissionCents)}`,
      ),
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Analytics
          </h1>
          <p className="mt-1 text-gray-500">
            Desempenho de cliques, vendas e comissões reais.
          </p>
        </div>
        <PeriodSelector
          value={period}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={setPeriod}
          onDateChange={(name, value) =>
            name === "dateFrom" ? setDateFrom(value) : setDateTo(value)
          }
        />
      </div>
      <div className="text-xs text-gray-500">
        Timezone: {data.period.timezone} · EPC usa comissão prevista.
      </div>
      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Não foi possível atualizar agora.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {kpis.map(([name, value, Icon]) => (
          <div
            key={name}
            className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm"
          >
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
              <Icon className="h-4 w-4" />
              {name}
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : value}
            </div>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-blue-600" />
          <div>
            <h2 className="font-semibold text-gray-900">
              Histórico do período
            </h2>
            <p className="text-xs text-gray-500">
              Cliques válidos, vendas, valor vendido e comissão prevista.
            </p>
          </div>
        </div>
        {data.history.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">
            Sem dados no período.
          </p>
        ) : (
          <div className="flex h-56 items-end gap-2">
            {data.history.map((item) => (
              <div
                key={item.at}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1"
              >
                <span className="text-[10px] text-gray-500">
                  {item.clicks || ""}
                </span>
                <div
                  className="w-full rounded-t bg-blue-500"
                  style={{
                    height: `${Math.max(4, (item.clicks / maxChart) * 100)}%`,
                  }}
                  title={`${item.clicks} clique(s), ${item.sales} venda(s)`}
                />
                <span className="text-[10px] text-gray-400">
                  {new Date(item.at).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {topSections.map(({ title, items }) => (
          <section
            key={title}
            className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm"
          >
            <div className="mb-4 flex items-center gap-2">
              <Bot className="h-5 w-5 text-blue-600" />
              <h2 className="font-semibold text-gray-900">{title}</h2>
            </div>
            {items.length ? (
              <ul className="space-y-3 text-sm text-gray-700">
                {items.map((item) => (
                  <li
                    key={item}
                    className="border-b border-gray-50 pb-2 last:border-0"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400">
                Sem dados reais no período.
              </p>
            )}
          </section>
        ))}
      </div>
      <p className="flex items-center gap-2 text-xs text-gray-500">
        <HelpCircle className="h-4 w-4" />
        Conversão = vendas atribuídas / cliques válidos. Vendas sem atribuição
        não entram no resumo.
      </p>
    </div>
  );
}
