"use client";

import { useEffect, useState } from "react";
import { fetchAuth } from "@/lib/api";
import { AdsPageShell, ErrorMessage } from "../ads-ui";

export default function AdsSettingsPage() {
  const [settings, setSettings] = useState<any>({
    adsEnabled: false,
    adsPublicSearchEnabled: false,
    adsBillingEnabled: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    fetchAuth("/ads/settings")
      .then((r) => r.json())
      .then(setSettings)
      .catch((e) => setError(e.message));
  }, []);
  async function save() {
    setSaving(true);
    try {
      const response = await fetchAuth("/ads/settings", {
        method: "PATCH",
        body: JSON.stringify({
          adsEnabled: settings.adsEnabled,
          adsPublicSearchEnabled: settings.adsPublicSearchEnabled,
          adsBillingEnabled: settings.adsBillingEnabled,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.message || "Falha ao salvar configurações.");
      setSettings(body);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  const fields = [
    ["adsEnabled", "LIA Ads"],
    ["adsPublicSearchEnabled", "Ads na Public Search"],
    ["adsBillingEnabled", "Billing Ads"],
  ] as const;
  return (
    <AdsPageShell
      title="Configurações Ads"
      description="As flags são independentes no armazenamento, mas a entrega futura deve permanecer fail-closed quando Ads estiver desligado."
    >
      <ErrorMessage message={error} />
      <div className="space-y-3 rounded-xl border bg-white p-6 shadow-sm">
        {fields.map(([key, label]) => (
          <label
            key={key}
            className="flex items-center justify-between rounded-lg border p-4"
          >
            <span>
              <span className="block font-semibold">{label}</span>
              <span className="text-sm text-gray-500">
                Controle administrativo, sem delivery nesta fase.
              </span>
            </span>
            <input
              type="checkbox"
              checked={Boolean(settings[key])}
              onChange={(e) =>
                setSettings({ ...settings, [key]: e.target.checked })
              }
              className="h-5 w-5"
            />
          </label>
        ))}
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          LIA Ads ainda não entrega anúncios enquanto os recursos de delivery
          não estiverem habilitados.
        </p>
        <button
          disabled={saving}
          onClick={save}
          className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Salvando..." : "Salvar configurações"}
        </button>
      </div>
    </AdsPageShell>
  );
}
