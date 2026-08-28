"use client";

import { FormEvent, useEffect, useState } from "react";
import { fetchAuth } from "@/lib/api";
import { AdsPageShell, ErrorMessage, money, statusLabel } from "../ads-ui";

export default function AdsAdvertisersPage() {
  const [items, setItems] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creditFor, setCreditFor] = useState<string | null>(null);
  const [amount, setAmount] = useState("10000");
  const [reason, setReason] = useState("Crédito manual inicial");
  async function load() {
    const response = await fetchAuth("/ads/advertisers");
    const body = await response.json().catch(() => []);
    if (!response.ok)
      throw new Error(body.message || "Falha ao carregar anunciantes.");
    setItems(body);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      const response = await fetchAuth("/ads/advertisers", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.message || "Falha ao criar anunciante.");
      setName("");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function credit(event: FormEvent) {
    event.preventDefault();
    if (!creditFor) return;
    try {
      const response = await fetchAuth(
        `/ads/advertisers/${creditFor}/credits`,
        {
          method: "POST",
          body: JSON.stringify({
            amountCents: Number(amount),
            reason,
            idempotencyKey: `manual-${creditFor}-${Date.now()}`,
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Falha ao creditar.");
      setCreditFor(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function toggle(item: any) {
    try {
      const response = await fetchAuth(`/ads/advertisers/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: item.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
        }),
      });
      if (!response.ok) throw new Error("Falha ao atualizar anunciante.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <AdsPageShell
      title="Anunciantes"
      description="Cadastro comercial mínimo, sem dados bancários ou documentos sensíveis."
    >
      <ErrorMessage message={error} />
      <form
        onSubmit={create}
        className="flex gap-2 rounded-xl border bg-white p-5 shadow-sm"
      >
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome do anunciante"
          className="flex-1 rounded-lg border p-2"
        />
        <button className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white">
          Adicionar
        </button>
      </form>
      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-gray-50">
            <tr>
              {["Nome", "Status", "Saldo", "Campanhas", "Ações"].map(
                (heading) => (
                  <th
                    key={heading}
                    className="px-4 py-3 font-semibold text-gray-600"
                  >
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-gray-500">
                  Nenhum anunciante cadastrado.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-semibold">{item.name}</td>
                  <td className="px-4 py-3">{statusLabel(item.status)}</td>
                  <td className="px-4 py-3">
                    {money(item.balance?.availableCents)}
                  </td>
                  <td className="px-4 py-3">{item.campaignCount}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setCreditFor(item.id)}
                      className="mr-2 rounded bg-blue-50 px-2 py-1 text-xs text-blue-700"
                    >
                      Adicionar crédito
                    </button>
                    <button
                      onClick={() => toggle(item)}
                      className="rounded bg-gray-100 px-2 py-1 text-xs"
                    >
                      {item.status === "ACTIVE" ? "Suspender" : "Reativar"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {creditFor && (
        <form
          onSubmit={credit}
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
        >
          <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold">Adicionar crédito manual</h2>
            <input
              required
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border p-2"
              placeholder="Valor em centavos"
            />
            <input
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border p-2"
              placeholder="Motivo"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreditFor(null)}
                className="rounded-lg border px-4 py-2"
              >
                Cancelar
              </button>
              <button className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white">
                Registrar crédito
              </button>
            </div>
          </div>
        </form>
      )}
    </AdsPageShell>
  );
}
