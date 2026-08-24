"use client";

import { useState, useEffect } from "react";
import {
  Store,
  MessageSquare,
  Plus,
  AlertCircle,
  Clock,
  CheckCircle,
} from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { fetchAuth } from "@/lib/api";
import { WhatsAppConfigModal } from "@/components/WhatsAppConfigModal";
import { WhatsAppEvolutionModal } from "@/components/WhatsAppEvolutionModal";
import { ShopeeConfigModal } from "@/components/ShopeeConfigModal";

export default function IntegrationsPage() {
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState(false);
  const [isWhatsAppEvolutionModalOpen, setIsWhatsAppEvolutionModalOpen] =
    useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState<
    "NOT_CONNECTED" | "CONNECTED" | "ERROR"
  >("NOT_CONNECTED");
  const [whatsappTransport, setWhatsappTransport] =
    useState<string>("CLOUD_OFFICIAL");

  const [isShopeeModalOpen, setIsShopeeModalOpen] = useState(false);
  const [shopeeStatus, setShopeeStatus] = useState<
    "NOT_CONNECTED" | "CONNECTED" | "ERROR"
  >("NOT_CONNECTED");
  const [shopeeAppId, setShopeeAppId] = useState("");
  const [isSyncingShopee, setIsSyncingShopee] = useState(false);
  const [meliStatus, setMeliStatus] = useState<
    "PENDING_GLOBAL_CONFIG" | "NOT_CONNECTED" | "CONNECTED" | "NEEDS_REAUTH" | "ERROR"
  >("PENDING_GLOBAL_CONFIG");
  const [isConnectingMeli, setIsConnectingMeli] = useState(false);

  const loadStatus = async () => {
    try {
      const responseWp = await fetchAuth("/integrations/whatsapp");
      const dataWp = await responseWp.json();
      setWhatsappStatus(dataWp.status || "NOT_CONNECTED");
      setWhatsappTransport(dataWp.transport || "CLOUD_OFFICIAL");

      const responseShopee = await fetchAuth("/integrations/shopee");
      const dataShopee = await responseShopee.json();
      setShopeeStatus(dataShopee.status || "NOT_CONNECTED");
      setShopeeAppId(dataShopee.appId || "");

      const responseMeli = await fetchAuth("/integrations/mercadolivre");
      const dataMeli = await responseMeli.json();
      setMeliStatus(dataMeli.status || "ERROR");
    } catch (e) {
      console.error(e);
    }
  };

  const handleConnectMercadoLivre = async () => {
    setIsConnectingMeli(true);
    try {
      const response = await fetchAuth("/integrations/mercadolivre/auth-url");
      if (!response.ok) {
        alert("Falha ao gerar URL de autenticação do Mercado Livre.");
        return;
      }
      const data = await response.json();
      if (typeof data.url !== "string" || !data.url.startsWith("https://auth.mercadolivre.com.br/")) {
        alert("URL de autenticação inválida.");
        return;
      }
      window.location.href = data.url;
    } catch {
      alert("Erro ao iniciar a autenticação do Mercado Livre.");
    } finally {
      setIsConnectingMeli(false);
    }
  };

  const handleSyncShopee = async () => {
    setIsSyncingShopee(true);
    try {
      const res = await fetchAuth("/integrations/shopee/sync", {
        method: "POST",
      });
      if (res.ok) {
        alert("Sincronização manual iniciada. Ofertas aparecerão em breve.");
      } else {
        alert("Erro ao iniciar sincronização.");
      }
    } catch (e) {
      alert("Erro na conexão.");
    } finally {
      setIsSyncingShopee(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);
  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-5xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          Integrações
        </h1>
        <p className="text-gray-500 mt-1">
          Conecte a LIA aos Marketplaces e Canais de Distribuição.
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="text-sm font-bold tracking-wider text-gray-400 uppercase mb-4">
            Canais de Distribuição
          </h2>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <ul className="divide-y divide-gray-200">
              {/* WhatsApp */}
              <li className="p-6 flex flex-col sm:flex-row sm:items-center justify-between hover:bg-gray-50 transition-colors gap-4">
                <div className="flex items-center">
                  <div className="h-12 w-12 rounded-lg flex items-center justify-center mr-4 bg-green-50 text-green-600 border border-green-100 shadow-sm">
                    <MessageSquare className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-gray-900">
                        WhatsApp
                      </h3>
                      <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-blue-100 text-blue-700 border border-blue-200">
                        Canal Principal
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      Envio de ofertas via WhatsApp (Grupos/Listas).
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {whatsappStatus === "CONNECTED" ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 px-2 py-1 rounded border border-green-200">
                      <CheckCircle className="w-3 h-3" />
                      CONECTADO
                    </span>
                  ) : whatsappStatus === "ERROR" ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 px-2 py-1 rounded border border-red-200">
                      <AlertCircle className="w-3 h-3" />
                      ERRO DE CONEXÃO
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-semibold text-yellow-600 bg-yellow-50 px-2 py-1 rounded border border-yellow-200">
                      <Clock className="w-3 h-3" />
                      AGUARDANDO CONFIGURAÇÃO
                    </span>
                  )}
                  <button
                    onClick={() => setIsWhatsAppModalOpen(true)}
                    className="w-full sm:w-auto px-4 py-2 text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg transition-colors"
                  >
                    Configurar Cloud API
                  </button>
                </div>
              </li>

              {/* WhatsApp Evolution */}
              <li className="p-6 flex flex-col sm:flex-row sm:items-center justify-between hover:bg-gray-50 transition-colors gap-4">
                <div className="flex items-center">
                  <div className="h-12 w-12 rounded-lg flex items-center justify-center mr-4 bg-green-50 text-green-600 border border-green-100 shadow-sm">
                    <MessageSquare className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-gray-900">
                        WhatsApp Web (Grupos)
                      </h3>
                      <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-purple-100 text-purple-700 border border-purple-200">
                        Não Oficial
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      Conexão via QR Code para publicar em grupos.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {whatsappStatus === "CONNECTED" &&
                  whatsappTransport === "WEB_UNOFFICIAL" ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 px-2 py-1 rounded border border-green-200">
                      <CheckCircle className="w-3 h-3" />
                      CONECTADO
                    </span>
                  ) : whatsappStatus === "ERROR" &&
                    whatsappTransport === "WEB_UNOFFICIAL" ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 px-2 py-1 rounded border border-red-200">
                      <AlertCircle className="w-3 h-3" />
                      ERRO DE CONEXÃO
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-semibold text-yellow-600 bg-yellow-50 px-2 py-1 rounded border border-yellow-200">
                      <Clock className="w-3 h-3" />
                      AGUARDANDO
                    </span>
                  )}
                  <button
                    onClick={() => setIsWhatsAppEvolutionModalOpen(true)}
                    className="w-full sm:w-auto px-4 py-2 text-sm font-semibold text-purple-700 bg-purple-50 border border-purple-200 hover:bg-purple-100 rounded-lg transition-colors"
                  >
                    Conectar QR Code
                  </button>
                </div>
              </li>

              {/* Telegram */}
              <li className="p-6 flex flex-col sm:flex-row sm:items-center justify-between hover:bg-gray-50 transition-colors gap-4 opacity-70">
                <div className="flex items-center">
                  <div className="h-12 w-12 rounded-lg flex items-center justify-center mr-4 bg-blue-50 text-blue-500 border border-blue-100">
                    <MessageSquare className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">
                      Telegram
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Integração via Telegram Bot API.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="text-xs font-semibold text-gray-400">
                    PLANEJADO PARA O FUTURO
                  </span>
                  <button
                    disabled
                    className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-gray-400 bg-gray-50 border border-gray-200 rounded-lg cursor-not-allowed"
                  >
                    Planejado
                  </button>
                </div>
              </li>
            </ul>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-bold tracking-wider text-gray-400 uppercase mb-4 mt-8">
            Marketplaces (Fontes de Ofertas)
          </h2>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <ul className="divide-y divide-gray-200">
              {/* Shopee */}
              <li className="p-6 flex flex-col sm:flex-row sm:items-center justify-between hover:bg-gray-50 transition-colors gap-4">
                <div className="flex items-center">
                  <div className="h-12 w-12 rounded-lg flex items-center justify-center mr-4 bg-orange-50 text-orange-600 border border-orange-100 shadow-sm">
                    <Store className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-gray-900">
                      Shopee
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Programa de Afiliados Shopee Brasil.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {shopeeStatus === "CONNECTED" ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 px-2 py-1 rounded border border-green-200">
                      <CheckCircle className="w-3 h-3" />
                      CONECTADO
                    </span>
                  ) : shopeeStatus === "ERROR" ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 px-2 py-1 rounded border border-red-200">
                      <AlertCircle className="w-3 h-3" />
                      ERRO DE CONEXÃO
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-semibold text-yellow-600 bg-yellow-50 px-2 py-1 rounded border border-yellow-200">
                      <Clock className="w-3 h-3" />
                      AGUARDANDO CONFIGURAÇÃO
                    </span>
                  )}
                  <div className="flex gap-2 w-full sm:w-auto">
                    {shopeeStatus === "CONNECTED" && (
                      <button
                        onClick={handleSyncShopee}
                        disabled={isSyncingShopee}
                        className="flex-1 sm:flex-none px-4 py-2 text-sm font-semibold text-orange-700 bg-orange-50 border border-orange-200 hover:bg-orange-100 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {isSyncingShopee
                          ? "Sincronizando..."
                          : "Sincronizar ofertas agora"}
                      </button>
                    )}
                    <button
                      onClick={() => setIsShopeeModalOpen(true)}
                      className="flex-1 sm:flex-none px-4 py-2 text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg transition-colors"
                    >
                      Configurar
                    </button>
                  </div>
                </div>
              </li>

              {/* Mercado Livre Developer */}
              <li className="p-6 flex flex-col sm:flex-row sm:items-center justify-between hover:bg-gray-50 transition-colors gap-4">
                <div className="flex items-center">
                  <div className="h-12 w-12 rounded-lg flex items-center justify-center mr-4 bg-yellow-50 text-yellow-500 border border-yellow-100 shadow-sm">
                    <Store className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-gray-900">
                      Mercado Livre Developer
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Extração via API Oficial do Mercado Livre.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {meliStatus === "PENDING_GLOBAL_CONFIG" ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-yellow-600 bg-yellow-50 px-2 py-1 rounded border border-yellow-200">
                      <Clock className="w-3 h-3" />
                      AGUARDANDO CONFIGURAÇÃO
                    </span>
                  ) : meliStatus === "CONNECTED" ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 px-2 py-1 rounded border border-green-200">
                      <CheckCircle className="w-3 h-3" />
                      CONECTADO
                    </span>
                  ) : meliStatus === "ERROR" ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 px-2 py-1 rounded border border-red-200">
                      <AlertCircle className="w-3 h-3" />
                      ERRO DE CONFIGURAÇÃO
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-semibold text-gray-600 bg-gray-50 px-2 py-1 rounded border border-gray-200">
                      <Clock className="w-3 h-3" />
                      NÃO CONECTADO
                    </span>
                  )}
                  <button
                    onClick={handleConnectMercadoLivre}
                    disabled={meliStatus === "PENDING_GLOBAL_CONFIG" || meliStatus === "CONNECTED" || meliStatus === "ERROR" || isConnectingMeli}
                    className="w-full sm:w-auto px-4 py-2 text-sm font-semibold text-yellow-700 bg-yellow-50 border border-yellow-200 hover:bg-yellow-100 rounded-lg transition-colors disabled:text-gray-400 disabled:bg-gray-50 disabled:border-gray-200 disabled:cursor-not-allowed"
                  >
                    {isConnectingMeli ? "Aguarde..." : "Conectar Mercado Livre"}
                  </button>
                </div>
              </li>

              {/* Mercado Livre Afiliados */}
              <li className="p-6 flex flex-col sm:flex-row sm:items-center justify-between hover:bg-gray-50 transition-colors gap-4 opacity-70">
                <div className="flex items-center">
                  <div className="h-12 w-12 rounded-lg flex items-center justify-center mr-4 bg-yellow-50 text-yellow-500 border border-yellow-100">
                    <Store className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">
                      Mercado Livre Afiliados
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Programa oficial de links de afiliados.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 px-2 py-1 rounded border border-red-200">
                    <AlertCircle className="w-3 h-3" />
                    INDISPONÍVEL
                  </span>
                  <button
                    disabled
                    className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-gray-400 bg-gray-50 border border-gray-200 rounded-lg cursor-not-allowed"
                  >
                    Indisponível
                  </button>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <WhatsAppConfigModal
        isOpen={isWhatsAppModalOpen}
        onClose={() => setIsWhatsAppModalOpen(false)}
        onSuccess={() => {
          loadStatus();
        }}
      />
      <WhatsAppEvolutionModal
        isOpen={isWhatsAppEvolutionModalOpen}
        onClose={() => setIsWhatsAppEvolutionModalOpen(false)}
        onSuccess={() => {
          loadStatus();
          setIsWhatsAppEvolutionModalOpen(false);
        }}
      />
      <ShopeeConfigModal
        isOpen={isShopeeModalOpen}
        onClose={() => setIsShopeeModalOpen(false)}
        onSuccess={() => {
          loadStatus();
        }}
        appId={shopeeAppId}
      />
    </div>
  );
}
