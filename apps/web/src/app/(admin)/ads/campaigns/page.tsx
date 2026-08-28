"use client";

import { FormEvent, useEffect, useState } from "react";
import { fetchAuth } from "@/lib/api";
import { AdsPageShell, ErrorMessage, money, statusLabel } from "../ads-ui";

const emptyForm = {
  name: "",
  advertiserId: "",
  offerId: "",
  bidCpcCents: "100",
  totalBudgetCents: "10000",
  dailyBudgetCents: "2000",
  startAt: "",
  endAt: "",
};

export default function AdsCampaignsPage() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [advertisers, setAdvertisers] = useState<any[]>([]);
  const [offers, setOffers] = useState<any[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [campaignResponse, advertiserResponse, offerResponse] =
        await Promise.all([
          fetchAuth("/ads/campaigns"),
          fetchAuth("/ads/advertisers"),
          fetchAuth("/offers?limit=100"),
        ]);
      const campaignBody = await campaignResponse.json();
      const advertiserBody = await advertiserResponse.json();
      const offerBody = await offerResponse.json();
      if (!campaignResponse.ok)
        throw new Error(campaignBody.message || "Falha ao carregar campanhas.");
      setCampaigns(campaignBody.data || []);
      setAdvertisers(advertiserBody || []);
      setOffers(offerBody.data || []);
    } catch (reason: any) {
      setError(reason.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const response = await fetchAuth("/ads/campaigns", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          bidCpcCents: Number(form.bidCpcCents),
          totalBudgetCents: Number(form.totalBudgetCents),
          dailyBudgetCents: Number(form.dailyBudgetCents),
          startAt: new Date(form.startAt).toISOString(),
          endAt: new Date(form.endAt).toISOString(),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.message || "Não foi possível criar a campanha.");
      setForm(emptyForm);
      await load();
    } catch (reason: any) {
      setError(reason.message);
    }
  }

  async function action(id: string, path: string) {
    setError(null);
    try {
      const response = await fetchAuth(`/ads/campaigns/${id}/${path}`, {
        method: "POST",
        body:
          path === "reject"
            ? JSON.stringify({ reason: "Revisão administrativa" })
            : undefined,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "Ação não permitida.");
      await load();
    } catch (reason: any) {
      setError(reason.message);
    }
  }

  return (
    <AdsPageShell
      title="Campanhas Ads"
      description="Campanhas Shopee com revisão manual e sem entrega pública nesta fase."
    >
      <ErrorMessage message={error} />
      <form
        onSubmit={create}
        className="grid gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm md:grid-cols-2 lg:grid-cols-4"
      >
        <h2 className="md:col-span-2 lg:col-span-4 text-lg font-semibold">
          Nova campanha
        </h2>
        <input
          required
          placeholder="Nome"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="rounded-lg border p-2"
        />
        <select
          required
          value={form.advertiserId}
          onChange={(e) => setForm({ ...form, advertiserId: e.target.value })}
          className="rounded-lg border p-2"
        >
          <option value="">Anunciante</option>
          {advertisers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          required
          value={form.offerId}
          onChange={(e) => setForm({ ...form, offerId: e.target.value })}
          className="rounded-lg border p-2"
        >
          <option value="">Offer Shopee real</option>
          {offers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title} — {money(item.price)}
            </option>
          ))}
        </select>
        <input
          required
          type="number"
          min="1"
          placeholder="CPC (centavos)"
          value={form.bidCpcCents}
          onChange={(e) => setForm({ ...form, bidCpcCents: e.target.value })}
          className="rounded-lg border p-2"
        />
        <input
          required
          type="number"
          min="1"
          placeholder="Orçamento total"
          value={form.totalBudgetCents}
          onChange={(e) =>
            setForm({ ...form, totalBudgetCents: e.target.value })
          }
          className="rounded-lg border p-2"
        />
        <input
          required
          type="number"
          min="1"
          placeholder="Orçamento diário"
          value={form.dailyBudgetCents}
          onChange={(e) =>
            setForm({ ...form, dailyBudgetCents: e.target.value })
          }
          className="rounded-lg border p-2"
        />
        <label className="text-sm text-gray-600">
          Início
          <input
            required
            type="datetime-local"
            value={form.startAt}
            onChange={(e) => setForm({ ...form, startAt: e.target.value })}
            className="mt-1 w-full rounded-lg border p-2 text-gray-900"
          />
        </label>
        <label className="text-sm text-gray-600">
          Fim
          <input
            required
            type="datetime-local"
            value={form.endAt}
            onChange={(e) => setForm({ ...form, endAt: e.target.value })}
            className="mt-1 w-full rounded-lg border p-2 text-gray-900"
          />
        </label>
        <button className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 lg:col-span-4">
          Criar rascunho
        </button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-gray-50">
            <tr>
              {[
                "Nome",
                "Anunciante",
                "Produto",
                "Status",
                "CPC",
                "Orçamento",
                "Ações",
              ].map((heading) => (
                <th
                  key={heading}
                  className="px-4 py-3 font-semibold text-gray-600"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr>
                <td colSpan={7} className="p-8 text-center">
                  Carregando...
                </td>
              </tr>
            ) : campaigns.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-gray-500">
                  Nenhuma campanha cadastrada.
                </td>
              </tr>
            ) : (
              campaigns.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-semibold">{item.name}</td>
                  <td className="px-4 py-3">{item.advertiser?.name}</td>
                  <td className="px-4 py-3">{item.offer?.title}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold">
                      {statusLabel(item.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3">{money(item.bidCpcCents)}</td>
                  <td className="px-4 py-3">
                    {money(item.totalBudgetCents)} / dia{" "}
                    {money(item.dailyBudgetCents)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {item.status === "DRAFT" && (
                        <button
                          onClick={() => action(item.id, "submit")}
                          className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700"
                        >
                          Enviar
                        </button>
                      )}
                      {item.status === "PENDING_REVIEW" && (
                        <>
                          <button
                            onClick={() => action(item.id, "approve")}
                            className="rounded bg-green-50 px-2 py-1 text-xs text-green-700"
                          >
                            Aprovar
                          </button>
                          <button
                            onClick={() => action(item.id, "reject")}
                            className="rounded bg-red-50 px-2 py-1 text-xs text-red-700"
                          >
                            Rejeitar
                          </button>
                        </>
                      )}
                      {item.status === "ACTIVE" && (
                        <button
                          onClick={() => action(item.id, "pause")}
                          className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700"
                        >
                          Pausar
                        </button>
                      )}
                      {item.status === "PAUSED" && (
                        <button
                          onClick={() => action(item.id, "resume")}
                          className="rounded bg-green-50 px-2 py-1 text-xs text-green-700"
                        >
                          Retomar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AdsPageShell>
  );
}
