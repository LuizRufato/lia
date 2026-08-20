"use client";

import {
  BarChart3,
  TrendingUp,
  Users,
  MousePointerClick,
  DollarSign,
  Target,
  ArrowUpRight,
  Activity,
  HelpCircle,
} from "lucide-react";

export default function AnalyticsPage() {
  const kpis = [
    { name: "Cliques", value: "—", icon: MousePointerClick, tooltip: "" },
    { name: "Cliques Únicos", value: "—", icon: Users, tooltip: "" },
    {
      name: "Cliques Válidos",
      value: "—",
      icon: Target,
      tooltip: "Cliques que não são bots e cumprem as regras de fraude.",
    },
    {
      name: "Conversão (CVR)",
      value: "—",
      icon: Activity,
      tooltip: "Taxa de conversão: Vendas / Cliques Válidos.",
    },
    { name: "Vendas", value: "—", icon: TrendingUp, tooltip: "" },
    { name: "Comissão Aprovada", value: "—", icon: DollarSign, tooltip: "" },
    {
      name: "EPC",
      value: "—",
      icon: ArrowUpRight,
      tooltip:
        "Earning Per Click: Ganhos totais divididos pelo número de cliques.",
    },
    {
      name: "COMISSÃO POR ENVIO",
      value: "—",
      icon: ArrowUpRight,
      tooltip:
        "Média de comissão gerada a cada vez que a LIA publica uma oferta.",
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          Analytics
        </h1>
        <p className="text-gray-500 mt-1">
          Métricas de conversão, cliques e performance da LIA.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <div
            key={kpi.name}
            className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm"
          >
            <div className="flex items-center justify-between text-gray-500 mb-2">
              <div className="flex items-center">
                <kpi.icon className="w-4 h-4 mr-2" />
                <span className="text-xs font-medium uppercase tracking-wider">
                  {kpi.name}
                </span>
              </div>
              {kpi.tooltip && (
                <span title={kpi.tooltip}>
                  <HelpCircle className="w-3 h-3 text-gray-300 hover:text-gray-500 cursor-help transition-colors" />
                </span>
              )}
            </div>
            <div className="text-2xl font-bold text-gray-900">{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-6 min-h-[300px] flex flex-col justify-center items-center text-center">
          <BarChart3 className="w-12 h-12 text-gray-200 mb-4" />
          <p className="text-gray-900 font-medium">
            Desempenho ao Longo do Tempo
          </p>
          <p className="text-sm text-gray-400 mt-1 max-w-sm">
            Aguardando volume de cliques e conversões para geração do gráfico.
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 min-h-[300px] flex flex-col justify-center items-center text-center">
          <Activity className="w-12 h-12 text-gray-200 mb-4" />
          <p className="text-gray-900 font-medium">Produtos mais Clicados</p>
          <p className="text-sm text-gray-400 mt-1 max-w-xs">
            Aguardando engajamento nos links rastreados.
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 min-h-[300px] flex flex-col justify-center items-center text-center">
          <TrendingUp className="w-12 h-12 text-gray-200 mb-4" />
          <p className="text-gray-900 font-medium">
            Produtos que mais Venderam
          </p>
          <p className="text-sm text-gray-400 mt-1 max-w-xs">
            Aguardando integração de dados de vendas reais.
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 min-h-[300px] flex flex-col justify-center items-center text-center">
          <Target className="w-12 h-12 text-gray-200 mb-4" />
          <p className="text-gray-900 font-medium">Performance por Canal</p>
          <p className="text-sm text-gray-400 mt-1 max-w-xs">
            Aguardando histórico de envios e engajamento.
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 min-h-[300px] flex flex-col justify-center items-center text-center">
          <DollarSign className="w-12 h-12 text-gray-200 mb-4" />
          <p className="text-gray-900 font-medium">Marketplaces</p>
          <p className="text-sm text-gray-400 mt-1 max-w-xs">
            Aguardando comissões aprovadas das fontes.
          </p>
        </div>
      </div>
    </div>
  );
}
