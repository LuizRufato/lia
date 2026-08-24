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
    return <Loader2 className="w-8 h-8 animate-spin text-blue-500" />;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Templates de publicação</h1>
          <p className="text-gray-500 mt-1">
            Copy segura e configurável por tenant.
          </p>
        </div>
        <button
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white"
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
          <Plus className="w-4 h-4" /> Novo
        </button>
      </div>
      {message && (
        <div className="rounded-lg bg-green-50 p-3 text-green-800">
          {message}
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-3">
          {templates.map((template) => (
            <button
              key={template.id}
              onClick={() => setSelected(template)}
              className={
                "w-full rounded-xl border bg-white p-4 text-left shadow-sm " +
                (selected?.id === template.id
                  ? "border-blue-500 ring-2 ring-blue-100"
                  : "")
              }
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{template.name}</span>
                <span className="text-xs text-gray-500">{template.type}</span>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                {template.enabled ? "Ativo" : "Desativado"}{" "}
                {template.isDefault ? "• padrão" : ""}
              </div>
            </button>
          ))}
        </div>
        <form
          onSubmit={save}
          className="rounded-xl border bg-white p-6 shadow-sm lg:col-span-2"
        >
          {selected ? (
            <>
              <div className="mb-4 flex items-center gap-2 text-lg font-semibold">
                <FileText className="w-5 h-5 text-blue-600" /> Editar template
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm">
                  Nome
                  <input
                    className="mt-1 w-full rounded border p-2"
                    value={selected.name}
                    onChange={(e) =>
                      setSelected({ ...selected, name: e.target.value })
                    }
                  />
                </label>
                <label className="text-sm">
                  Tipo
                  <select
                    className="mt-1 w-full rounded border p-2"
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
              <label className="mt-4 block text-sm">
                Corpo
                <textarea
                  className="mt-1 min-h-48 w-full rounded border p-2 font-mono text-sm"
                  value={selected.body}
                  onChange={(e) =>
                    setSelected({ ...selected, body: e.target.value })
                  }
                />
              </label>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-sm">
                  CTA
                  <select
                    className="mt-1 w-full rounded border p-2"
                    value={selected.ctaMode}
                    onChange={(e) =>
                      setSelected({ ...selected, ctaMode: e.target.value })
                    }
                  >
                    <option value="AUTO">Automático</option>
                    <option value="CUSTOM">Personalizado</option>
                  </select>
                </label>
                <label className="text-sm">
                  CTA personalizado
                  <input
                    className="mt-1 w-full rounded border p-2"
                    value={selected.customCta || ""}
                    onChange={(e) =>
                      setSelected({ ...selected, customCta: e.target.value })
                    }
                    disabled={selected.ctaMode !== "CUSTOM"}
                  />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap gap-5 text-sm">
                <label>
                  <input
                    type="checkbox"
                    checked={selected.enabled}
                    onChange={(e) =>
                      setSelected({ ...selected, enabled: e.target.checked })
                    }
                  />{" "}
                  Ativo
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.isDefault}
                    onChange={(e) =>
                      setSelected({ ...selected, isDefault: e.target.checked })
                    }
                  />{" "}
                  Padrão
                </label>
              </div>
              <div className="mt-5 flex justify-end">
                <button
                  disabled={saving}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white"
                >
                  <Save className="w-4 h-4" />{" "}
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
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="font-semibold">Variáveis disponíveis</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {VARIABLES.map((variable) => (
              <code
                key={variable}
                className="rounded bg-gray-100 px-2 py-1 text-xs"
              >
                {variable}
              </code>
            ))}
          </div>
        </div>
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="font-semibold">
            Pré-visualização{" "}
            {preview?.isDemo ? "(demonstração)" : "(oferta real recente)"}
          </h2>
          <div className="mt-3 space-y-3">
            {preview?.previews?.map((item: any) => (
              <div
                key={item.id || item.name}
                className="rounded bg-gray-50 p-3 whitespace-pre-wrap text-sm"
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
