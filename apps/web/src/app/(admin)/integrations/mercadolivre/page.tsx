"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchAuth } from "@/lib/api";

function MercadoLivreIntegrationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [integration, setIntegration] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadIntegration();

    const status = searchParams.get("status");
    if (status === "success") {
      alert("Autenticação com o Mercado Livre concluída com sucesso!");
      router.replace("/integrations/mercadolivre");
    } else if (status === "error") {
      alert("Erro na autenticação com o Mercado Livre. Tente novamente.");
      router.replace("/integrations/mercadolivre");
    }
  }, [searchParams]);

  async function loadIntegration() {
    try {
      const res = await fetchAuth("/integrations/mercadolivre");
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

  async function handleConnect() {
    setSubmitting(true);
    try {
      const res = await fetchAuth("/integrations/mercadolivre/auth-url");
      if (res.ok) {
        const data = await res.json();
        window.location.href = data.url; // Redirect to Meli
      } else {
        alert("Falha ao gerar URL de autenticação.");
      }
    } catch (err) {
      alert("Erro ao tentar autenticar.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDisconnect() {
    if (
      !confirm(
        "Deseja realmente desconectar a conta do Mercado Livre? O acesso precisará ser renovado depois.",
      )
    )
      return;
    setSubmitting(true);
    try {
      const res = await fetchAuth("/integrations/mercadolivre", {
        method: "DELETE",
      });
      if (res.ok) {
        setIntegration({ status: "NOT_CONNECTED" });
      }
    } catch (err) {
      alert("Erro ao desconectar");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-white">Carregando integração...</div>;
  }

  const isPendingGlobal = integration?.status === "PENDING_GLOBAL_CONFIG";
  const isConnected = integration?.status === "CONNECTED";
  const needsReauth = integration?.status === "NEEDS_REAUTH";

  return (
    <div className="p-8 max-w-4xl mx-auto text-white">
      <div className="mb-8">
        <button
          onClick={() => router.push("/integrations")}
          className="text-blue-400 hover:underline mb-4 inline-block"
        >
          &larr; Voltar para Integrações
        </button>
        <h1 className="text-3xl font-bold">Integração Mercado Livre</h1>
        <p className="text-gray-400 mt-2">
          API Oficial do Mercado Livre (SaaS).
        </p>
      </div>

      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-xl mb-6">
        <h2 className="text-xl font-semibold mb-4 pb-2 border-b border-slate-700">
          API Mercado Livre (Developer)
        </h2>

        {isPendingGlobal ? (
          <div className="text-yellow-400 p-4 bg-yellow-900/20 rounded-lg">
            <strong>Aviso:</strong> A aplicação LIA ainda não possui
            MELI_CLIENT_ID e MELI_CLIENT_SECRET globais configurados. Contate o
            administrador (Luiz).
          </div>
        ) : (
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`w-3 h-3 rounded-full ${isConnected ? "bg-green-500" : needsReauth ? "bg-orange-500" : "bg-gray-500"}`}
                ></span>
                <span className="font-medium">
                  {integration?.status === "NOT_CONNECTED"
                    ? "Não Conectado"
                    : integration?.status === "CONNECTED"
                      ? "Conectado"
                      : integration?.status === "NEEDS_REAUTH"
                        ? "Autenticação Expirada (Reconecte)"
                        : integration?.status}
                </span>
              </div>
            </div>

            {isConnected ? (
              <div className="flex gap-3">
                <button
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors"
                  onClick={() =>
                    alert("Sincronização manual será implementada na Fase 5B")
                  }
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
            ) : (
              <button
                onClick={handleConnect}
                disabled={submitting}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {submitting ? "Aguarde..." : "Conectar Mercado Livre"}
              </button>
            )}
          </div>
        )}

        {isConnected && (
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="block text-gray-400 mb-1">Meli User ID:</span>
              <span className="bg-slate-900 p-2 rounded block">
                {integration.meliUserId || "N/A"}
              </span>
            </div>
            <div>
              <span className="block text-gray-400 mb-1">Token Expira Em:</span>
              <span className="bg-slate-900 p-2 rounded block text-yellow-300">
                {integration.expiresAt
                  ? new Date(integration.expiresAt).toLocaleString("pt-BR")
                  : "Desconhecido"}
              </span>
            </div>
            <div className="col-span-2">
              <span className="block text-gray-400 mb-1">
                Última Sincronização:
              </span>
              <span className="bg-slate-900 p-2 rounded block">
                {integration.lastSyncAt
                  ? new Date(integration.lastSyncAt).toLocaleString("pt-BR")
                  : "Nunca sincronizado"}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-xl opacity-70 cursor-not-allowed">
        <h2 className="text-xl font-semibold mb-2 flex items-center justify-between">
          Programa de Afiliados
          <span className="text-xs font-normal px-2 py-1 bg-yellow-600/30 text-yellow-500 border border-yellow-600/50 rounded-full">
            API NÃO DISPONÍVEL / PENDENTE
          </span>
        </h2>
        <p className="text-gray-400 text-sm">
          A geração oficial de links de afiliado via API e métricas de
          comissionamento estão aguardando liberação/documentação oficial do
          Mercado Livre. A LIA não utiliza scraping ou rotas não documentadas
          para garantir 100% de compliance.
        </p>
      </div>
    </div>
  );
}

export default function MercadoLivreIntegrationPage() {
  return (
    <Suspense fallback={<div className="p-8 text-white">Carregando...</div>}>
      <MercadoLivreIntegrationContent />
    </Suspense>
  );
}
