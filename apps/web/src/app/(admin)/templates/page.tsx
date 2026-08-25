"use client";

import { useEffect, useState } from "react";
import { fetchAuth } from "@/lib/api";
import { FileText, Loader2, Plus, Save } from "lucide-react";

const TYPES = ["ACHADINHO", "OFERTA", "PRECO_CAIU", "MAIS_VENDIDO", "GENERIC"];
const VARIABLES = [
  "{titulo}",
  "{preco_atual}",
  "{preco_antigo}",
  "{desconto}",
  "{cta}",
  "{link}",
  "{marketplace}",
  "{sales_count}",
  "{rating}",
];

function StatusBadge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "green" | "blue" | "gray";
}) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    blue: "bg-blue-50 text-blue-700 ring-blue-600/20",
    gray: "bg-gray-100 text-gray-600 ring-gray-500/20",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function TemplateToggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50/70 px-4 py-3">
      <div>
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <p className="mt-0.5 text-xs text-gray-500">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
          checked ? "bg-blue-600" : "bg-gray-300"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    const [templatesResponse, previewResponse] = await Promise.all([
      fetchAuth("/templates"),
      fetchAuth("/templates/preview"),
    ]);
    if (templatesResponse.ok) {
      const items = await templatesResponse.json();
      setTemplates(items);
      if (!selected && items[0]) setSelected(items[0]);
    }
    if (previewResponse.ok) setPreview(await previewResponse.json());
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    const isNew = selected.id === "new";
    const response = await fetchAuth(
      isNew ? "/templates" : "/templates/" + selected.id,
      {
        method: isNew ? "POST" : "PATCH",
        body: JSON.stringify(selected),
      },
    );
    setMessage(
      response.ok ? "Template salvo." : "Não foi possível salvar o template.",
    );
    if (response.ok) await load();
    setSaving(false);
    setTimeout(() => setMessage(""), 3000);
  };

  if (loading)
    return <Loader2 className="h-8 w-8 animate-spin text-blue-500" />;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Templates de publicação</h1>
          <p className="mt-1 text-gray-500">
            Copy segura e configurável por tenant.
          </p>
        </div>
        <button
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white shadow-sm transition hover:bg-blue-700"
          onClick={() =>
            setSelected({
              id: "new",
              name: "Novo template",
              type: "GENERIC",
              body: "*{titulo}\n\n💰 {preco_atual}\n\n👉 {cta}\n{link}",
              ctaMode: "AUTO",
              customCta: "",
              enabled: true,
              isDefault: false,
              priority: 0,
            })
          }
        >
          <Plus className="h-4 w-4" /> Novo
        </button>
      </div>
      {message && (
        <div className="rounded-lg bg-green-50 p-3 text-green-800">
          {message}
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:sticky lg:top-6 lg:self-start">
          {templates.map((template) => (
            <button
              key={template.id}
              onClick={() => setSelected(template)}
              className={
                "w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md " +
                (selected?.id === template.id
                  ? "border-blue-500 ring-2 ring-blue-100"
                  : "border-gray-200")
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="block truncate font-semibold text-gray-900">
                    {template.name}
                  </span>
                  <span className="mt-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
                    {template.type}
                  </span>
                </div>
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <StatusBadge tone={template.enabled ? "green" : "gray"}>
                  {template.enabled ? "Ativo" : "Desativado"}
                </StatusBadge>
                {template.isDefault && (
                  <StatusBadge tone="blue">Padrão</StatusBadge>
                )}
              </div>
              <p className="mt-3 line-clamp-2 text-xs leading-5 text-gray-500">
                {template.body}
              </p>
            </button>
          ))}
        </div>
        <form
          onSubmit={save}
          className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm lg:col-span-2"
        >
          {selected ? (
            <>
              <div className="mb-6 flex items-start justify-between gap-4">
                <div className="flex items-center gap-2 text-lg font-semibold">
                  <FileText className="h-5 w-5 text-blue-600" /> Editar template
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                  <StatusBadge tone={selected.enabled ? "green" : "gray"}>
                    {selected.enabled ? "Ativo" : "Desativado"}
                  </StatusBadge>
                  {selected.isDefault && (
                    <StatusBadge tone="blue">Padrão</StatusBadge>
                  )}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm font-medium text-gray-700">
                  <span>Nome</span>
                  <input
                    className="mt-2 w-full rounded-lg border border-gray-300 bg-white p-2.5 font-normal text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    value={selected.name}
                    onChange={(e) =>
                      setSelected({ ...selected, name: e.target.value })
                    }
                  />
                </label>
                <label className="text-sm font-medium text-gray-700">
                  <span>Tipo</span>
                  <select
                    className="mt-2 w-full rounded-lg border border-gray-300 bg-white p-2.5 font-normal text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    value={selected.type}
                    onChange={(e) =>
                      setSelected({ ...selected, type: e.target.value })
                    }
                  >
                    {TYPES.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="mt-5 block text-sm font-medium text-gray-700">
                <span>Corpo da mensagem</span>
                <textarea
                  className="mt-2 min-h-48 w-full rounded-lg border border-gray-300 bg-white p-3 font-mono text-sm font-normal leading-6 text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  value={selected.body}
                  onChange={(e) =>
                    setSelected({ ...selected, body: e.target.value })
                  }
                />
              </label>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-sm font-medium text-gray-700">
                  <span>CTA</span>
                  <select
                    className="mt-2 w-full rounded-lg border border-gray-300 bg-white p-2.5 font-normal text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    value={selected.ctaMode}
                    onChange={(e) =>
                      setSelected({ ...selected, ctaMode: e.target.value })
                    }
                  >
                    <option value="AUTO">Automático</option>
                    <option value="CUSTOM">Personalizado</option>
                  </select>
                </label>
                <label className="text-sm font-medium text-gray-700">
                  <span>CTA personalizado</span>
                  <input
                    className="mt-2 w-full rounded-lg border border-gray-300 bg-white p-2.5 font-normal text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-100"
                    value={selected.customCta || ""}
                    onChange={(e) =>
                      setSelected({ ...selected, customCta: e.target.value })
                    }
                    disabled={selected.ctaMode !== "CUSTOM"}
                  />
                </label>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <TemplateToggle
                  checked={selected.enabled}
                  onChange={(enabled) => setSelected({ ...selected, enabled })}
                  label="Ativo"
                  description="Pode ser escolhido pela publicação."
                />
                <TemplateToggle
                  checked={selected.isDefault}
                  onChange={(isDefault) =>
                    setSelected({ ...selected, isDefault })
                  }
                  label="Padrão"
                  description="Só um template pode ser padrão."
                />
              </div>
              <div className="mt-6 flex items-center justify-between gap-4 border-t border-gray-100 pt-5">
                <p className="text-xs text-gray-500">
                  As alterações só entram em vigor depois de salvar.
                </p>
                <button
                  disabled={saving}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />{" "}
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </>
          ) : (
            <p className="text-gray-500">Selecione um template para editar.</p>
          )}
        </form>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-gray-900">Variáveis disponíveis</h2>
          <p className="mt-1 text-xs text-gray-500">
            Use estas variáveis no corpo para preencher os dados da oferta.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {VARIABLES.map((variable) => (
              <code
                key={variable}
                className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700"
              >
                {variable}
              </code>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-gray-900">
            Pré-visualização{" "}
            {preview?.isDemo ? "(demonstração)" : "(oferta real recente)"}
          </h2>
          <div className="mt-4 space-y-3">
            {preview?.previews?.map((item: any) => (
              <div
                key={item.id || item.name}
                className="rounded-xl border border-gray-100 bg-gray-50 p-4 whitespace-pre-wrap text-sm leading-6 text-gray-700"
              >
                {item.rendered}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-500">
            A prévia não cria nem publica dados.
          </p>
        </div>
      </div>
    </div>
  );
}
