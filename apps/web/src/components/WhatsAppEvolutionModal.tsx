"use client";

import { useState, useEffect } from "react";
import { X, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { fetchAuth } from "@/lib/api";

interface WhatsAppEvolutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function WhatsAppEvolutionModal({
  isOpen,
  onClose,
  onSuccess,
}: WhatsAppEvolutionModalProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [qrCode, setQrCode] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [status, setStatus] = useState<"IDLE" | "CONNECTED">("IDLE");

  const handleConnect = async () => {
    setIsConnecting(true);
    setErrorMsg("");
    try {
      const res = await fetchAuth("/integrations/whatsapp/evolution/connect", {
        method: "POST",
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(
          errorData.message || "Erro ao conectar com Evolution API",
        );
      }

      const data = await res.json();
      if (data.qrcodeBase64) {
        setQrCode(data.qrcodeBase64);
      } else {
        setStatus("CONNECTED");
        onSuccess();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Erro ao iniciar conexão");
    } finally {
      setIsConnecting(false);
    }
  };

  const checkStatus = async () => {
    try {
      const res = await fetchAuth("/integrations/whatsapp");
      const data = await res.json();
      if (data.status === "CONNECTED" && data.transport === "WEB_UNOFFICIAL") {
        setStatus("CONNECTED");
        onSuccess();
      }
    } catch (e) {}
  };

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    if (isOpen && qrCode && status !== "CONNECTED") {
      intervalId = setInterval(async () => {
        try {
          const res = await fetchAuth("/integrations/whatsapp");
          const data = await res.json();
          if (
            data.status === "CONNECTED" &&
            data.transport === "WEB_UNOFFICIAL"
          ) {
            setStatus("CONNECTED");
            clearInterval(intervalId);
            setTimeout(() => {
              onSuccess();
            }, 1500); // Give user a brief moment to see success state
          }
        } catch (e) {}
      }, 3000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isOpen, qrCode, status]);

  useEffect(() => {
    if (isOpen) {
      setQrCode("");
      setErrorMsg("");
      setStatus("IDLE");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              Configurar WhatsApp Web (Gateway)
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Conecte via QR Code utilizando a infraestrutura Evolution API.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 bg-gray-50/50">
          {errorMsg && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-700">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="text-sm font-medium">{errorMsg}</p>
            </div>
          )}

          {status === "CONNECTED" ? (
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
                <CheckCircle className="w-8 h-8" />
              </div>
              <p className="text-lg font-bold text-gray-900">
                Conectado com sucesso!
              </p>
            </div>
          ) : qrCode ? (
            <div className="flex flex-col items-center space-y-4">
              <p className="text-sm font-medium text-gray-700">
                Escaneie o QR Code abaixo com o seu WhatsApp:
              </p>
              <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                {/* Evolution might return data:image/png;base64,... or just the string */}
                <img
                  src={
                    qrCode.startsWith("data:")
                      ? qrCode
                      : `data:image/png;base64,${qrCode}`
                  }
                  alt="QR Code"
                  className="w-64 h-64"
                />
              </div>
              <button
                onClick={checkStatus}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium underline"
              >
                Já escaneei (Verificar Status)
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8">
              <button
                onClick={handleConnect}
                disabled={isConnecting}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl flex items-center gap-2 disabled:opacity-50"
              >
                {isConnecting && <Loader2 className="w-5 h-5 animate-spin" />}
                {isConnecting
                  ? "Gerando QR Code..."
                  : "Gerar QR Code de Conexão"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
