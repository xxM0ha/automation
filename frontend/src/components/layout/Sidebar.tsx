import { useState } from 'react';
import type { ElementType } from 'react';
import { logout } from '../../lib/authStore';
import { LayoutDashboard, TrendingUp, Zap, Package, Headset, HelpCircle, LogOut, X, Menu, LayoutGrid } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Page, Role } from '../../types';

const adminNavItems: { id: Page; label: string; icon: ElementType }[] = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
  { id: 'reports',   label: 'التحليلات',   icon: TrendingUp },
  { id: 'orders',    label: 'الطلبات',      icon: Zap },
  { id: 'menu',      label: 'القائمة',      icon: Package },
  { id: 'apps',      label: 'التطبيقات',    icon: LayoutGrid },
];

const kitchenNavItems: { id: Page; label: string; icon: ElementType }[] = [
  { id: 'dashboard', label: 'لوحة المطبخ', icon: LayoutDashboard },
  { id: 'orders',    label: 'الطلبات',      icon: Zap },
  { id: 'menu',      label: 'القائمة',      icon: Package },
  { id: 'apps',      label: 'التطبيقات',    icon: LayoutGrid },
];

interface SidebarProps {
  currentPage: Page;
  setPage: (p: Page) => void;
  role?: Role;
}

export const Sidebar = ({ currentPage, setPage, role = 'kitchen' }: SidebarProps) => {
  const navItems = role === 'admin' ? adminNavItems : kitchenNavItems;
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNav = (id: Page) => {
    setPage(id);
    setMobileOpen(false);
  };

  const content = (
    <div className="flex flex-col h-full">
      <div className="mb-8 px-4 py-2">
        <h1 className="text-lg font-bold text-slate-900">برايم HQ</h1>
        <p className="text-xs text-slate-500 font-medium font-technical">منصة الأتمتة</p>
      </div>

      <nav className="flex flex-col gap-1.5 flex-1">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => handleNav(item.id)}
            className={cn(
              'flex items-center gap-3 rounded-xl px-4 py-3 transition-all text-start w-full',
              currentPage === item.id
                ? 'bg-blue-50 text-blue-600 font-semibold'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
            )}
          >
            <item.icon size={20} />
            <span className="text-sm">{item.label}</span>
          </button>
        ))}
        <button
          onClick={() => handleNav('orders')}
          className={cn(
            'flex items-center gap-3 rounded-xl px-4 py-3 transition-all text-start w-full',
            currentPage === 'orders' ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-slate-500 hover:bg-slate-100'
          )}
        >
          <Headset size={20} />
          <span className="text-sm">الدعم</span>
        </button>
      </nav>

      <div className="mt-auto flex flex-col gap-2 pt-6 border-t border-slate-200/50">
        <button className="flex items-center gap-3 text-slate-500 px-4 py-3 hover:bg-slate-100 rounded-xl text-start w-full">
          <HelpCircle size={20} />
          <span className="text-sm">المساعدة</span>
        </button>
        <button
          onClick={() => logout()}
          className="flex items-center gap-3 text-slate-500 px-4 py-3 hover:bg-slate-100 rounded-xl text-start w-full"
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
      <aside className="hidden md:flex flex-col h-screen w-64 bg-slate-50 sticky top-0 p-4 gap-2 rounded-l-3xl shrink-0 z-40">
        {content}
      </aside>

      {/* Mobile toggle */}
      <button
        className="md:hidden fixed top-4 right-4 z-50 p-2 bg-white rounded-xl shadow-md text-slate-600"
        onClick={() => setMobileOpen(true)}
      >
        <Menu size={22} />
      </button>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-72 h-full bg-white p-4 flex flex-col shadow-2xl">
            <button
              className="absolute top-4 left-4 p-2 text-slate-500 hover:bg-slate-100 rounded-xl"
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
