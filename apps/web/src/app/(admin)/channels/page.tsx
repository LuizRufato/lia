import { MessageCircle } from 'lucide-react';

export default function ChannelsPage() {
  const channels = [
    { name: 'Telegram', status: 'Não conectado' },
    { name: 'WhatsApp', status: 'Não conectado' },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] overflow-hidden">
        <ul className="divide-y divide-[var(--color-border)]">
          {channels.map((channel) => (
            <li key={channel.name} className="p-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
              <div className="flex items-center">
                <div className="h-10 w-10 rounded-lg bg-emerald-50 flex items-center justify-center mr-4">
                  <MessageCircle className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-[var(--color-text-primary)]">{channel.name}</h3>
                  <p className="text-sm text-[var(--color-text-secondary)]">{channel.status}</p>
                </div>
              </div>
              <button className="px-4 py-2 text-sm font-medium text-emerald-600 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors">
                Conectar
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
