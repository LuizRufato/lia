"use client";

import { useState, useEffect } from "react";
import { fetchAuth } from "@/lib/api";
import {
  ShieldAlert,
  Activity,
  MonitorPlay,
  AlertTriangle,
  Save,
  Loader2,
  Plus,
  Tags,
  X,
} from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";

type CatalogPolicy = {
  mode: "OPEN" | "SELECTED_CATEGORIES";
  allowedCategories: string[];
  blockedCategories: string[];
  blockedKeywords: string[];
  minSalesCount: number | null;
  minRating: number | null;
  productCooldownHours: number | null;
  maxPerCategoryPerDay: number | null;
};

const EMPTY_CATALOG_POLICY: CatalogPolicy = {
  mode: "OPEN",
  allowedCategories: [],
  blockedCategories: [],
  blockedKeywords: [],
  minSalesCount: null,
  minRating: null,
  productCooldownHours: null,
  maxPerCategoryPerDay: null,
};

function displayCatalogCategory(value: string) {
  return /^\d+(\s*,\s*\d+)*$/.test(value)
    ? "Categoria Shopee não classificada"
    : value;
}

function formatRelativeTime(value: string | null | undefined) {
  if (!value) return "Não registrado";

  const elapsedSeconds = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 1000),
  );
  if (elapsedSeconds < 60) return `há ${elapsedSeconds} segundos`;

  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `há ${elapsedMinutes} min`;

  const elapsedHours = Math.round(elapsedMinutes / 60);
  return `há ${elapsedHours} h`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Não registrado";
  return new Date(value).toLocaleString("pt-BR");
}

export default function AutopilotDashboard() {
  const [data, setData] = useState<any>(null);
  const [dashboardLoaded, setDashboardLoaded] = useState(false);
  const [catalogCategories, setCatalogCategories] = useState<any[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [categoriesError, setCategoriesError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [blockedCategoryInput, setBlockedCategoryInput] = useState("");
  const [blockedKeywordInput, setBlockedKeywordInput] = useState("");
  const [form, setForm] = useState({
    mode: "OFF",
    minScore: 0,
    minimumCommissionCents: 500,
    maxDailyPosts: 0,
    intervalMinutes: 0,
    minSendIntervalMinutes: null as number | null,
    maxSendIntervalMinutes: null as number | null,
    allowedStartMinute: 0,
    allowedEndMinute: 0,
    timezone: "America/Campo_Grande",
    enabledChannelIds: [] as string[],
    enabledMarketplaceIds: [] as string[],
    catalogPolicy: EMPTY_CATALOG_POLICY,
  });

  useEffect(() => {
    fetchData(true, true);
    void fetchCategories();
    const refreshTimer = window.setInterval(() => {
      fetchData(false, false);
    }, 30_000);

    return () => window.clearInterval(refreshTimer);
  }, []);

  const fetchData = async (showLoading = true, syncForm = true) => {
    if (showLoading) setLoading(true);
    setLoadError("");
    try {
      const res = await fetchAuth("/autopilot/dashboard");
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setData(json);
      setDashboardLoaded(true);

      if (syncForm && json.config) {
        setForm({
          mode: json.mode,
          minScore: json.config.minScore,
          minimumCommissionCents: json.config.minimumCommissionCents,
          maxDailyPosts: json.config.maxDailyPosts,
          intervalMinutes: json.config.intervalMinutes,
          minSendIntervalMinutes: json.config.minSendIntervalMinutes ?? null,
          maxSendIntervalMinutes: json.config.maxSendIntervalMinutes ?? null,
          allowedStartMinute: json.config.allowedStartMinute,
          allowedEndMinute: json.config.allowedEndMinute,
          timezone: json.config.timezone || "America/Campo_Grande",
          enabledChannelIds: json.config.channels.map(
            (channel: any) => channel.id,
          ),
          enabledMarketplaceIds: json.config.marketplaces.map(
            (marketplace: any) => marketplace.id,
          ),
          catalogPolicy: {
            ...EMPTY_CATALOG_POLICY,
            ...(json.config.catalogPolicy || {}),
          },
        });
      }
    } catch (err) {
      setDashboardLoaded(false);
      setData(null);
      setLoadError(
        "Não foi possível carregar as configurações do Piloto Automático.",
      );
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const fetchCategories = async () => {
    setCategoriesError(false);
    try {
      const response = await fetchAuth("/autopilot/catalog/categories");
      if (!response.ok) throw new Error("Failed to fetch categories");
      const json = await response.json();
      setCatalogCategories(
        Array.isArray(json.categories) ? json.categories : [],
      );
      setCategoriesLoaded(true);
    } catch {
      setCatalogCategories([]);
      setCategoriesLoaded(false);
      setCategoriesError(true);
    }
  };

  const handleEmergencyPause = async () => {
    if (
      !confirm(
        "ATENÇÃO! Isso vai parar TODAS as publicações automáticas imediatamente. Tem certeza?",
      )
    )
      return;

    try {
      const res = await fetchAuth("/autopilot/emergency-pause", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to pause");
      setToast("LIA Pausada com sucesso.");
      setTimeout(() => setToast(""), 3000);
      fetchData();
    } catch (err) {
      alert("Erro ao pausar.");
    }
  };

  const handleSaveConfig = async (e: any) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        minScore: Number(form.minScore),
        minimumCommissionCents: Number(form.minimumCommissionCents),
        maxDailyPosts: Number(form.maxDailyPosts),
        intervalMinutes: Number(form.intervalMinutes),
        minSendIntervalMinutes:
          form.minSendIntervalMinutes == null
            ? null
            : Number(form.minSendIntervalMinutes),
        maxSendIntervalMinutes:
          form.maxSendIntervalMinutes == null
            ? null
            : Number(form.maxSendIntervalMinutes),
        allowedStartMinute: Number(form.allowedStartMinute),
        allowedEndMinute: Number(form.allowedEndMinute),
        catalogPolicy: form.catalogPolicy,
      };
      const res = await fetchAuth("/autopilot/config", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to save config");
      setToast("Configurações salvas.");
      setTimeout(() => setToast(""), 3000);
      fetchData();
      void fetchCategories();
    } catch (err) {
      alert("Erro ao salvar configuração.");
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );

  // A failed request must not let the page render fields from a null payload.
  if (!dashboardLoaded || !data)
    return (
      <div className="p-8 max-w-xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-red-600 mx-auto mb-3" />
          <h1 className="font-semibold text-gray-900">Piloto indisponível</h1>
          <p className="text-sm text-gray-600 mt-2">
            {loadError || "Não foi possível carregar os dados agora."}
          </p>
          <button
            onClick={() => fetchData()}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );

  const formatTime = (minutes: number) => {
    const h = Math.floor(minutes / 60)
      .toString()
      .padStart(2, "0");
    const m = (minutes % 60).toString().padStart(2, "0");
    return `${h}:${m}`;
  };

  const parseTime = (timeStr: string) => {
    const [h, m] = timeStr.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  const updateCatalogPolicy = (patch: Partial<CatalogPolicy>) =>
    setForm((current) => ({
      ...current,
      catalogPolicy: { ...current.catalogPolicy, ...patch },
    }));

  const toggleCatalogCategory = (category: string) => {
    const selected = form.catalogPolicy.allowedCategories.includes(category);
    updateCatalogPolicy({
      allowedCategories: selected
        ? form.catalogPolicy.allowedCategories.filter(
            (item) => item !== category,
          )
        : [...form.catalogPolicy.allowedCategories, category],
    });
  };

  const addCatalogValue = (
    field: "blockedCategories" | "blockedKeywords",
    value: string,
  ) => {
    const normalized = value.trim();
    if (!normalized) return;
    const values = form.catalogPolicy[field];
    if (
      !values.some(
        (item) => item.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
      )
    ) {
      updateCatalogPolicy({ [field]: [...values, normalized] });
    }
  };

  const noConnections =
    !data?.config?.channels?.length || !data?.config?.marketplaces?.length;

  const modeColors: any = {
    OFF: "bg-gray-100 text-gray-800 border-gray-200",
    MANUAL: "bg-blue-100 text-blue-800 border-blue-200",
    DRY_RUN: "bg-yellow-100 text-yellow-800 border-yellow-200",
    AUTO: "bg-green-100 text-green-800 border-green-200",
  };

  const modeLabels: any = {
    OFF: "⚪ Desativado",
    MANUAL: "🔵 Manual",
    DRY_RUN: "🟡 Simulação",
    AUTO: "🟢 Automático",
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Piloto Automático
          </h1>
          <p className="text-gray-500 mt-1">
            Gerencie e monitore as publicações automáticas da LIA.
          </p>
        </div>
        <button
          onClick={handleEmergencyPause}
          disabled={data.mode === "OFF"}
          className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-semibold shadow-sm transition-colors disabled:bg-gray-100 disabled:text-gray-400 disabled:border disabled:border-gray-200"
        >
          <ShieldAlert className="w-5 h-5" />
          {data.mode === "OFF" ? "LIA JÁ ESTÁ PAUSADA" : "PAUSAR LIA AGORA"}
        </button>
      </div>

      {toast && (
        <div className="fixed top-4 right-4 bg-gray-900 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 z-50 animate-in fade-in slide-in-from-top-4">
          <Save className="w-4 h-4 text-green-400" />
          {toast}
        </div>
      )}

      <div
        className={`rounded-xl border p-8 flex flex-col items-center justify-center ${modeColors[data.mode]}`}
      >
        <span className="text-5xl font-black uppercase tracking-widest">
          {modeLabels[data.mode] || data.mode}
        </span>
        <p className="mt-4 text-center font-medium opacity-80">
          {data.mode === "DRY_RUN" &&
            "As ofertas estão sendo avaliadas, mas nenhuma publicação real será enviada."}
          {data.mode === "AUTO" &&
            "A LIA está operando em capacidade total e publicando ofertas."}
          {data.mode === "OFF" && "Todas as automações estão paradas."}
          {data.mode === "MANUAL" &&
            "A LIA não escolhe sozinha, mas aceita envios manuais enfileirados."}
        </p>
      </div>

      <section
        className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        aria-labelledby="lia-operational-status"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2
              id="lia-operational-status"
              className="text-lg font-bold text-gray-900"
            >
              Status da LIA
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Saúde operacional baseada no heartbeat e nos dados já processados.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Próximo envio elegível
            </p>
            <p className="mt-1 font-semibold text-gray-900">
              {data.config?.nextEligibleSendAt
                ? formatDateTime(data.config.nextEligibleSendAt)
                : "Após uma publicação"}
            </p>
            <p className="text-xs text-gray-500">
              Só é usado quando a cadência variável está configurada.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${data.operationalStatus?.worker?.active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}`}
          >
            {data.operationalStatus?.worker?.active
              ? "● Operacional"
              : "● Indisponível"}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Worker
            </p>
            <p className="mt-1 font-semibold text-gray-900">
              {data.operationalStatus?.worker?.active ? "Ativo" : "Inativo"}
            </p>
            <p className="text-xs text-gray-500">
              {data.operationalStatus?.worker?.ageSeconds == null
                ? "Heartbeat expirado"
                : `há ${data.operationalStatus.worker.ageSeconds} segundos`}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Último Discovery Shopee
            </p>
            <p className="mt-1 font-semibold text-gray-900">
              {formatRelativeTime(
                data.operationalStatus?.lastShopeeDiscoveryAt,
              )}
            </p>
            <p className="text-xs text-gray-500">
              {formatDateTime(data.operationalStatus?.lastShopeeDiscoveryAt)}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Candidatos elegíveis
            </p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {data.operationalStatus?.eligibleCandidates == null
                ? "—"
                : data.operationalStatus.eligibleCandidates}
            </p>
            <p className="text-xs text-gray-500">agora</p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Última análise
            </p>
            <p className="mt-1 font-semibold text-gray-900">
              {formatRelativeTime(data.operationalStatus?.lastEvaluationAt)}
            </p>
            <p className="text-xs text-gray-500">
              {formatDateTime(data.operationalStatus?.lastEvaluationAt)}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Última decisão
            </p>
            <p className="mt-1 font-semibold text-gray-900">
              {formatRelativeTime(data.operationalStatus?.lastDecisionAt)}
            </p>
            <p className="text-xs text-gray-500">
              {formatDateTime(data.operationalStatus?.lastDecisionAt)}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Próxima oportunidade
            </p>
            <p className="mt-1 text-sm font-semibold text-gray-900">
              {data.operationalStatus?.nextOpportunity ||
                "Aguardando nova oferta com score mínimo"}
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs text-gray-500">
          Uma análise é registrada quando a LIA avalia uma oferta. Uma decisão
          aparece quando uma oferta chega à etapa do Autopilot.
        </p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <form
            onSubmit={handleSaveConfig}
            className="bg-white border rounded-xl p-6 shadow-sm"
          >
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-6">
              <Activity className="w-5 h-5 text-blue-600" />
              Configurações do Motor
            </h3>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Modo de Operação
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    {
                      value: "OFF",
                      label: "DESATIVADO",
                      desc: "A LIA não toma nenhuma ação.",
                    },
                    {
                      value: "MANUAL",
                      label: "MANUAL",
                      desc: "A LIA analisa, mas você decide o que publicar.",
                    },
                    {
                      value: "DRY_RUN",
                      label: "SIMULAÇÃO",
                      desc: "A LIA toma decisões e registra o que faria, sem enviar nada.",
                    },
                    {
                      value: "AUTO",
                      label: "AUTOMÁTICO",
                      desc: "A LIA seleciona e publica automaticamente dentro das suas regras.",
                      disabled: noConnections,
                    },
                  ].map((m) => (
                    <div
                      key={m.value}
                      onClick={() =>
                        !m.disabled && setForm({ ...form, mode: m.value })
                      }
                      className={`border rounded-lg p-4 transition-all ${m.disabled ? "opacity-50 cursor-not-allowed bg-gray-50" : "cursor-pointer hover:border-blue-300"} ${form.mode === m.value ? "ring-2 ring-blue-500 bg-blue-50 border-blue-200" : "border-gray-200 bg-white"}`}
                    >
                      <div className="font-bold text-gray-900">{m.label}</div>
                      <div className="text-xs text-gray-500 mt-2 leading-relaxed">
                        {m.desc}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6 border-t">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Comissão mínima (R$)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={(form.minimumCommissionCents / 100).toFixed(2)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        minimumCommissionCents: Math.round(
                          Number(e.target.value || 0) * 100,
                        ),
                      })
                    }
                    className="w-full border-gray-300 rounded-md shadow-sm p-2 border focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Ofertas sem comissão confirmada ou abaixo deste valor são
                    bloqueadas.
                  </p>
                </div>
                <div>
                  <label className="flex items-center justify-between text-sm font-medium text-gray-700 mb-2">
                    <span>Score Mínimo (LIA Score)</span>
                    <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs font-bold">
                      {form.minScore}/100
                    </span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={form.minScore}
                    onChange={(e) =>
                      setForm({ ...form, minScore: Number(e.target.value) })
                    }
                    className="w-full accent-blue-600"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    Ofertas abaixo desta nota não serão selecionadas
                    automaticamente.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700">
                      Postagens Máximas
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        value={form.maxDailyPosts}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            maxDailyPosts: Number(e.target.value),
                          })
                        }
                        className="w-24 border-gray-300 rounded-md shadow-sm py-1.5 pl-3 pr-10 border text-right focus:ring-blue-500 focus:border-blue-500"
                      />
                      <span className="absolute inset-y-0 right-3 flex items-center text-xs text-gray-500 pointer-events-none">
                        posts/dia
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700">
                      Intervalo Mínimo
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        value={form.intervalMinutes}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            intervalMinutes: Number(e.target.value),
                          })
                        }
                        className="w-28 border-gray-300 rounded-md shadow-sm py-1.5 pl-3 pr-14 border text-right focus:ring-blue-500 focus:border-blue-500"
                      />
                      <span className="absolute inset-y-0 right-3 flex items-center text-xs text-gray-500 pointer-events-none">
                        minutos
                      </span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
                    <p className="text-sm font-semibold text-gray-700">
                      Cadência de publicações
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="text-xs font-medium text-gray-600">
                        Mínimo (min)
                        <input
                          type="number"
                          min="1"
                          value={form.minSendIntervalMinutes ?? ""}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              minSendIntervalMinutes:
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                            })
                          }
                          className="mt-1 w-full rounded-md border border-gray-300 p-2 text-sm"
                          placeholder="Desativado"
                        />
                      </label>
                      <label className="text-xs font-medium text-gray-600">
                        Máximo (min)
                        <input
                          type="number"
                          min="1"
                          value={form.maxSendIntervalMinutes ?? ""}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              maxSendIntervalMinutes:
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                            })
                          }
                          className="mt-1 w-full rounded-md border border-gray-300 p-2 text-sm"
                          placeholder="Desativado"
                        />
                      </label>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">
                      A LIA aguarda um intervalo variável dentro dessa faixa
                      entre publicações.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Horário Inicial
                  </label>
                  <input
                    type="time"
                    value={formatTime(form.allowedStartMinute)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        allowedStartMinute: parseTime(e.target.value),
                      })
                    }
                    className="w-full border-gray-300 rounded-md shadow-sm p-2 border focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Horário Final
                  </label>
                  <input
                    type="time"
                    value={formatTime(form.allowedEndMinute)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        allowedEndMinute: parseTime(e.target.value),
                      })
                    }
                    className="w-full border-gray-300 rounded-md shadow-sm p-2 border focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Fuso Horário
                  </label>
                  <input
                    type="text"
                    disabled
                    value={form.timezone}
                    className="w-full bg-gray-50 border-gray-200 rounded-md shadow-sm p-2 border text-gray-500 cursor-not-allowed"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t">
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-3">
                    Canais liberados para o Piloto
                  </h4>
                  <div className="space-y-2">
                    {data?.availableChannels?.map((channel: any) => (
                      <label
                        key={channel.id}
                        className="flex items-center gap-2 text-sm text-gray-700"
                      >
                        <input
                          type="checkbox"
                          checked={form.enabledChannelIds.includes(channel.id)}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              enabledChannelIds: e.target.checked
                                ? [...form.enabledChannelIds, channel.id]
                                : form.enabledChannelIds.filter(
                                    (id) => id !== channel.id,
                                  ),
                            })
                          }
                        />
                        {channel.displayName} ({channel.provider})
                      </label>
                    ))}
                    {!data?.availableChannels?.length && (
                      <p className="text-sm text-gray-500">
                        Nenhum canal ativo disponível.
                      </p>
                    )}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-3">
                    Marketplaces fontes
                  </h4>
                  <div className="space-y-2">
                    {data?.availableMarketplaces?.map((marketplace: any) => (
                      <label
                        key={marketplace.id}
                        className="flex items-center gap-2 text-sm text-gray-700"
                      >
                        <input
                          type="checkbox"
                          checked={form.enabledMarketplaceIds.includes(
                            marketplace.id,
                          )}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              enabledMarketplaceIds: e.target.checked
                                ? [
                                    ...form.enabledMarketplaceIds,
                                    marketplace.id,
                                  ]
                                : form.enabledMarketplaceIds.filter(
                                    (id) => id !== marketplace.id,
                                  ),
                            })
                          }
                        />
                        {marketplace.name}
                      </label>
                    ))}
                    {!data?.availableMarketplaces?.length && (
                      <p className="text-sm text-gray-500">
                        Nenhum marketplace conectado disponível.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <section
              className="mt-8 border-t pt-8"
              aria-labelledby="catalog-policy-title"
            >
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
                  <Tags className="h-5 w-5" />
                </div>
                <div>
                  <h3
                    id="catalog-policy-title"
                    className="font-semibold text-gray-900"
                  >
                    Catálogo e relevância comercial
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Filtros determinísticos por categoria, sinais reais do
                    catálogo e diversidade por produto. A estratégia aberta
                    preserva o comportamento atual.
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {[
                  [
                    "OPEN",
                    "Catálogo aberto",
                    "Toda categoria observada pode participar.",
                  ],
                  [
                    "SELECTED_CATEGORIES",
                    "Categorias selecionadas",
                    "Somente as categorias marcadas podem participar.",
                  ],
                ].map(([value, title, description]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={form.catalogPolicy.mode === value}
                    onClick={() =>
                      updateCatalogPolicy({
                        mode: value as CatalogPolicy["mode"],
                      })
                    }
                    className={`rounded-xl border p-4 text-left transition ${form.catalogPolicy.mode === value ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100" : "border-gray-200 hover:border-blue-300"}`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-gray-900">
                        {title}
                      </span>
                      <span
                        className={`h-5 w-9 rounded-full p-0.5 ${form.catalogPolicy.mode === value ? "bg-blue-600" : "bg-gray-300"}`}
                      >
                        <span
                          className={`block h-4 w-4 rounded-full bg-white transition ${form.catalogPolicy.mode === value ? "translate-x-4" : ""}`}
                        />
                      </span>
                    </span>
                    <span className="mt-2 block text-xs leading-relaxed text-gray-500">
                      {description}
                    </span>
                  </button>
                ))}
              </div>

              <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-800">
                      Categorias comerciais
                    </h4>
                    <p className="mt-1 text-xs text-gray-500">
                      Os produtos são agrupados em categorias comerciais; os
                      identificadores técnicos da Shopee não são exibidos.
                    </p>
                  </div>
                  <span className="text-xs font-medium text-gray-500">
                    {form.catalogPolicy.allowedCategories.length} selecionadas
                  </span>
                </div>
                <div className="mt-4 space-y-4">
                  <div>
                    <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Categorias principais
                    </h5>
                    <div className="flex flex-wrap gap-2">
                      {catalogCategories.slice(0, 9).map((category: any) => {
                        const id = category.slug;
                        const label = category.label;
                        const selected =
                          form.catalogPolicy.allowedCategories.includes(id);
                        const blocked =
                          form.catalogPolicy.blockedCategories.includes(id);
                        return (
                          <button
                            type="button"
                            key={id}
                            onClick={() => toggleCatalogCategory(id)}
                            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${blocked ? "border-red-200 bg-red-50 text-red-700 line-through" : selected ? "border-blue-200 bg-blue-100 text-blue-800" : "border-gray-200 bg-white text-gray-600 hover:border-blue-300"}`}
                            title={`${label} · observadas: ${category.observedCount} · publicadas: ${category.publishedCount}`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Outras categorias
                    </h5>
                    <div className="flex flex-wrap gap-2">
                      {catalogCategories.slice(9).map((category: any) => {
                        const id = category.slug;
                        const label = category.label;
                        const selected =
                          form.catalogPolicy.allowedCategories.includes(id);
                        const blocked =
                          form.catalogPolicy.blockedCategories.includes(id);
                        return (
                          <button
                            type="button"
                            key={id}
                            onClick={() => toggleCatalogCategory(id)}
                            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${blocked ? "border-red-200 bg-red-50 text-red-700 line-through" : selected ? "border-blue-200 bg-blue-100 text-blue-800" : "border-gray-200 bg-white text-gray-600 hover:border-blue-300"}`}
                            title={`${label} · observadas: ${category.observedCount} · publicadas: ${category.publishedCount}`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {categoriesError && (
                    <span className="text-sm text-red-600">
                      Não foi possível carregar as categorias.
                    </span>
                  )}
                  {categoriesLoaded && !catalogCategories.length && (
                    <span className="text-sm text-gray-500">
                      Nenhuma categoria comercial observada.
                    </span>
                  )}
                </div>
                {/* Keep legacy values removable without exposing raw Shopee IDs. */}
                {!!form.catalogPolicy.blockedCategories.filter(
                  (category) =>
                    !catalogCategories.some(
                      (item: any) => item.slug === category,
                    ),
                ).length && (
                  <p className="mt-3 text-xs text-gray-500">
                    Há categorias bloqueadas antigas que não estão no catálogo
                    comercial atual.
                  </p>
                )}
                <div className="mt-4 flex gap-2">
                  <input
                    value={blockedCategoryInput}
                    onChange={(event) =>
                      setBlockedCategoryInput(event.target.value)
                    }
                    placeholder="Bloquear slug de categoria comercial"
                    className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white p-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      addCatalogValue(
                        "blockedCategories",
                        blockedCategoryInput,
                      );
                      setBlockedCategoryInput("");
                    }}
                    className="rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-100"
                    aria-label="Adicionar categoria bloqueada"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                {!!form.catalogPolicy.blockedCategories.length && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {form.catalogPolicy.blockedCategories.map((category) => (
                      <span
                        key={category}
                        className="inline-flex items-center gap-1 rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-800"
                      >
                        {displayCatalogCategory(category)}
                        <button
                          type="button"
                          onClick={() =>
                            updateCatalogPolicy({
                              blockedCategories:
                                form.catalogPolicy.blockedCategories.filter(
                                  (item) => item !== category,
                                ),
                            })
                          }
                          aria-label={`Remover ${category}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-6 grid gap-6 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Palavras bloqueadas
                  </label>
                  <p className="mt-1 text-xs text-gray-500">
                    Busca sem diferenciar maiúsculas ou acentos no título e na
                    categoria. Máximo recomendado: 50.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <input
                      value={blockedKeywordInput}
                      onChange={(event) =>
                        setBlockedKeywordInput(event.target.value)
                      }
                      placeholder="Ex.: suplemento"
                      className="min-w-0 flex-1 rounded-md border border-gray-300 p-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        addCatalogValue("blockedKeywords", blockedKeywordInput);
                        setBlockedKeywordInput("");
                      }}
                      className="rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-100"
                      aria-label="Adicionar palavra bloqueada"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {form.catalogPolicy.blockedKeywords.map((keyword) => (
                      <span
                        key={keyword}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800"
                      >
                        {keyword}
                        <button
                          type="button"
                          onClick={() =>
                            updateCatalogPolicy({
                              blockedKeywords:
                                form.catalogPolicy.blockedKeywords.filter(
                                  (item) => item !== keyword,
                                ),
                            })
                          }
                          aria-label={`Remover ${keyword}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-medium text-gray-700">
                    Vendas mínimas
                    <input
                      type="number"
                      min="0"
                      value={form.catalogPolicy.minSalesCount ?? ""}
                      onChange={(event) =>
                        updateCatalogPolicy({
                          minSalesCount:
                            event.target.value === ""
                              ? null
                              : Number(event.target.value),
                        })
                      }
                      className="mt-2 w-full rounded-md border border-gray-300 p-2 font-normal"
                      placeholder="Sem mínimo"
                    />
                    <span className="mt-1 block text-xs font-normal text-gray-500">
                      Só bloqueia quando o dado existe.
                    </span>
                  </label>
                  <label className="text-sm font-medium text-gray-700">
                    Rating mínimo
                    <input
                      type="number"
                      min="0"
                      max="5"
                      step="0.1"
                      value={form.catalogPolicy.minRating ?? ""}
                      onChange={(event) =>
                        updateCatalogPolicy({
                          minRating:
                            event.target.value === ""
                              ? null
                              : Number(event.target.value),
                        })
                      }
                      className="mt-2 w-full rounded-md border border-gray-300 p-2 font-normal"
                      placeholder="Sem mínimo"
                    />
                    <span className="mt-1 block text-xs font-normal text-gray-500">
                      Escala de 0 a 5; ausente não vira zero.
                    </span>
                  </label>
                </div>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-gray-700">
                  Cooldown por produto (horas)
                  <input
                    type="number"
                    min="0"
                    value={form.catalogPolicy.productCooldownHours ?? ""}
                    onChange={(event) =>
                      updateCatalogPolicy({
                        productCooldownHours:
                          event.target.value === ""
                            ? null
                            : Number(event.target.value),
                      })
                    }
                    className="mt-2 w-full rounded-md border border-gray-300 p-2 font-normal"
                    placeholder="Sem cooldown adicional"
                  />
                  <span className="mt-1 block text-xs font-normal text-gray-500">
                    Considera somente publicações PUBLISHED e DELIVERY_UNKNOWN
                    por canal.
                  </span>
                </label>
                <label className="text-sm font-medium text-gray-700">
                  Limite por categoria/dia
                  <input
                    type="number"
                    min="0"
                    value={form.catalogPolicy.maxPerCategoryPerDay ?? ""}
                    onChange={(event) =>
                      updateCatalogPolicy({
                        maxPerCategoryPerDay:
                          event.target.value === ""
                            ? null
                            : Number(event.target.value),
                      })
                    }
                    className="mt-2 w-full rounded-md border border-gray-300 p-2 font-normal"
                    placeholder="Sem limite adicional"
                  />
                  <span className="mt-1 block text-xs font-normal text-gray-500">
                    O dia é calculado no fuso {form.timezone}.
                  </span>
                </label>
              </div>
            </section>

            <div className="mt-8 flex justify-end">
              <button
                disabled={!dashboardLoaded || saving}
                type="submit"
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-semibold shadow-sm transition-colors disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Salvar Configurações
              </button>
            </div>
          </form>

          <div>
            <div className="mb-4">
              <h2 className="text-xl font-bold">
                Feed de Decisões (Últimos 10)
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                O feed registra decisões geradas pela LIA. Ausência de novas
                linhas não significa que o Worker está parado.
              </p>
            </div>
            <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-3 font-medium text-gray-500">
                      Horário
                    </th>
                    <th className="px-6 py-3 font-medium text-gray-500">
                      Oferta
                    </th>
                    <th className="px-6 py-3 font-medium text-gray-500">
                      Score
                    </th>
                    <th className="px-6 py-3 font-medium text-gray-500">
                      Decisão & Motivo
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.feed &&
                    data.feed.map((f: any) => (
                      <tr
                        key={f.id}
                        className="hover:bg-gray-50 transition-colors"
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                          {new Date(f.createdAt).toLocaleTimeString()}
                        </td>
                        <td className="px-6 py-4 font-medium text-gray-900">
                          {f.offerTitle}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`px-2 py-1 rounded text-xs font-bold ${f.score >= (data.config?.minScore || 0) ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}
                          >
                            {f.score}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="font-semibold text-gray-700">
                              {f.decision}
                            </span>
                            {f.details && (
                              <span className="text-xs text-gray-500 mt-1">
                                {f.details}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  {!data.feed?.length && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-6 py-12 text-center text-gray-500"
                      >
                        Nenhum evento registrado ainda. O Piloto Automático fará
                        auditoria aqui quando ativado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="bg-white border rounded-lg p-6 shadow-sm">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <MonitorPlay className="w-5 h-5 text-indigo-600" />
              Conexões
            </h3>
            <div className="space-y-4">
              <div>
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Canais Selecionados
                </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {data.config?.channels?.length ? (
                    data.config.channels.map((c: any) => (
                      <span
                        key={c.id}
                        className="px-2 py-1 bg-gray-100 border border-gray-200 rounded text-xs font-medium text-gray-700"
                      >
                        {c.displayName}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-gray-500">
                      — Nenhum canal liberado.
                    </span>
                  )}
                </div>
              </div>
              <div className="pt-2">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Marketplaces Fontes
                </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {data.config?.marketplaces?.length ? (
                    data.config.marketplaces.map((m: any) => (
                      <span
                        key={m.id}
                        className="px-2 py-1 bg-gray-100 border border-gray-200 rounded text-xs font-medium text-gray-700"
                      >
                        {m.name}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-gray-500">
                      — Nenhum marketplace liberado.
                    </span>
                  )}
                </div>
              </div>
              {noConnections && (
                <div className="mt-4 p-3 bg-yellow-50 text-yellow-800 rounded border border-yellow-200 text-sm">
                  A LIA ainda não possui fontes ou canais conectados.
                </div>
              )}
            </div>
          </div>

          <div className="bg-white border rounded-lg p-6 shadow-sm">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <AlertTriangle className="w-5 h-5 text-orange-600" />
              Execução Atual
            </h3>
            <ul className="space-y-3 text-sm">
              <li className="flex justify-between items-center">
                <span className="text-gray-500">Publicações Hoje:</span>
                <span className="font-mono bg-gray-100 px-2 py-1 rounded">
                  {data.stats?.postsToday || 0}
                </span>
              </li>
              <li className="flex justify-between items-center">
                <span className="text-gray-500">Último disparo:</span>
                <strong className="text-gray-700">
                  {data.stats?.lastPublicationAt
                    ? new Date(
                        data.stats.lastPublicationAt,
                      ).toLocaleTimeString()
                    : "Nenhum"}
                </strong>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
