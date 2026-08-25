"use client";

import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Loader2,
  Receipt,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";
import { PeriodKey, PeriodSelector } from "@/components/PeriodSelector";
import { fetchAuth } from "@/lib/api";

type Sale = {
  id: string;
  purchaseTime: string;
  marketplace: string;
  product: string;
  attributionStatus: string;
  commissionStatus: string;
  grossSalesCents: number;
  commissionCents: number;
  orders: Array<{
    status: string;
    items: Array<{
      name: string;
      qty: number;
      itemPriceCents: number;
      actualAmountCents: number;
      commissionCents: number | null;
    }>;
  }>;
  adminAlert: {
    status: string;
    createdAt: string;
    sentAt: string | null;
    deliveries: Array<{
      status: string;
      sentAt: string | null;
      error: string | null;
    }>;
  } | null;
};

type SalesResponse = {
  period: { timezone: string };
  summary: {
    sales: number;
    grossSalesCents: number;
    expectedCommissionCents: number;
    confirmedCommissionCents: number;
    pendingCommissionCents: number;
    cancelledCommissionCents: number;
    ticketAverageCents: number;
  };
  items: Sale[];
  pagination: { page: number; pages: number; total: number };
};

const EMPTY: SalesResponse = {
  period: { timezone: "America/Campo_Grande" },
  summary: {
    sales: 0,
    grossSalesCents: 0,
    expectedCommissionCents: 0,
    confirmedCommissionCents: 0,
    pendingCommissionCents: 0,
    cancelledCommissionCents: 0,
    ticketAverageCents: 0,
  },
  items: [],
  pagination: { page: 1, pages: 0, total: 0 },
};
const currency = (cents: number | null | undefined) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    (cents || 0) / 100,
  );
const statusLabel = (status: string) =>
  ({
    PENDING: "Pendente",
    ESTIMATED: "Estimada",
    CONFIRMED: "Confirmada",
    CANCELLED: "Cancelada",
    ATTRIBUTED: "Atribuída",
    UNATTRIBUTED: "Não atribuída",
    SENT: "Enviado",
    NOT_REQUESTED: "Não solicitado",
  })[status] || status;
const badge = (status: string) =>
  status === "CONFIRMED" || status === "SENT" || status === "ATTRIBUTED"
    ? "bg-emerald-50 text-emerald-700"
    : status === "CANCELLED" || status === "UNATTRIBUTED"
      ? "bg-red-50 text-red-700"
      : "bg-amber-50 text-amber-700";

export default function SalesPage() {
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [commissionStatus, setCommissionStatus] = useState("");
  const [orderStatus, setOrderStatus] = useState("");
  const [marketplace, setMarketplace] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<SalesResponse>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (period === "custom" && (!dateFrom || !dateTo)) return;
      const params = new URLSearchParams({
        period,
        page: String(page),
        limit: "20",
      });
      if (period === "custom") {
        params.set("dateFrom", dateFrom);
        params.set("dateTo", dateTo);
      }
      if (commissionStatus) params.set("commissionStatus", commissionStatus);
      if (orderStatus) params.set("orderStatus", orderStatus);
      if (marketplace) params.set("marketplace", marketplace);
      if (search.trim()) params.set("search", search.trim());
      setLoading(true);
      const response = await fetchAuth(`/sales?${params.toString()}`);
      if (response.ok && mounted) setData(await response.json());
      if (mounted) setLoading(false);
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [
    period,
    dateFrom,
    dateTo,
    commissionStatus,
    orderStatus,
    marketplace,
    search,
    page,
  ]);

  const summary = data.summary;
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Vendas
          </h1>
          <p className="mt-1 text-gray-500">
            Histórico de conversões reais atribuídas à LIA.
          </p>
        </div>
        <PeriodSelector
          value={period}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={(value) => {
            setPeriod(value);
            setPage(1);
          }}
          onDateChange={(name, value) => {
            name === "dateFrom" ? setDateFrom(value) : setDateTo(value);
            setPage(1);
          }}
        />
      </div>
      <div className="text-xs text-gray-500">
        Timezone: {data.period.timezone} · Valor vendido usa o valor efetivo
        reportado por item.
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <ShoppingBag className="mb-2 h-5 w-5 text-blue-600" />
          <p className="text-xs uppercase text-gray-500">Vendas</p>
          <p className="text-2xl font-bold">{summary.sales}</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <Receipt className="mb-2 h-5 w-5 text-blue-600" />
          <p className="text-xs uppercase text-gray-500">Valor vendido</p>
          <p className="text-2xl font-bold">
            {currency(summary.grossSalesCents)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <DollarSign className="mb-2 h-5 w-5 text-blue-600" />
          <p className="text-xs uppercase text-gray-500">Comissão prevista</p>
          <p className="text-2xl font-bold">
            {currency(summary.expectedCommissionCents)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <TrendingUp className="mb-2 h-5 w-5 text-blue-600" />
          <p className="text-xs uppercase text-gray-500">Comissão confirmada</p>
          <p className="text-2xl font-bold">
            {currency(summary.confirmedCommissionCents)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
          Marketplace
          <select
            value={marketplace}
            onChange={(event) => {
              setMarketplace(event.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            <option value="SHOPEE">Shopee</option>
            <option value="MERCADO_LIVRE">Mercado Livre</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
          Comissão
          <select
            value={commissionStatus}
            onChange={(event) => {
              setCommissionStatus(event.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            <option value="PENDING">Pendente</option>
            <option value="ESTIMATED">Estimada</option>
            <option value="CONFIRMED">Confirmada</option>
            <option value="CANCELLED">Cancelada</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
          Pedido
          <select
            value={orderStatus}
            onChange={(event) => {
              setOrderStatus(event.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            <option value="UNPAID">Não pago</option>
            <option value="PENDING">Pendente</option>
            <option value="COMPLETED">Concluído</option>
            <option value="CANCELLED">Cancelado</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
          Buscar produto
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Nome do produto"
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>
      <section className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-5 py-4">Data/hora</th>
                <th className="px-5 py-4">Produto</th>
                <th className="px-5 py-4">Marketplace</th>
                <th className="px-5 py-4">Valor vendido</th>
                <th className="px-5 py-4">Comissão</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4">Alerta</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-blue-600" />
                  </td>
                </tr>
              ) : data.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-12 text-center text-gray-400"
                  >
                    Nenhuma venda atribuída no período.
                  </td>
                </tr>
              ) : (
                data.items.map((sale) => (
                  <tr key={sale.id} className="border-t border-gray-100">
                    <td className="whitespace-nowrap px-5 py-4 text-gray-500">
                      {new Date(sale.purchaseTime).toLocaleString("pt-BR")}
                    </td>
                    <td className="max-w-xs px-5 py-4 font-medium text-gray-900">
                      {sale.product}
                      <button
                        onClick={() =>
                          setSelected(selected === sale.id ? null : sale.id)
                        }
                        className="ml-2 text-xs font-medium text-blue-600 hover:underline"
                      >
                        {selected === sale.id ? "Fechar" : "Detalhes"}
                      </button>
                    </td>
                    <td className="px-5 py-4">{sale.marketplace}</td>
                    <td className="px-5 py-4">
                      {currency(sale.grossSalesCents)}
                    </td>
                    <td className="px-5 py-4">
                      {currency(sale.commissionCents)}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${badge(sale.commissionStatus)}`}
                      >
                        {statusLabel(sale.commissionStatus)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {sale.adminAlert ? (
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-medium ${badge(sale.adminAlert.status)}`}
                        >
                          {statusLabel(sale.adminAlert.status)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))
              )}
              {selected && data.items.find((sale) => sale.id === selected) && (
                <tr className="border-t bg-blue-50/40">
                  <td colSpan={7} className="px-5 py-5">
                    <SaleDetails
                      sale={data.items.find((item) => item.id === selected)!}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-gray-100 px-5 py-4 text-sm text-gray-500">
          <span>{data.pagination.total} venda(s)</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
              className="rounded border p-1 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span>
              {page} / {Math.max(1, data.pagination.pages)}
            </span>
            <button
              disabled={page >= data.pagination.pages}
              onClick={() => setPage((value) => value + 1)}
              className="rounded border p-1 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function SaleDetails({ sale }: { sale: Sale }) {
  return (
    <div className="grid gap-4 text-sm md:grid-cols-3">
      <div>
        <p className="font-semibold text-gray-900">Itens</p>
        {sale.orders
          .flatMap((order) => order.items)
          .map((item) => (
            <p key={`${item.name}-${item.qty}`} className="mt-1 text-gray-600">
              {item.name} · qtd. {item.qty} · efetivo{" "}
              {currency(item.actualAmountCents)}
            </p>
          ))}
      </div>
      <div>
        <p className="font-semibold text-gray-900">Atribuição e pedido</p>
        <p className="mt-1 text-gray-600">
          {statusLabel(sale.attributionStatus)} · pedido{" "}
          {sale.orders[0]?.status ? statusLabel(sale.orders[0].status) : "—"}
        </p>
        <p className="text-gray-600">
          Comissão {statusLabel(sale.commissionStatus)}
        </p>
      </div>
      <div>
        <p className="font-semibold text-gray-900">Admin Alert</p>
        <p className="mt-1 text-gray-600">
          {sale.adminAlert
            ? `${statusLabel(sale.adminAlert.status)} · ${sale.adminAlert.sentAt ? new Date(sale.adminAlert.sentAt).toLocaleString("pt-BR") : "sem horário"}`
            : "Não criado"}
        </p>
      </div>
    </div>
  );
}
