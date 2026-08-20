"use client";

import { useState, useEffect } from "react";
import { X, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { fetchAuth } from "@/lib/api";

interface WhatsAppConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function WhatsAppConfigModal({
  isOpen,
  onClose,
  onSuccess,
}: WhatsAppConfigModalProps) {
  const [wabaId, setWabaId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [status, setStatus] = useState<"IDLE" | "CONNECTED" | "ERROR">("IDLE");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    try {
      const response = await fetchAuth("/integrations/whatsapp");
      const data = await response.json();
      if (data.status === "CONNECTED") {
        setWabaId(data.wabaId || "");
        setPhoneNumberId(data.phoneNumberId || "");
        setAccessToken("••••••••");
        setStatus("CONNECTED");
      } else {
        setWabaId("");
        setPhoneNumberId("");
        setAccessToken("");
        setStatus("IDLE");
      }
      setErrorMsg("");
    } catch (err) {
      console.error(err);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setErrorMsg("");
    try {
      const tokenToSave = accessToken === "••••••••" ? undefined : accessToken;

      // If they are just saving without changing token, we might need a different flow,
      // but if accessToken is ••••••••, backend should ideally ignore it.
      // For simplicity, if they haven't changed it, we send empty or prompt them to enter it if needed.
      // But we will send whatever they typed.
      if (!tokenToSave && status !== "CONNECTED") {
        throw new Error("Access Token é obrigatório");
      }

      const res = await fetchAuth("/integrations/whatsapp", {
        method: "POST",
        body: JSON.stringify({
          wabaId,
          phoneNumberId,
          accessToken: tokenToSave,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Erro ao salvar configuração");
      }

      setStatus("CONNECTED");
      onSuccess();

      // Don't close immediately so they can see success or test connection
    } catch (err: any) {
      setErrorMsg(err.message || "Erro ao salvar configuração");
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setErrorMsg("");
    try {
      const res = await fetchAuth("/integrations/whatsapp/test", {
        method: "POST",
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Erro ao testar conexão");
      }
      alert("Conexão testada com sucesso!");
      setStatus("CONNECTED");
      onSuccess();
    } catch (err: any) {
      setStatus("ERROR");
      setErrorMsg(err.message || "Erro ao testar conexão");
    } finally {
      setIsTesting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col">
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-900">
            Configurar WhatsApp
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 flex-1 overflow-y-auto">
          {errorMsg && (
            <div className="bg-red-50 text-red-600 p-4 rounded-lg flex gap-3 text-sm border border-red-100">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p>{errorMsg}</p>
            </div>
          )}

          {status === "CONNECTED" && !errorMsg && (
            <div className="bg-green-50 text-green-700 p-4 rounded-lg flex items-center gap-3 text-sm border border-green-100">
              <CheckCircle className="w-5 h-5 flex-shrink-0" />
              <p className="font-medium">
                WhatsApp conectado e pronto para uso.
              </p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                WhatsApp Business Account ID (WABA ID)
              </label>
              <input
                type="text"
                value={wabaId}
                onChange={(e) => setWabaId(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                placeholder="Ex: 104561234567890"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Phone Number ID
              </label>
              <input
                type="text"
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                placeholder="Ex: 101234567890123"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Access Token
              </label>
              <input
                type="text"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900"
                placeholder="EAAGm0..."
              />
              <p className="text-xs text-gray-500 mt-1">
                O token será salvo de forma criptografada. Insira apenas se
                quiser alterar.
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 bg-gray-50 border-t border-gray-100 flex flex-col sm:flex-row justify-end gap-3">
          {status === "CONNECTED" && (
            <button
              onClick={handleTest}
              disabled={isTesting || isSaving}
              className="px-5 py-2.5 text-sm font-semibold text-blue-700 bg-blue-100 hover:bg-blue-200 rounded-lg transition-colors flex items-center justify-center"
            >
              {isTesting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Testar Conexão
            </button>
          )}
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !wabaId || !phoneNumberId || !accessToken}
            className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : null}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
