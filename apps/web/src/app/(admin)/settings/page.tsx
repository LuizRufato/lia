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
  newShopeeSaleEnabled: boolean;
  commissionConfirmedEnabled: boolean;
  saleCancelledEnabled: boolean;
  highValueSaleEnabled: boolean;
  criticalErrorEnabled: boolean;
  dailySummaryEnabled: boolean;
  enabledAt: string | null;
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
  { key: "criticalErrorEnabled", label: "Erro crítico", active: false },
  { key: "dailySummaryEnabled", label: "Resumo diário", active: false },
] as const;

export default function SettingsPage() {
  const [tenant, setTenant] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [alertConfig, setAlertConfig] = useState<AdminAlertConfig | null>(null);
  const [alertLoading, setAlertLoading] = useState(true);
  const [alertSaving, setAlertSaving] = useState(false);
  const [alertError, setAlertError] = useState<string | null>(null);
  const [alertSaved, setAlertSaved] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [removeRecipient, setRemoveRecipient] = useState(false);

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
                <Phone className="w-4 h-4 text-gray-400" />
                <h3 className="font-semibold text-gray-900">
                  WhatsApp autorizado
                </h3>
              </div>
              {alertConfig.hasRecipient && (
                <div className="flex items-center gap-2 text-sm text-gray-600 mb-3">
                  <ShieldCheck className="w-4 h-4 text-green-600" />
                  Número atual: {alertConfig.recipientMasked}
                </div>
              )}
              <input
                type="tel"
                inputMode="tel"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder={
                  alertConfig.hasRecipient
                    ? "Digite um novo número para substituir"
                    : "+55 11 99999-9999"
                }
                className="w-full border border-gray-300 rounded-md p-2.5 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {alertConfig.hasRecipient && (
                <label className="flex items-center gap-2 mt-3 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={removeRecipient}
                    onChange={(event) =>
                      setRemoveRecipient(event.target.checked)
                    }
                    className="rounded border-gray-300 text-blue-600"
                  />
                  Remover destinatário autorizado
                </label>
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

            <div className="flex justify-end border-t pt-6">
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
