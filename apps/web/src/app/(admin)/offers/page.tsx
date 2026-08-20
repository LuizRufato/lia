"use client";

import {
  Tag,
  Search,
  Filter,
  Image as ImageIcon,
  ExternalLink,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { useEffect, useState } from "react";
import { fetchAuth } from "@/lib/api";

interface OfferData {
  id: string;
  title: string;
  marketplace: string;
  price: number;
  priceMax: number | null;
  discountBps: number;
  commission: number;
  liaScore: number | null;
  monetizationStatus: string;
  decision: string;
  imageUrl: string | null;
  url: string;
}

export default function OffersPage() {
  const [offers, setOffers] = useState<OfferData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const formatCurrency = (cents: number) => {
    return (cents / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  };

  const loadOffers = async () => {
    try {
      const res = await fetchAuth("/offers?page=1&limit=50");
      if (res.ok) {
        const data = await res.json();
        setOffers(data.data || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const verifyMonetization = async (id: string) => {
    setVerifyingId(id);
    try {
      const res = await fetchAuth(`/offers/${id}/verify-monetization`, {
        method: "POST",
      });
      if (res.ok) {
        await loadOffers(); // Reload table
      } else {
        const errorData = await res.json();
        alert(`Falha: ${errorData.message}`);
      }
    } catch (e) {
      console.error(e);
      alert("Erro inesperado");
    } finally {
      setVerifyingId(null);
    }
  };

  useEffect(() => {
    loadOffers();
  }, []);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          Ofertas
        </h1>
        <p className="text-gray-500 mt-1">
          Gerencie as ofertas extraídas dos marketplaces.
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
                placeholder="Buscar produtos..."
                className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-500 cursor-not-allowed shadow-sm"
              />
            </div>

            <select
              disabled
              className="bg-white border border-gray-200 text-gray-500 text-sm rounded-lg px-3 py-2 cursor-not-allowed shadow-sm"
            >
              <option>Marketplace</option>
            </select>

            <select
              disabled
              className="bg-white border border-gray-200 text-gray-500 text-sm rounded-lg px-3 py-2 cursor-not-allowed shadow-sm"
            >
              <option>Status</option>
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
                  Marketplace
                </th>
                <th className="px-6 py-4 font-medium uppercase tracking-wider text-xs">
                  Preço
                </th>
                <th className="px-6 py-4 font-medium uppercase tracking-wider text-xs">
                  Desconto
                </th>
                <th className="px-6 py-4 font-medium uppercase tracking-wider text-xs">
                  Comissão Est.
                </th>
                <th className="px-6 py-4 font-medium uppercase tracking-wider text-xs">
                  LIA Score
                </th>
                <th className="px-6 py-4 font-medium uppercase tracking-wider text-xs">
                  Monetização
                </th>
                <th className="px-6 py-4 font-medium uppercase tracking-wider text-xs">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-16 text-center text-gray-500"
                  >
                    Carregando ofertas...
                  </td>
                </tr>
              ) : offers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                      <div className="w-12 h-12 bg-gray-50 border rounded-xl flex items-center justify-center text-gray-400 mb-4 shadow-sm">
                        <Tag className="w-6 h-6" />
                      </div>
                      <h3 className="text-gray-900 font-semibold mb-1">
                        Nenhuma oferta
                      </h3>
                      <p className="text-gray-500 text-sm text-center">
                        As ofertas aparecerão aqui quando as integrações
                        começarem a importar produtos.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                offers.map((offer) => (
                  <tr key={offer.id} className="border-b hover:bg-gray-50/50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg border bg-gray-100 flex-shrink-0 flex items-center justify-center overflow-hidden">
                          {offer.imageUrl ? (
                            <img
                              src={offer.imageUrl}
                              alt={offer.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <ImageIcon className="w-5 h-5 text-gray-400" />
                          )}
                        </div>
                        <div className="flex flex-col max-w-[200px] truncate">
                          <a
                            href={offer.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm font-medium text-gray-900 hover:text-blue-600 truncate flex items-center gap-1"
                          >
                            {offer.title}
                            <ExternalLink className="w-3 h-3 text-gray-400" />
                          </a>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-500 font-medium">
                      {offer.marketplace}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-gray-900 font-medium">
                          {formatCurrency(offer.price)}
                        </span>
                        {offer.priceMax && offer.priceMax !== offer.price && (
                          <span className="text-xs text-gray-400 line-through">
                            {formatCurrency(offer.priceMax)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {offer.discountBps > 0 ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700 border border-red-100">
                          -{offer.discountBps / 100}%
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-green-600 font-medium">
                      {formatCurrency(offer.commission)}
                    </td>
                    <td className="px-6 py-4">
                      {offer.liaScore !== null ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                          {offer.liaScore}/100
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">Pendente</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {offer.monetizationStatus === "VERIFIED" ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-100">
                          VERIFICADA
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-100">
                          {offer.monetizationStatus}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {offer.monetizationStatus !== "VERIFIED" ? (
                        <button
                          disabled={verifyingId === offer.id}
                          onClick={() => verifyMonetization(offer.id)}
                          className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium disabled:opacity-50"
                        >
                          {verifyingId === offer.id
                            ? "Verificando..."
                            : "Verificar monetização"}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-500">Pronto</span>
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
