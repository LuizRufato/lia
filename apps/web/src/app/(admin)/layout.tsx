'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  LayoutDashboard, 
  Tag, 
  FileText, 
  BarChart2, 
  Plug, 
  MessageCircle, 
  Settings,
  LogOut,
  Menu,
  X
} from 'lucide-react';

const MENU_ITEMS = [
  { name: 'Visão Geral', href: '/overview', icon: LayoutDashboard },
  { name: 'Ofertas', href: '/offers', icon: Tag },
  { name: 'Publicações', href: '/publications', icon: FileText },
  { name: 'Analytics', href: '/analytics', icon: BarChart2 },
  { name: 'Integrações', href: '/integrations', icon: Plug },
  { name: 'Canais', href: '/channels', icon: MessageCircle },
  { name: 'Configurações', href: '/settings', icon: Settings },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await fetch('http://localhost:3000/auth/logout', { method: 'POST' });
      router.push('/login');
      router.refresh();
    } catch (error) {
      console.error('Erro ao fazer logout', error);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-background)] flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-[var(--color-surface)] border-b border-[var(--color-border)] sticky top-0 z-20">
        <h1 className="text-xl font-bold text-[var(--color-primary)]">LIA</h1>
        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="text-[var(--color-text-primary)]">
          {isSidebarOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-10 w-64 bg-[var(--color-surface)] border-r border-[var(--color-border)] transform transition-transform duration-200 ease-in-out flex flex-col
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        md:relative md:translate-x-0
      `}>
        <div className="p-6 hidden md:block">
          <h1 className="text-2xl font-bold text-[var(--color-primary)] tracking-tight">LIA</h1>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1 font-medium">Painel Administrativo</p>
        </div>

        <nav className="flex-1 px-4 py-4 md:py-0 space-y-1 overflow-y-auto">
          {MENU_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname.startsWith(item.href);
            
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setIsSidebarOpen(false)}
                className={`
                  flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors
                  ${isActive 
                    ? 'bg-blue-50 text-[var(--color-secondary)]' 
                    : 'text-[var(--color-text-secondary)] hover:bg-slate-50 hover:text-[var(--color-text-primary)]'
                  }
                `}
              >
                <Icon className={`mr-3 h-5 w-5 ${isActive ? 'text-[var(--color-secondary)]' : 'text-slate-400'}`} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[var(--color-border)]">
          <div className="flex items-center px-4 py-3 mb-2">
            <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-sm mr-3">
              A
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">Administrador</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center w-full px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <LogOut className="mr-3 h-5 w-5" />
            Sair do painel
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <header className="hidden md:flex h-16 bg-[var(--color-surface)] border-b border-[var(--color-border)] items-center px-8 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)] capitalize">
            {pathname.split('/')[1] || 'Dashboard'}
          </h2>
        </header>
        <div className="flex-1 overflow-auto p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
