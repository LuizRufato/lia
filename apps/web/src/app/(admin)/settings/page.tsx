"use client";

import { useEffect, useState } from "react";
import { fetchAuth } from "@/lib/api";
import { Building2, User, Lock, Loader2 } from "lucide-react";

export default function SettingsPage() {
  const [tenant, setTenant] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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
    </div>
  );
}
