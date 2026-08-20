"use client";

import {
  MessagesSquare,
  Search,
  Filter,
  RefreshCw,
  Check,
  X as XIcon,
  Send,
} from "lucide-react";
import { useState, useEffect } from "react";
import { fetchAuth } from "@/lib/api";

export default function ChannelsPage() {
  const [channels, setChannels] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [testingChannelId, setTestingChannelId] = useState<string | null>(null);

  const loadChannels = async () => {
    try {
      const res = await fetchAuth("/channels");
      const data = await res.json();
      setChannels(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const res = await fetchAuth("/integrations/whatsapp/evolution/groups");
      if (res.ok) {
        alert("Grupos sincronizados com sucesso!");
        await loadChannels();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Erro ao sincronizar grupos: ${err.message || "Desconhecido"}`);
      }
    } catch (e) {
      alert("Erro de conexão ao sincronizar.");
    } finally {
      setIsSyncing(false);
    }
  };

  const toggleChannel = async (id: string, currentEnabled: boolean) => {
    try {
      const res = await fetchAuth(`/channels/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      if (res.ok) {
        setChannels(
          channels.map((c) =>
            c.id === id ? { ...c, enabled: !currentEnabled } : c,
          ),
        );
      }
    } catch (e) {
      alert("Erro ao atualizar status do canal.");
    }
  };

  const sendConnectionTest = async (channel: any) => {
    const confirmed = window.confirm(
      `Enviar uma mensagem fixa de teste para o grupo \"${channel.displayName}\"? Nenhuma oferta ou link será publicado.`,
    );
    if (!confirmed) return;

    setTestingChannelId(channel.id);
    try {
      const res = await fetchAuth(
        "/integrations/whatsapp/evolution/test-message",
        {
          method: "POST",
          body: JSON.stringify({ channelId: channel.id }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Não foi possível enviar o teste.");
      }
      alert(`Teste enviado para \"${data.channel}\". Confira o WhatsApp.`);
    } catch (e: any) {
      alert(e.message || "Erro ao enviar mensagem de teste.");
    } finally {
      setTestingChannelId(null);
    }
  };

  useEffect(() => {
    loadChannels();
  }, []);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Canais de Distribuição
          </h1>
          <p className="text-gray-500 mt-1">
            Configure os destinos onde a LIA enviará suas publicações.
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 font-medium rounded-lg shadow-sm hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`} />
          {isSyncing ? "Sincronizando..." : "Sincronizar Grupos do WhatsApp"}
        </button>
      </div>

      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        {/* Table Structure */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-white border-b text-gray-500">
              <tr>
                <th className="px-6 py-4 font-medium uppercase tracking-wider text-xs">
                  Nome
                </th>
                <th className="px-6 py-4 font-medium uppercase tracking-wider text-xs">
                  Provider
                </th>
                <th className="px-6 py-4 font-medium uppercase tracking-wider text-xs text-center">
                  Ativo p/ LIA
                </th>
                <th className="px-6 py-4 font-medium uppercase tracking-wider text-xs text-center">
                  Teste
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-8 text-center text-gray-500"
                  >
                    Carregando canais...
                  </td>
                </tr>
              ) : channels.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center justify-center max-w-md mx-auto">
                      <div className="w-12 h-12 bg-gray-50 border rounded-xl flex items-center justify-center text-gray-400 mb-4 shadow-sm">
                        <MessagesSquare className="w-6 h-6" />
                      </div>
                      <h3 className="text-gray-900 font-semibold mb-1">
                        Nenhum canal configurado
                      </h3>
                      <p className="text-gray-500 text-sm text-center">
                        Sincronize seus grupos conectando o WhatsApp na aba de
                        Integrações.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                channels.map((channel) => (
                  <tr
                    key={channel.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="font-semibold text-gray-900">
                        {channel.displayName}
                      </div>
                      <div className="text-xs text-gray-500">
                        {channel.externalChatId}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 bg-green-50 text-green-700 border border-green-200 rounded-md text-xs font-semibold">
                        {channel.provider}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() =>
                          toggleChannel(channel.id, channel.enabled)
                        }
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                          channel.enabled ? "bg-blue-600" : "bg-gray-200"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            channel.enabled ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {channel.provider === "WHATSAPP" && channel.enabled ? (
                        <button
                          onClick={() => sendConnectionTest(channel)}
                          disabled={testingChannelId === channel.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
                        >
                          <Send className="w-3.5 h-3.5" />
                          {testingChannelId === channel.id
                            ? "Enviando..."
                            : "Enviar teste"}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
