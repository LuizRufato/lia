"use client";

export function money(cents: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format((cents || 0) / 100);
}

export function statusLabel(status: string) {
  return status
    .replace("PENDING_REVIEW", "AGUARDANDO REVISÃO")
    .replace("ACTIVE", "ATIVA")
    .replace("PAUSED", "PAUSADA")
    .replace("DRAFT", "RASCUNHO")
    .replace("REJECTED", "REJEITADA")
    .replace("ENDED", "ENCERRADA");
}

export function AdsNav() {
  return (
    <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-4">
      {[
        ["Dashboard", "/ads"],
        ["Campanhas", "/ads/campaigns"],
        ["Anunciantes", "/ads/advertisers"],
        ["Financeiro", "/ads/financial"],
        ["Configurações", "/ads/settings"],
      ].map(([label, href]) => (
        <a
          key={href}
          href={href}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:border-blue-300 hover:text-blue-700"
        >
          {label}
        </a>
      ))}
    </div>
  );
}

export function AdsPageShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          {title}
        </h1>
        <p className="mt-1 text-gray-500">{description}</p>
      </div>
      <AdsNav />
      {children}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
      {detail && <p className="mt-1 text-xs text-gray-500">{detail}</p>}
    </div>
  );
}

export function ErrorMessage({ message }: { message: string | null }) {
  return message ? (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {message}
    </div>
  ) : null;
}
