"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchAuth } from "@/lib/api";

export default function ShopeeIntegrationPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [integration, setIntegration] = useState<any>(null);

  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadIntegration();
  }, []);

  async function loadIntegration() {
    try {
      const res = await fetchAuth("/integrations/shopee");
      if (res.ok) {
        const data = await res.json();
        setIntegration(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetchAuth("/integrations/shopee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId, appSecret }),
      });
      if (res.ok) {
        await loadIntegration();
      } else {
        alert("Failed to connect Shopee");
      }
    } catch (err) {
      alert("Error connecting");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Deseja realmente desconectar a Shopee?")) return;
    setSubmitting(true);
    try {
      const res = await fetchAuth("/integrations/shopee", { method: "DELETE" });
      if (res.ok) {
        setIntegration({ status: "NOT_CONNECTED" });
      }
    } catch (err) {
      alert("Error disconnecting");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSyncNow() {
    setSubmitting(true);
    try {
      const res = await fetchAuth("/integrations/shopee/sync", {
        method: "POST",
      });
      if (res.ok) {
        alert("Sincronização iniciada com sucesso (Background Job)!");
      } else {
        alert("Failed to start sync");
      }
    } catch (err) {
      alert("Error syncing");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-white">Carregando integração...</div>;
  }

  const isConnected = integration?.status === "CONNECTED";
  const hasError = integration?.status === "ERROR";

  return (
    <div className="p-8 max-w-4xl mx-auto text-white">
      <div className="mb-8">
        <button
          onClick={() => router.push("/integrations")}
          className="text-blue-400 hover:underline mb-4 inline-block"
        >
          &larr; Voltar para Integrações
        </button>
        <h1 className="text-3xl font-bold">Shopee Affiliate API</h1>
        <p className="text-gray-400 mt-2">
          Sincronize os Top Products e gere links automaticamente.
        </p>
      </div>

      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-xl">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-700">
          <div>
            <h2 className="text-xl font-semibold">Status da Conexão</h2>
            <div className="flex items-center gap-2 mt-2">
              <span
                className={`w-3 h-3 rounded-full ${isConnected ? "bg-green-500" : hasError ? "bg-red-500" : "bg-gray-500"}`}
              ></span>
              <span className="font-medium">
                {integration?.status === "NOT_CONNECTED"
                  ? "Não Conectado"
                  : integration?.status === "CONNECTED"
                    ? "Conectado"
                    : integration?.status === "ERROR"
                      ? "Erro na Conexão"
                      : integration?.status}
              </span>
            </div>
          </div>
          {isConnected && (
            <div className="flex gap-3">
              <button
                onClick={handleSyncNow}
                disabled={submitting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                Sincronizar Agora
              </button>
              <button
                onClick={handleDisconnect}
                disabled={submitting}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                Desconectar
              </button>
            </div>
          )}
        </div>

        {integration?.lastError && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-500/50 rounded-lg text-red-200">
            <strong>Último Erro:</strong> {integration.lastError}
          </div>
        )}

        {isConnected ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">App ID</label>
              <div className="bg-slate-900 p-3 rounded-lg border border-slate-700 font-mono text-sm">
                {integration.appId}
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                App Secret
              </label>
              <div className="bg-slate-900 p-3 rounded-lg border border-slate-700 font-mono text-sm text-gray-500 select-none">
                ••••••••••••••••••••••••••••••••
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Última Sincronização
              </label>
              <div className="bg-slate-900 p-3 rounded-lg border border-slate-700 text-sm">
                {integration.lastSyncAt
                  ? new Date(integration.lastSyncAt).toLocaleString("pt-BR")
                  : "Nunca sincronizado"}
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleConnect} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Shopee App ID
              </label>
              <input
                type="text"
                required
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500 transition-colors"
                placeholder="Ex: 12345678"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Shopee App Secret
              </label>
              <input
                type="password"
                required
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500 transition-colors"
                placeholder="Ex: a1b2c3d4..."
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 rounded-lg transition-colors disabled:opacity-50 mt-4"
            >
              {submitting ? "Conectando..." : "Conectar Shopee"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
