export default function OverviewPage() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Metric Cards placeholders */}
        {['Vendas', 'Cliques', 'Comissão'].map((metric) => (
          <div key={metric} className="bg-[var(--color-surface)] p-6 rounded-xl shadow-sm border border-[var(--color-border)]">
            <h3 className="text-sm font-medium text-[var(--color-text-secondary)]">{metric}</h3>
            <div className="mt-2 flex items-baseline">
              <p className="text-2xl font-semibold text-[var(--color-text-primary)]">--</p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] p-8 text-center flex flex-col items-center justify-center min-h-[300px]">
        <h3 className="text-lg font-medium text-[var(--color-text-primary)]">Nenhum dado disponível</h3>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          Conecte um marketplace para começar a rastrear métricas.
        </p>
      </div>
    </div>
  );
}
