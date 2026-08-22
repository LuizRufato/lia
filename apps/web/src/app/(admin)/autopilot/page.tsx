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
} from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";

export default function AutopilotDashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [form, setForm] = useState({
    mode: "OFF",
    minScore: 0,
    minimumCommissionCents: 500,
    maxDailyPosts: 0,
    intervalMinutes: 0,
    allowedStartMinute: 0,
    allowedEndMinute: 0,
    timezone: "America/Campo_Grande",
    enabledChannelIds: [] as string[],
    enabledMarketplaceIds: [] as string[],
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetchAuth("/autopilot/dashboard");
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setData(json);

      if (json.config) {
        setForm({
          mode: json.mode,
          minScore: json.config.minScore,
          minimumCommissionCents: json.config.minimumCommissionCents,
          maxDailyPosts: json.config.maxDailyPosts,
          intervalMinutes: json.config.intervalMinutes,
          allowedStartMinute: json.config.allowedStartMinute,
          allowedEndMinute: json.config.allowedEndMinute,
          timezone: json.config.timezone || "America/Campo_Grande",
          enabledChannelIds: json.config.channels.map((channel: any) => channel.id),
          enabledMarketplaceIds: json.config.marketplaces.map((marketplace: any) => marketplace.id),
        });
      }
    } catch (err) {
      setLoadError("Não foi possível carregar as configurações do Piloto Automático.");
    } finally {
      setLoading(false);
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
        allowedStartMinute: Number(form.allowedStartMinute),
        allowedEndMinute: Number(form.allowedEndMinute),
      };
      const res = await fetchAuth("/autopilot/config", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to save config");
      setToast("Configurações salvas.");
      setTimeout(() => setToast(""), 3000);
      fetchData();
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
  if (!data)
    return (
      <div className="p-8 max-w-xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-red-600 mx-auto mb-3" />
          <h1 className="font-semibold text-gray-900">Piloto indisponível</h1>
          <p className="text-sm text-gray-600 mt-2">
            {loadError || "Não foi possível carregar os dados agora."}
          </p>
          <button
            onClick={fetchData}
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
                        minimumCommissionCents: Math.round(Number(e.target.value || 0) * 100),
                      })
                    }
                    className="w-full border-gray-300 rounded-md shadow-sm p-2 border focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Ofertas sem comissão confirmada ou abaixo deste valor são bloqueadas.
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
                      <label key={channel.id} className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={form.enabledChannelIds.includes(channel.id)}
                          onChange={(e) => setForm({
                            ...form,
                            enabledChannelIds: e.target.checked
                              ? [...form.enabledChannelIds, channel.id]
                              : form.enabledChannelIds.filter((id) => id !== channel.id),
                          })}
                        />
                        {channel.displayName} ({channel.provider})
                      </label>
                    ))}
                    {!data?.availableChannels?.length && <p className="text-sm text-gray-500">Nenhum canal ativo disponível.</p>}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-3">
                    Marketplaces fontes
                  </h4>
                  <div className="space-y-2">
                    {data?.availableMarketplaces?.map((marketplace: any) => (
                      <label key={marketplace.id} className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={form.enabledMarketplaceIds.includes(marketplace.id)}
                          onChange={(e) => setForm({
                            ...form,
                            enabledMarketplaceIds: e.target.checked
                              ? [...form.enabledMarketplaceIds, marketplace.id]
                              : form.enabledMarketplaceIds.filter((id) => id !== marketplace.id),
                          })}
                        />
                        {marketplace.name}
                      </label>
                    ))}
                    {!data?.availableMarketplaces?.length && <p className="text-sm text-gray-500">Nenhum marketplace conectado disponível.</p>}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 flex justify-end">
              <button
                disabled={saving}
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
            <h2 className="text-xl font-bold mb-4">
              Feed de Decisões (Últimos 10)
            </h2>
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
