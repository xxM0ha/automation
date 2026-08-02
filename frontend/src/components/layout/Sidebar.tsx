import { useState, useEffect } from 'react';
import type { ElementType } from 'react';
import { logout, useUser } from '../../lib/authStore';
import { LayoutDashboard, TrendingUp, Zap, Package, LogOut, X, LayoutGrid, Bot, Terminal, Printer, Store } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Wordmark } from '../ui/Wordmark';
import type { Page, Role } from '../../types';

const adminNavItems: { id: Page; label: string; icon: ElementType }[] = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
  { id: 'reports',   label: 'التحليلات',   icon: TrendingUp },
  { id: 'orders',    label: 'الطلبات',      icon: Zap },
  { id: 'menu',      label: 'القائمة',      icon: Package },
  { id: 'apps',      label: 'التطبيقات',    icon: LayoutGrid },
  { id: 'printers',  label: 'الطابعات',     icon: Printer },
];

const kitchenNavItems: { id: Page; label: string; icon: ElementType }[] = [
  { id: 'dashboard', label: 'لوحة المطبخ', icon: LayoutDashboard },
  { id: 'orders',    label: 'الطلبات',      icon: Zap },
  { id: 'menu',      label: 'القائمة',      icon: Package },
  { id: 'apps',      label: 'التطبيقات',    icon: LayoutGrid },
];

const devNavItems: { id: Page; label: string; icon: ElementType }[] = [
  { id: 'automation', label: 'الأتمتة', icon: Bot },
  { id: 'developer',  label: 'المطوّر', icon: Terminal },
];

interface SidebarProps {
  currentPage: Page;
  setPage: (p: Page) => void;
  role?: Role;
}

export const Sidebar = ({ currentPage, setPage, role }: SidebarProps) => {
  const user = useUser();
  // A dev account (no restaurant) manages automation only. Otherwise the nav
  // follows the logged-in user's real role (falling back to the prop / kitchen).
  const effectiveRole = user?.role ?? role ?? 'kitchen';
  let navItems = user?.isDev
    ? devNavItems
    : effectiveRole === 'admin'
      ? adminNavItems
      : kitchenNavItems;
  // Owners get a الفروع entry to manage/switch branches.
  if (user?.isOwner && !user?.isDev) {
    navItems = [
      navItems[0],
      { id: 'branches', label: 'الفروع', icon: Store },
      ...navItems.slice(1),
    ];
  }
  const [mobileOpen, setMobileOpen] = useState(false);

  // The mobile menu button lives in the TopNav (so it can't overlap the brand);
  // it opens this drawer via a custom event.
  useEffect(() => {
    const open = () => setMobileOpen(true);
    window.addEventListener('prime:toggle-sidebar', open);
    return () => window.removeEventListener('prime:toggle-sidebar', open);
  }, []);

  const handleNav = (id: Page) => {
    setPage(id);
    setMobileOpen(false);
  };

  const content = (
    <div className="flex flex-col h-full">
      <div className="mb-8 px-4 pt-2 pb-1 flex items-center">
        <Wordmark onDark className="text-2xl" />
      </div>

      <nav className="flex flex-col gap-1 flex-1">
        {navItems.map((item) => {
          const active = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleNav(item.id)}
              className={cn(
                'relative flex items-center gap-3 rounded-xl px-4 py-3 transition-all text-start w-full',
                active
                  ? 'bg-white/[0.06] text-white font-semibold'
                  : 'text-white/55 hover:bg-white/[0.04] hover:text-white/90',
              )}
            >
              {active && <span className="absolute right-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-full bg-lime" />}
              <item.icon size={20} className={active ? 'text-lime' : ''} />
              <span className="text-sm">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto pt-6 border-t border-white/10">
        <button
          onClick={() => logout()}
          className="flex items-center gap-3 text-white/55 px-4 py-3 hover:bg-white/[0.04] hover:text-white rounded-xl text-start w-full transition-all"
        >
          <LogOut size={20} />
          <span className="text-sm">تسجيل الخروج</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="hidden md:flex flex-col h-screen w-64 bg-ink sticky top-0 p-4 gap-2 shrink-0 z-40">
        {content}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-72 h-full bg-ink p-4 flex flex-col shadow-2xl">
            <button
              className="absolute top-4 left-4 p-2 text-white/60 hover:bg-white/10 rounded-xl"
              onClick={() => setMobileOpen(false)}
            >
              <X size={20} />
            </button>
            <div className="mt-10">{content}</div>
          </aside>
        </div>
      )}
    </>
  );
};
