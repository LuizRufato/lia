"use client";

import { Send, Search, Filter } from "lucide-react";
import { useRouter } from "next/navigation";

export default function PublicationsPage() {
  const router = useRouter();

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          Publicações
        </h1>
        <p className="text-gray-500 mt-1">
          Histórico de ofertas publicadas pela LIA.
        </p>
      </div>

      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        {/* Filters Bar */}
        <div className="p-4 border-b bg-gray-50 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="flex flex-wrap items-center gap-3 w-full">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                disabled
                placeholder="Buscar publicações..."
                className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-500 cursor-not-allowed shadow-sm"
              />
            </div>

            <select
              disabled
              className="bg-white border border-gray-200 text-gray-500 text-sm rounded-lg px-3 py-2 cursor-not-allowed shadow-sm"
            >
              <option>Canal</option>
            </select>

            <select
              disabled
              className="bg-white border border-gray-200 text-gray-500 text-sm rounded-lg px-3 py-2 cursor-not-allowed shadow-sm"
            >
              <option>Status</option>
              <option>PENDENTE</option>
              <option>AGENDADA</option>
              <option>PUBLICANDO</option>
              <option>PUBLICADA</option>
              <option>FALHOU</option>
              <option>CANCELADA/IGNORADA</option>
            </select>

            <select
              disabled
              className="bg-white border border-gray-200 text-gray-500 text-sm rounded-lg px-3 py-2 cursor-not-allowed shadow-sm"
            >
              <option>Período</option>
            </select>
          </div>
          <button
            disabled
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 bg-white text-gray-400 rounded-lg text-sm font-medium cursor-not-allowed shadow-sm"
          >
            <Filter className="w-4 h-4" />
            Filtros
          </button>
        </div>

        {/* Table Structure */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-white border-b text-gray-500">
              <tr>
                <th className="px-6 py-4 font-medium uppercase tracking-wider text-xs">
                  Produto
                </th>
                <th className="px-6 py-4 font-medium uppercase tracking-wider text-xs">
                  Canal
                </th>
                <th className="px-6 py-4 font-medium uppercase tracking-wider text-xs">
                  Marketplace
                </th>
                <th className="px-6 py-4 font-medium uppercase tracking-wider text-xs">
                  Status
                </th>
                <th className="px-6 py-4 font-medium uppercase tracking-wider text-xs">
                  Data/hora
                </th>
                <th className="px-6 py-4 font-medium uppercase tracking-wider text-xs">
                  LIA Score
                </th>
                <th className="px-6 py-4 font-medium uppercase tracking-wider text-xs">
                  Link Rastreado
                </th>
                <th className="px-6 py-4 font-medium uppercase tracking-wider text-xs">
                  Cliques Válidos
                </th>
                <th className="px-6 py-4 font-medium uppercase tracking-wider text-xs">
                  Vendas
                </th>
                <th className="px-6 py-4 font-medium uppercase tracking-wider text-xs">
                  Comissão
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={10} className="px-6 py-16 text-center">
                  <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                    <div className="w-12 h-12 bg-gray-50 border rounded-xl flex items-center justify-center text-gray-400 mb-4 shadow-sm">
                      <Send className="w-6 h-6" />
                    </div>
                    <h3 className="text-gray-900 font-semibold mb-1">
                      Nenhuma publicação enviada
                    </h3>
                    <p className="text-gray-500 text-sm text-center mb-6">
                      Ainda não existem publicações geradas e enviadas para seus
                      canais. O Piloto Automático fará o trabalho assim que
                      estiver configurado.
                    </p>
                    <button
                      onClick={() => router.push("/autopilot")}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg transition-colors"
                    >
                      Ver Piloto Automático
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
