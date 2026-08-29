"use client";

import { FormEvent, useEffect, useState } from "react";
import { fetchAuth } from "@/lib/api";
import { AdsPageShell, ErrorMessage, money, statusLabel } from "../ads-ui";

export default function AcquisitionCampaignsPage() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: "",
    dailyBudgetCents: "5000",
    totalBudgetCents: "",
  });
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const response = await fetchAuth("/ads/acquisition/campaigns");
    const body = await response.json().catch(() => []);
    if (!response.ok)
      throw new Error(body.message || "Falha ao carregar campanhas.");
    setCampaigns(body);
  }

  useEffect(() => {
    void load().catch((reason) => setError(reason.message));
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const response = await fetchAuth("/ads/acquisition/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          dailyBudgetCents: Number(form.dailyBudgetCents),
          totalBudgetCents: form.totalBudgetCents
            ? Number(form.totalBudgetCents)
            : undefined,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.message || "Não foi possível criar o rascunho.");
      setForm({ name: "", dailyBudgetCents: "5000", totalBudgetCents: "" });
      await load();
    } catch (reason: any) {
      setError(reason.message);
    }
  }

  async function action(id: string, actionName: "submit" | "approve") {
    setError(null);
    const response = await fetchAuth(
      `/ads/acquisition/campaigns/${id}/${actionName}`,
      { method: "POST" },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body.message || "Ação não permitida.");
      return;
    }
    await load();
  }

  return (
    <AdsPageShell
      title="Campanhas"
      description="Campanhas de aquisição em shadow mode, sempre com aprovação humana."
    >
      <ErrorMessage message={error} />
      <form
        onSubmit={create}
        className="grid gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm md:grid-cols-3"
      >
        <input
          required
          placeholder="Nome da campanha"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="rounded-lg border p-2"
        />
        <input
          required
          type="number"
          min="1"
          placeholder="Orçamento diário (centavos)"
          value={form.dailyBudgetCents}
          onChange={(e) =>
            setForm({ ...form, dailyBudgetCents: e.target.value })
          }
          className="rounded-lg border p-2"
        />
        <input
          type="number"
          min="1"
          placeholder="Orçamento total opcional"
          value={form.totalBudgetCents}
          onChange={(e) =>
            setForm({ ...form, totalBudgetCents: e.target.value })
          }
          className="rounded-lg border p-2"
        />
        <button className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 md:col-span-3">
          Salvar rascunho
        </button>
      </form>
      <div className="space-y-3">
        {campaigns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
            Nenhuma campanha de aquisição criada.
          </div>
        ) : (
          campaigns.map((campaign) => (
            <div
              key={campaign.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
            >
              <div>
                <p className="font-semibold text-gray-900">{campaign.name}</p>
                <p className="text-sm text-gray-500">
                  MEMBER_ACQUISITION · {money(campaign.dailyBudgetCents)}/dia ·
                  Pool LIA Achou
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">
                  {statusLabel(campaign.status)}
                </span>
                {campaign.status === "DRAFT" && (
                  <button
                    onClick={() => void action(campaign.id, "submit")}
                    className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700"
                  >
                    Enviar para revisão
                  </button>
                )}
                {campaign.status === "READY_FOR_REVIEW" && (
                  <button
                    onClick={() => void action(campaign.id, "approve")}
                    className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700"
                  >
                    Aprovar
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      <p className="text-sm text-slate-500">
        A aprovação não publica nada na Meta. A etapa de escrita permanece
        desabilitada.
      </p>
    </AdsPageShell>
  );
}
