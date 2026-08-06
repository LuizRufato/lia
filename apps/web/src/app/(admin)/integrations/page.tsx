import { Store } from 'lucide-react';

export default function IntegrationsPage() {
  const integrations = [
    { name: 'Mercado Livre', status: 'Não conectado' },
    { name: 'Shopee', status: 'Não conectado' },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] overflow-hidden">
        <ul className="divide-y divide-[var(--color-border)]">
          {integrations.map((integration) => (
            <li key={integration.name} className="p-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
              <div className="flex items-center">
                <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center mr-4">
                  <Store className="h-5 w-5 text-[var(--color-secondary)]" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-[var(--color-text-primary)]">{integration.name}</h3>
                  <p className="text-sm text-[var(--color-text-secondary)]">{integration.status}</p>
                </div>
              </div>
              <button className="px-4 py-2 text-sm font-medium text-[var(--color-secondary)] bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors">
                Conectar
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
