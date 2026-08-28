"use client";

import { useEffect, useState } from "react";
import { fetchAuth } from "@/lib/api";
import {
  Bell,
  Building2,
  Check,
  Lock,
  Loader2,
  Phone,
  ShieldCheck,
} from "lucide-react";

type AdminAlertConfig = {
  enabled: boolean;
  hasRecipient: boolean;
  recipientMasked: string | null;
  recipients: Array<{ id: string; masked: string; enabled: boolean }>;
  maxRecipients: number;
  adminWhatsappIntegrationId: string | null;
  senderIntegrationName: string | null;
  senderIntegrations: Array<{ id: string; name: string }>;
  newShopeeSaleEnabled: boolean;
  commissionConfirmedEnabled: boolean;
  saleCancelledEnabled: boolean;
  highValueSaleEnabled: boolean;
  criticalErrorEnabled: boolean;
  dailySummaryEnabled: boolean;
  enabledAt: string | null;
  dailySummarySchedule: {
    time: string;
    timezone: string;
    lastSentAt: string | null;
    nextAt: string;
  };
};

type AdminAlertTestResult = {
  success: boolean;
  status: "PROVIDER_ACCEPTED" | "PARTIAL" | "FAILED";
  sent: number;
  failed: number;
  results: Array<{
    recipientId: string;
    maskedRecipient: string;
    providerAccepted: boolean;
    messageId: string | null;
    error: string | null;
  }>;
};

const ALERT_TYPES = [
  { key: "newShopeeSaleEnabled", label: "Nova venda Shopee", active: true },
  {
    key: "commissionConfirmedEnabled",
    label: "Comissão confirmada",
    active: false,
  },
  { key: "saleCancelledEnabled", label: "Venda cancelada", active: false },
  {
    key: "highValueSaleEnabled",
    label: "Venda de alto valor",
    active: false,
  },
  { key: "criticalErrorEnabled", label: "Erro crítico", active: true },
  { key: "dailySummaryEnabled", label: "Resumo diário", active: true },
] as const;

export default function SettingsPage() {
  const [tenant, setTenant] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [alertConfig, setAlertConfig] = useState<AdminAlertConfig | null>(null);
  const [alertLoading, setAlertLoading] = useState(true);
  const [alertSaving, setAlertSaving] = useState(false);
  const [alertTesting, setAlertTesting] = useState(false);
  const [alertSimulating, setAlertSimulating] = useState(false);
  const [alertError, setAlertError] = useState<string | null>(null);
  const [alertSaved, setAlertSaved] = useState(false);
  const [alertTestResult, setAlertTestResult] =
    useState<AdminAlertTestResult | null>(null);
  const [recipient, setRecipient] = useState("");
  const [removeRecipient, setRemoveRecipient] = useState(false);

  const addAlertRecipient = async () => {
    if (!recipient.trim() || !alertConfig) return;
    setAlertError(null);
    try {
      const res = await fetchAuth("/admin-alerts/config/recipients", {
        method: "POST",
        body: JSON.stringify({ recipient }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(
          data?.message || "Não foi possível adicionar o destinatário.",
        );
      setAlertConfig(data);
      setRecipient("");
    } catch (err: any) {
      setAlertError(
        err?.message || "Não foi possível adicionar o destinatário.",
      );
    }
  };

  const updateAlertRecipient = async (id: string, enabled: boolean) => {
    const res = await fetchAuth(`/admin-alerts/config/recipients/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok)
      throw new Error(
        data?.message || "Não foi possível atualizar o destinatário.",
      );
    setAlertConfig(data);
  };

  const removeAlertRecipient = async (id: string) => {
    const res = await fetchAuth(`/admin-alerts/config/recipients/${id}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => null);
    if (!res.ok)
      throw new Error(
        data?.message || "Não foi possível remover o destinatário.",
      );
    setAlertConfig(data);
  };

  useEffect(() => {
    const fetchTenant = async () => {
      try {
        const res = await fetchAuth("/auth/tenants");
        if (res.ok) {
          const data = await res.json();
          if (data && data.length > 0) {
            setTenant(data[0]); // For the checkpoint we just grab the first one
          }
        }
      } catch (err) {
        console.error("Failed to fetch tenant", err);
      } finally {
        setLoading(false);
      }
    };
    fetchTenant();
  }, []);

  useEffect(() => {
    const fetchAlertConfig = async () => {
      try {
        const res = await fetchAuth("/admin-alerts/config");
        if (res.ok) {
          setAlertConfig(await res.json());
        }
      } catch (err) {
        console.error("Failed to fetch administrator alert config", err);
      } finally {
        setAlertLoading(false);
      }
    };
    fetchAlertConfig();
  }, []);

  const updateAlertConfig = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!alertConfig || alertSaving) return;

    setAlertError(null);
    setAlertSaved(false);
    if (alertConfig.enabled && !alertConfig.hasRecipient && !recipient.trim()) {
      setAlertError(
        "Cadastre um destinatário WhatsApp autorizado antes de ativar os alertas.",
      );
      return;
    }

    setAlertSaving(true);
    try {
      const body: Record<string, unknown> = {
        enabled: alertConfig.enabled,
        adminWhatsappIntegrationId:
          alertConfig.adminWhatsappIntegrationId || null,
        newShopeeSaleEnabled: alertConfig.newShopeeSaleEnabled,
        commissionConfirmedEnabled: alertConfig.commissionConfirmedEnabled,
        saleCancelledEnabled: alertConfig.saleCancelledEnabled,
        highValueSaleEnabled: alertConfig.highValueSaleEnabled,
        criticalErrorEnabled: alertConfig.criticalErrorEnabled,
        dailySummaryEnabled: alertConfig.dailySummaryEnabled,
      };
      if (recipient.trim()) body.recipient = recipient;
      if (removeRecipient) body.removeRecipient = true;

      const res = await fetchAuth("/admin-alerts/config", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          Array.isArray(data?.message)
            ? data.message.join(" ")
            : data?.message || "Não foi possível salvar os alertas.",
        );
      }
      setAlertConfig(data);
      setRecipient("");
      setRemoveRecipient(false);
      setAlertSaved(true);
    } catch (err: any) {
      setAlertError(err?.message || "Não foi possível salvar os alertas.");
    } finally {
      setAlertSaving(false);
    }
  };

  const sendTestAlert = async () => {
    if (!alertConfig || alertTesting) return;
    setAlertError(null);
    setAlertSaved(false);
    setAlertTestResult(null);
    setAlertTesting(true);
    try {
      const res = await fetchAuth("/admin-alerts/config/test", {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (data?.results) setAlertTestResult(data);
      if (!res.ok || !data?.success) {
        if (!data?.results)
          throw new Error(data?.message || "Não foi possível enviar o teste.");
        return;
      }
    } catch (err: any) {
      setAlertError(err?.message || "Não foi possível enviar o teste.");
    } finally {
      setAlertTesting(false);
    }
  };

  const simulateAlert = async () => {
    if (!alertConfig || alertSimulating) return;
    setAlertError(null);
    setAlertSaved(false);
    setAlertTestResult(null);
    setAlertSimulating(true);
    try {
      const res = await fetchAuth("/admin-alerts/config/simulate", {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (data?.results) setAlertTestResult(data);
      if (!res.ok || !data?.success) {
        if (!data?.results)
          throw new Error(
            data?.message || "Não foi possível enviar a simulação.",
          );
        return;
      }
    } catch (err: any) {
      setAlertError(err?.message || "Não foi possível enviar a simulação.");
    } finally {
      setAlertSimulating(false);
    }
  };

  if (loading)
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          Configurações da Organização
        </h1>
        <p className="text-gray-500 mt-1">
          Gerencie os dados da sua empresa na LIA.
        </p>
      </div>

      {tenant ? (
        <div className="bg-white border rounded-xl shadow-sm overflow-hidden max-w-3xl">
          <div className="p-6 border-b bg-gray-50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-blue-50 text-blue-600 border border-blue-100 rounded-lg flex items-center justify-center shadow-sm">
                <Building2 className="w-8 h-8" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {tenant.name}
                </h2>
                <div className="flex items-center gap-2 mt-1 text-sm">
                  <span className="flex items-center gap-1.5 text-green-700 font-medium bg-green-50 px-2 py-0.5 rounded border border-green-200 text-xs">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                    Organização ativa
                  </span>
                </div>
              </div>
            </div>
            <div className="bg-white border rounded-lg px-4 py-2 shadow-sm text-sm min-w-[140px]">
              <span className="text-gray-500 block text-xs uppercase tracking-wider mb-0.5 font-semibold">
                Seu acesso
              </span>
              <span className="font-bold text-gray-900">
                {tenant.role === "OWNER" ? "OWNER / Proprietário" : tenant.role}
              </span>
            </div>
          </div>

          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome da Organização
                </label>
                <input
                  type="text"
                  disabled
                  value={tenant.name}
                  className="w-full bg-gray-50 border-gray-200 rounded-md shadow-sm p-2 border text-gray-600 cursor-not-allowed font-medium"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Data de Criação
                </label>
                <input
                  type="text"
                  disabled
                  value={new Date(tenant.createdAt).toLocaleDateString()}
                  className="w-full bg-gray-50 border-gray-200 rounded-md shadow-sm p-2 border text-gray-500 cursor-not-allowed"
                />
              </div>
            </div>

            <div className="pt-8 mt-8 border-t">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4 uppercase tracking-wider">
                <Lock className="w-4 h-4 text-gray-400" />
                Informações Técnicas
              </h3>

              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100 text-sm">
                <span className="text-gray-600 font-medium">
                  ID da Organização (Tenant ID)
                </span>
                <span className="font-mono text-xs text-gray-400 select-all">
                  {tenant.id}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-yellow-50 text-yellow-800 p-4 rounded-md border border-yellow-200">
          Nenhuma organização associada à sua conta.
        </div>
      )}

      <section className="bg-white border rounded-xl shadow-sm overflow-hidden max-w-3xl">
        <div className="p-6 border-b bg-gray-50 flex items-start gap-4">
          <div className="w-12 h-12 bg-amber-50 text-amber-600 border border-amber-100 rounded-lg flex items-center justify-center">
            <Bell className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Alertas do Administrador
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Configure os alertas administrativos da sua organização.
            </p>
          </div>
        </div>

        {alertLoading || !alertConfig ? (
          <div className="p-8 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : (
          <form onSubmit={updateAlertConfig} className="p-6 space-y-8">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold text-gray-900">Ativar alertas</h3>
                <p className="text-sm text-gray-500 mt-1">
                  A ativação é explícita e exige um destinatário válido.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={alertConfig.enabled}
                  onChange={(event) =>
                    setAlertConfig({
                      ...alertConfig,
                      enabled: event.target.checked,
                    })
                  }
                />
                <span className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
              </label>
            </div>

            <div className="border-t pt-6">
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="w-4 h-4 text-gray-400" />
                <h3 className="font-semibold text-gray-900">
                  WhatsApp remetente
                </h3>
              </div>
              <select
                value={alertConfig.adminWhatsappIntegrationId || ""}
                onChange={(event) =>
                  setAlertConfig({
                    ...alertConfig,
                    adminWhatsappIntegrationId: event.target.value || null,
                    senderIntegrationName:
                      alertConfig.senderIntegrations.find(
                        (integration) => integration.id === event.target.value,
                      )?.name || null,
                  })
                }
                className="w-full border border-gray-300 rounded-md p-2.5 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Selecione uma instância conectada</option>
                {alertConfig.senderIntegrations.map((integration) => (
                  <option key={integration.id} value={integration.id}>
                    {integration.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-2">
                A instância Evolution selecionada será usada somente para
                alertas privados.
              </p>
            </div>

            <div className="border-t pt-6">
              <div className="flex items-center gap-2 mb-2">
                <Phone className="w-4 h-4 text-gray-400" />
                <h3 className="font-semibold text-gray-900">
                  Destinatários WhatsApp autorizados
                </h3>
              </div>
              <div className="space-y-2 mb-3">
                {alertConfig.recipients.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-gray-200 p-3 text-sm"
                  >
                    <span className="flex items-center gap-2 text-gray-700">
                      <ShieldCheck className="w-4 h-4 text-green-600" />{" "}
                      {item.masked}
                    </span>
                    <span className="flex items-center gap-3">
                      <label className="text-xs text-gray-500">
                        <input
                          type="checkbox"
                          checked={item.enabled}
                          onChange={async (event) => {
                            try {
                              await updateAlertRecipient(
                                item.id,
                                event.target.checked,
                              );
                            } catch (err: any) {
                              setAlertError(
                                err?.message ||
                                  "Não foi possível atualizar o destinatário.",
                              );
                            }
                          }}
                          className="mr-1 rounded border-gray-300 text-blue-600"
                        />
                        <span
                          className={
                            item.enabled ? "text-green-700" : "text-gray-500"
                          }
                        >
                          {item.enabled ? "Ativo" : "Desativado"}
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await removeAlertRecipient(item.id);
                          } catch (err: any) {
                            setAlertError(
                              err?.message ||
                                "Não foi possível remover o destinatário.",
                            );
                          }
                        }}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remover
                      </button>
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="tel"
                  inputMode="tel"
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  placeholder="+55 11 99999-9999"
                  className="min-w-0 flex-1 border border-gray-300 rounded-md p-2.5 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={addAlertRecipient}
                  disabled={
                    !recipient.trim() ||
                    alertConfig.recipients.length >= alertConfig.maxRecipients
                  }
                  className="rounded-md border border-blue-200 px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                >
                  Adicionar
                </button>
              </div>
              {removeRecipient && (
                <span className="text-xs text-gray-500">
                  A remoção do destinatário legado será aplicada ao salvar.
                </span>
              )}
              <p className="text-xs text-gray-500 mt-2">
                O número é normalizado e armazenado criptografado. Nunca
                exibimos o telefone completo.
              </p>
            </div>

            <div className="border-t pt-6">
              <h3 className="font-semibold text-gray-900 mb-4">
                Tipos de alerta
              </h3>
              <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
                <p className="font-medium">Resumo diário</p>
                <p className="mt-1 text-xs text-blue-800">
                  {alertConfig.dailySummaryEnabled ? "Ativado" : "Desativado"} ·
                  todos os dias às {alertConfig.dailySummarySchedule.time} (
                  {alertConfig.dailySummarySchedule.timezone})
                </p>
                <p className="mt-1 text-xs text-blue-800">
                  Último envio:{" "}
                  {alertConfig.dailySummarySchedule.lastSentAt
                    ? new Date(
                        alertConfig.dailySummarySchedule.lastSentAt,
                      ).toLocaleString("pt-BR", {
                        timeZone: alertConfig.dailySummarySchedule.timezone,
                      })
                    : "ainda não enviado"}
                </p>
                <p className="text-xs text-blue-800">
                  Próximo envio:{" "}
                  {new Date(
                    alertConfig.dailySummarySchedule.nextAt,
                  ).toLocaleString("pt-BR", {
                    timeZone: alertConfig.dailySummarySchedule.timezone,
                  })}
                </p>
              </div>
              <div className="space-y-3">
                {ALERT_TYPES.map((alert) => (
                  <label
                    key={alert.key}
                    className="flex items-center justify-between gap-4 p-3 rounded-lg border border-gray-100"
                  >
                    <span>
                      <span className="block text-sm font-medium text-gray-800">
                        {alert.label}
                      </span>
                      {!alert.active && (
                        <span className="block text-xs text-gray-400 mt-0.5">
                          Disponível para configuração; envio será ativado em
                          fase futura.
                        </span>
                      )}
                    </span>
                    <input
                      type="checkbox"
                      checked={alertConfig[alert.key]}
                      onChange={(event) =>
                        setAlertConfig({
                          ...alertConfig,
                          [alert.key]: event.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-gray-300 text-blue-600"
                    />
                  </label>
                ))}
              </div>
            </div>

            {alertError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {alertError}
              </div>
            )}
            {alertSaved && (
              <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                <Check className="w-4 h-4" /> Configurações salvas.
              </div>
            )}
            {alertTestResult && (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                <p className="font-semibold">
                  {alertTestResult.status === "PROVIDER_ACCEPTED"
                    ? `Evolution aceitou a mensagem para ${alertTestResult.sent} destinatário${alertTestResult.sent === 1 ? "" : "s"}.`
                    : alertTestResult.status === "PARTIAL"
                      ? `Evolution aceitou a mensagem para ${alertTestResult.sent} destinatário${alertTestResult.sent === 1 ? "" : "s"}; ${alertTestResult.failed} falhou${alertTestResult.failed === 1 ? "" : "ram"}.`
                      : "Falha ao enviar a mensagem de teste."}
                </p>
                <p className="mt-1 text-xs text-blue-800">
                  PROVIDER_ACCEPTED confirma o aceite da Evolution e um
                  messageId; a entrega no aparelho permanece indeterminada.
                </p>
                <div className="mt-2 space-y-1 text-xs">
                  {alertTestResult.results.map((result) => (
                    <div key={result.recipientId}>
                      <span className="font-medium">
                        {result.maskedRecipient} —{" "}
                        {result.providerAccepted
                          ? "PROVIDER_ACCEPTED"
                          : "FAILED"}
                      </span>
                      {result.providerAccepted && result.messageId && (
                        <span> · messageId: {result.messageId}</span>
                      )}
                      {result.error && <span> · {result.error}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end border-t pt-6">
              <button
                type="button"
                onClick={sendTestAlert}
                disabled={
                  alertTesting ||
                  !alertConfig.enabled ||
                  !alertConfig.hasRecipient ||
                  !alertConfig.adminWhatsappIntegrationId
                }
                className="mr-3 inline-flex items-center gap-2 rounded-md border border-blue-200 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
              >
                {alertTesting && <Loader2 className="w-4 h-4 animate-spin" />}
                Enviar mensagem de teste
              </button>
              <button
                type="button"
                onClick={simulateAlert}
                disabled={
                  alertSimulating ||
                  !alertConfig.enabled ||
                  !alertConfig.hasRecipient ||
                  !alertConfig.adminWhatsappIntegrationId
                }
                className="mr-3 inline-flex items-center gap-2 rounded-md border border-amber-200 px-4 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
              >
                {alertSimulating && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                Simular nova venda Shopee
              </button>
              <button
                type="submit"
                disabled={alertSaving}
                className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {alertSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                Salvar configurações
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
