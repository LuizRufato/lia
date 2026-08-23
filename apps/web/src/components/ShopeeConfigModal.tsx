"use client";

import { useState } from "react";
import { X, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { fetchAuth } from "@/lib/api";

interface ShopeeConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  appId?: string;
}

export function ShopeeConfigModal({
  isOpen,
  onClose,
  onSuccess,
  appId = "",
}: ShopeeConfigModalProps) {
  const [currentAppId, setCurrentAppId] = useState(appId);
  const [appSecret, setAppSecret] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentAppId || !appSecret) {
      setError("Preencha todos os campos.");
      return;
    }

    setIsSaving(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetchAuth("/integrations/shopee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: currentAppId, appSecret }),
      });

      let errorData;
      try {
        errorData = await res.json();
      } catch (err) {}

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error("Sessão inválida ou expirada. Recarregue a página.");
        }
        if (errorData?.message?.includes("INTEGRATION_ENCRYPTION_KEY")) {
          throw new Error("Configuração de criptografia ausente no servidor.");
        }
        if (errorData?.message?.includes("Validation")) {
          throw new Error("Configuração inválida fornecida.");
        }
        throw new Error(
          errorData?.message || "Erro de persistência ou falha inesperada.",
        );
      }

      setSuccess("Credenciais testadas e salvas com segurança.");
      onSuccess();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden border">
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50/50">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Shopee Affiliate Open API
            </h2>
            <p className="text-sm text-gray-500">
              Configure suas credenciais da API Oficial
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-6">
          {error && (
            <div className="p-4 bg-red-50 text-red-700 text-sm rounded-lg flex items-start gap-3 border border-red-100">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {success && (
            <div className="p-4 bg-green-50 text-green-700 text-sm rounded-lg flex items-start gap-3 border border-green-100">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              <p>{success}</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                App ID
              </label>
              <input
                type="text"
                value={currentAppId}
                onChange={(e) => setCurrentAppId(e.target.value)}
                placeholder="Ex: 1234567890"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                App Secret
              </label>
              <input
                type="password"
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                placeholder="Ex: a1b2c3d4..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
              <p className="text-xs text-gray-500 mt-2">
                Suas chaves são criptografadas (AES-256-GCM) antes de serem
                armazenadas e nunca são enviadas de volta ao navegador.
              </p>
            </div>
          </div>

          <div className="flex gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving || !currentAppId || !appSecret}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar e testar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
