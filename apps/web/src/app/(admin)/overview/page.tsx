"use client";

import { useEffect, useState } from "react";
import { fetchAuth } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";

import {
  Server,
  Database,
  Globe,
  Box,
  Loader2,
  MousePointerClick,
  Target,
  TrendingUp,
  DollarSign,
  ArrowUpRight,
  Eye,
  CheckCircle2,
  Send,
  Activity,
  Bot,
  type LucideIcon,
} from "lucide-react";

interface SystemHealth {
  core: Array<{ name: string; status: string }>;
  integrations: Array<{ name: string; status: string; type: string }>;
}

type Kpi = {
  name: string;
  value: string;
  icon: LucideIcon;
  tooltip?: string;
};

export default function OverviewPage() {
  const [health, setHealth] = useState<any>(null);
  const [autopilotMode, setAutopilotMode] = useState<string>("OFF");
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    const fetchAll = async () => {
      try {
        const healthRes = await fetchAuth("/health/system");
        if (healthRes.ok) setHealth(await healthRes.json());

        const apRes = await fetchAuth("/autopilot/dashboard");
        if (apRes.ok) {
          const apData = await apRes.json();
          setAutopilotMode(apData.mode || "OFF");
        }

        const analyticsRes = await fetchAuth("/analytics/overview");
        if (analyticsRes.ok) {
          setAnalytics(await analyticsRes.json());
        }
      } catch (err: any) {
        console.error("Failed to fetch", err);
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
    intervalId = setInterval(fetchAll, 30000);
    return () => clearInterval(intervalId);
  }, []);

  if (loading)
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(cents / 100);
  };

  const kpisTop: Kpi[] = [
    {
      name: "Vendas Hoje",
      value: analytics?.today?.sales?.toString() || "0",
      icon: TrendingUp,
    },
    {
      name: "Comissão Estimada (Hoje)",
      value: formatCurrency(analytics?.today?.commissionCents || 0),
      icon: DollarSign,
    },
    {
      name: "Vendas Ontem",
      value: analytics?.yesterday?.sales?.toString() || "0",
      icon: ArrowUpRight,
    },
    {
      name: "Comissão Estimada (Ontem)",
      value: formatCurrency(analytics?.yesterday?.commissionCents || 0),
      icon: Target,
    },
  ];

  const kpisBottom: Kpi[] = [
    { name: "Ofertas Analisadas", value: "0", icon: Eye },
    { name: "Ofertas Aprovadas", value: "0", icon: CheckCircle2 },
    { name: "Publicações Hoje", value: "0", icon: Send },
    {
      name: "Conversão",
      value: "—",
      icon: Activity,
      tooltip: "Aguardando integração de vendas",
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Top Header - Premium LIA Status */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
            <Bot className="w-6 h-6 text-blue-600" />
            LIA — Piloto Automático
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            {autopilotMode === "OFF"
              ? "LIA está pausada"
              : autopilotMode === "DRY_RUN"
                ? "LIA está simulando"
                : autopilotMode === "MANUAL"
                  ? "Modo manual"
                  : "LIA está trabalhando"}
          </p>
        </div>
        <div>
          <span
            className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold border ${
              autopilotMode === "AUTO"
                ? "bg-green-50 text-green-700 border-green-200"
                : autopilotMode === "DRY_RUN"
                  ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                  : autopilotMode === "MANUAL"
                    ? "bg-blue-50 text-blue-700 border-blue-200"
                    : "bg-gray-100 text-gray-700 border-gray-300"
            }`}
          >
            {autopilotMode === "AUTO" && (
              <span className="w-2 h-2 mr-2 bg-green-500 rounded-full animate-pulse" />
            )}
            Status: {autopilotMode}
          </span>
        </div>
      </div>

      {/* KPIs Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpisTop.map((kpi) => (
          <div
            key={kpi.name}
            className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm relative group"
          >
            <div className="flex items-center text-gray-500 mb-2">
              <kpi.icon className="w-4 h-4 mr-2" />
              <span className="text-xs font-medium uppercase tracking-wider">
                {kpi.name}
              </span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{kpi.value}</div>
            {kpi.tooltip && (
              <div className="absolute hidden group-hover:block bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded whitespace-nowrap z-10">
                {kpi.tooltip}
              </div>
            )}
          </div>
        ))}
        {kpisBottom.map((kpi) => (
          <div
            key={kpi.name}
            className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm relative group"
          >
            <div className="flex items-center text-gray-500 mb-2">
              <kpi.icon className="w-4 h-4 mr-2" />
              <span className="text-xs font-medium uppercase tracking-wider">
                {kpi.name}
              </span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{kpi.value}</div>
            {kpi.tooltip && (
              <div className="absolute hidden group-hover:block bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded whitespace-nowrap z-10">
                {kpi.tooltip}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* System Health Compact */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-900">
            Saúde do Sistema
          </h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {health?.core?.map((service: any) => (
              <div key={service.name} className="flex flex-col gap-2">
                <span className="text-xs font-medium text-gray-500">
                  {service.name}
                </span>
                <StatusBadge status={service.status} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
