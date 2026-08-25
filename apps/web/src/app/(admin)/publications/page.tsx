"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Send,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAuth } from "@/lib/api";

const TIMEZONE = "America/Campo_Grande";
const PAGE_SIZE = 20;

type Period = "TODAY" | "LAST_7" | "LAST_30" | "ALL";

type Publication = {
  publicationId: string;
  offerId: string | null;
  productTitle: string;
  productImageUrl: string | null;
  channelId: string;
  channelName: string;
  provider: string | null;
  marketplace: string | null;
  status: string;
  statusLabel: string;
  createdAt: string;
  publishedAt: string | null;
  liaScore: number | null;
  trackedLink: { slug: string; url: string } | null;
  validClicks: number;
  sales: number | null;
  commissionCents: number | null;
};

type PublicationResponse = {
  items: Publication[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

type OptionsResponse = {
  channels: Array<{ id: string; displayName: string }>;
  marketplaces: string[];
};

const STATUS_OPTIONS = [
  "PENDING",
  "PUBLISHING",
  "PUBLISHED",
  "WAITING_CONNECTION",
  "RETRYABLE",
  "DELIVERY_UNKNOWN",
  "FAILED",
];

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-700",
  PUBLISHING: "bg-blue-100 text-blue-700",
  PUBLISHED: "bg-emerald-100 text-emerald-700",
  WAITING_CONNECTION: "bg-amber-100 text-amber-800",
  RETRYABLE: "bg-orange-100 text-orange-800",
  DELIVERY_UNKNOWN: "bg-violet-100 text-violet-800",
  FAILED: "bg-red-100 text-red-700",
};

function formatLocalDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function periodDates(period: Period) {
  if (period === "ALL") return {};
  const days = period === "TODAY" ? 0 : period === "LAST_7" ? 6 : 29;
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { dateFrom: formatLocalDate(from) };
}

function formatDate(value: string | null, fallback: string) {
  return new Date(value || fallback).toLocaleString("pt-BR", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMoney(cents: number | null) {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function statusLabel(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function PublicationsPage() {
  const [items, setItems] = useState<Publication[]>([]);
  const [meta, setMeta] = useState<PublicationResponse>({
    items: [],
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  });
  const [channels, setChannels] = useState<OptionsResponse["channels"]>([]);
  const [marketplaces, setMarketplaces] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [channelId, setChannelId] = useState("");
  const [status, setStatus] = useState("");
  const [marketplace, setMarketplace] = useState("");
  const [period, setPeriod] = useState<Period>("ALL");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    let mounted = true;
    void fetchAuth("/publications/options")
      .then(async (response) => {
        if (!response.ok) throw new Error("options unavailable");
        return (await response.json()) as OptionsResponse;
      })
      .then((data) => {
        if (mounted) {
          setChannels(data.channels || []);
          setMarketplaces(data.marketplaces || []);
        }
      })
      .catch(() => {
        // Filter options are best effort; the publication list remains usable.
      });
    return () => {
      mounted = false;
    };
  }, []);

  const load = useCallback(
    async (background = false) => {
      if (background) setRefreshing(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(PAGE_SIZE),
        });
        if (search) params.set("search", search);
        if (channelId) params.set("channelId", channelId);
        if (status) params.set("status", status);
        if (marketplace) params.set("marketplace", marketplace);
        Object.entries(periodDates(period)).forEach(([key, value]) =>
          params.set(key, value),
        );

        const response = await fetchAuth(`/publications?${params.toString()}`);
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(
            payload?.message || "Não foi possível carregar as publicações.",
          );
        }
        const data = (await response.json()) as PublicationResponse;
        setItems(data.items || []);
        setMeta(data);
        setError("");
      } catch (loadError) {
        console.error(
          "Publication history refresh failed",
          loadError instanceof Error ? loadError.message : "unknown",
        );
        setError(
          "Não foi possível carregar o histórico agora. Tentaremos novamente.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [channelId, marketplace, page, period, search, status],
  );

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(true), 5000);
    return () => window.clearInterval(interval);
  }, [load]);

  const hasFilters = Boolean(
    search || channelId || status || marketplace || period !== "ALL",
  );
  const rangeStart = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const rangeEnd = Math.min(meta.page * meta.limit, meta.total);

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setChannelId("");
    setStatus("");
    setMarketplace("");
    setPeriod("ALL");
    setPage(1);
  };

  const copyLink = async (item: Publication) => {
    if (!item.trackedLink) return;
    await navigator.clipboard.writeText(item.trackedLink.url);
    setCopiedSlug(item.trackedLink.slug);
    window.setTimeout(() => setCopiedSlug(null), 1500);
  };

  const title = useMemo(
    () =>
      hasFilters
        ? "Nenhuma publicação encontrada"
        : "Nenhuma publicação enviada",
    [hasFilters],
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Publicações
          </h1>
          <p className="mt-1 text-gray-500">
            Histórico real de ofertas publicadas pela LIA.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {refreshing ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
          )}
          Atualização automática a cada 5s
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b bg-gray-50 p-4 xl:flex-row xl:items-center">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar produto..."
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-4 text-sm shadow-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <select
            value={channelId}
            onChange={(event) => {
              setChannelId(event.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm"
          >
            <option value="">Todos os canais</option>
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.displayName}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm"
          >
            <option value="">Todos os status</option>
            {STATUS_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {statusLabel(value)}
              </option>
            ))}
          </select>
          <select
            value={marketplace}
            onChange={(event) => {
              setMarketplace(event.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm"
          >
            <option value="">Todos os marketplaces</option>
            {marketplaces.map((value) => (
              <option key={value} value={value}>
                {value.replace("_", " ")}
              </option>
            ))}
          </select>
          <select
            value={period}
            onChange={(event) => {
              setPeriod(event.target.value as Period);
              setPage(1);
            }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm"
          >
            <option value="ALL">Todo o período</option>
            <option value="TODAY">Hoje</option>
            <option value="LAST_7">Últimos 7 dias</option>
            <option value="LAST_30">Últimos 30 dias</option>
          </select>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              Limpar
            </button>
          )}
        </div>

        {error && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="border-b bg-white text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-5 py-4 font-medium">Produto</th>
                <th className="px-5 py-4 font-medium">Canal</th>
                <th className="px-5 py-4 font-medium">Marketplace</th>
                <th className="px-5 py-4 font-medium">Status</th>
                <th className="px-5 py-4 font-medium">Data/hora</th>
                <th className="px-5 py-4 font-medium">LIA Score</th>
                <th className="px-5 py-4 font-medium">Smart Link</th>
                <th className="px-5 py-4 font-medium">Cliques válidos</th>
                <th className="px-5 py-4 font-medium">Vendas</th>
                <th className="px-5 py-4 font-medium">Comissão</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-6 py-16 text-center text-gray-500"
                  >
                    <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                  </td>
                </tr>
              ) : error && items.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-6 py-16 text-center text-gray-500"
                  >
                    O histórico não está disponível neste momento.
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-16 text-center">
                    <div className="mx-auto flex max-w-sm flex-col items-center">
                      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border bg-gray-50 text-gray-400">
                        <Send className="h-6 w-6" />
                      </div>
                      <h3 className="mb-1 font-semibold text-gray-900">
                        {title}
                      </h3>
                      <p className="text-center text-sm text-gray-500">
                        {hasFilters
                          ? "Tente remover ou ajustar os filtros."
                          : "As publicações reais aparecerão aqui quando forem enviadas para um canal."}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const link = item.trackedLink;
                  return (
                    <tr
                      key={item.publicationId}
                      className="align-middle hover:bg-gray-50/70"
                    >
                      <td className="max-w-[260px] px-5 py-4">
                        <div className="flex items-center gap-3">
                          {item.productImageUrl ? (
                            <img
                              src={item.productImageUrl}
                              alt=""
                              className="h-10 w-10 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-lg bg-gray-100" />
                          )}
                          <span
                            className="truncate font-medium text-gray-900"
                            title={item.productTitle}
                          >
                            {item.productTitle}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-medium text-gray-800">
                          {item.channelName}
                        </div>
                        <div className="text-xs text-gray-500">
                          {item.provider || "—"}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-gray-700">
                        {item.marketplace || "—"}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[item.status] || "bg-gray-100 text-gray-700"}`}
                        >
                          {item.statusLabel || statusLabel(item.status)}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-gray-600">
                        {formatDate(item.publishedAt, item.createdAt)}
                      </td>
                      <td className="px-5 py-4 font-semibold text-gray-800">
                        {item.liaScore == null ? "—" : item.liaScore}
                      </td>
                      <td className="px-5 py-4">
                        {link ? (
                          <div className="flex items-center gap-2">
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noreferrer"
                              className="max-w-[170px] truncate text-blue-600 hover:underline"
                              title={link.url}
                            >
                              go.botlia.com.br/{link.slug}
                            </a>
                            <button
                              onClick={() => void copyLink(item)}
                              title="Copiar Smart Link"
                              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                            >
                              {copiedSlug === link.slug ? (
                                <span className="text-[10px] text-emerald-600">
                                  OK
                                </span>
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noreferrer"
                              title="Abrir Smart Link"
                              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-gray-700">
                        {item.validClicks}
                      </td>
                      <td className="px-5 py-4 text-gray-700">
                        {item.sales == null ? "—" : item.sales}
                      </td>
                      <td className="px-5 py-4 text-gray-700">
                        {formatMoney(item.commissionCents)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t px-5 py-4 text-sm text-gray-500 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {meta.total
              ? `Mostrando ${rangeStart}–${rangeEnd} de ${meta.total}`
              : "Nenhum resultado"}
          </span>
          <div className="flex items-center gap-3">
            <span>
              Página {meta.page} de {meta.totalPages}
            </span>
            <button
              disabled={!meta.hasPreviousPage || loading}
              onClick={() => setPage((value) => value - 1)}
              className="rounded-lg border p-1.5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              disabled={!meta.hasNextPage || loading}
              onClick={() => setPage((value) => value + 1)}
              className="rounded-lg border p-1.5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <CalendarDays className="h-3.5 w-3.5" /> Horários exibidos em{" "}
        {TIMEZONE.replace("_", " ")}.
      </div>
    </div>
  );
}
