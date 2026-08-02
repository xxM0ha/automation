import { useState, useEffect, useCallback } from 'react';
import { Search, Bell, Settings, X, ShoppingCart, AlertTriangle, CheckCircle2, Store, ChevronDown, Menu } from 'lucide-react';
import { cn } from '../../lib/utils';
import { notifications as notifApi, getActiveBranch, type ApiNotification } from '../../lib/api';
import { useUser, logout, switchBranch } from '../../lib/authStore';
import { Wordmark } from '../ui/Wordmark';
import type { Page } from '../../types';

interface TopNavProps {
  setPage: (p: Page) => void;
  currentPage: Page;
}

const adminLinks: { id: Page; label: string }[] = [
  { id: 'orders',  label: 'الطلبات' },
  { id: 'menu',    label: 'القائمة' },
  { id: 'reports', label: 'التقارير' },
];

const kitchenLinks: { id: Page; label: string }[] = [
  { id: 'orders', label: 'الطلبات' },
  { id: 'menu',   label: 'القائمة' },
];

// Dev accounts have no restaurant — show the dev tools, not orders/menu.
const devLinks: { id: Page; label: string }[] = [
  { id: 'automation', label: 'الأتمتة' },
  { id: 'developer',  label: 'المطوّر' },
];

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'منذ لحظة';
  // Normalise space-separated datetime (Django sometimes omits T)
  const ms = new Date(iso.replace(' ', 'T')).getTime();
  if (isNaN(ms)) return 'منذ لحظة';
  const diff = Math.floor((Date.now() - ms) / 60000);
  if (diff < 1) return 'منذ لحظة';
  if (diff < 60) return `منذ ${diff} دقيقة`;
  if (diff < 1440) return `منذ ${Math.floor(diff / 60)} ساعة`;
  return `منذ ${Math.floor(diff / 1440)} يوم`;
}

export const TopNav = ({ setPage, currentPage }: TopNavProps) => {
  const user = useUser();
  const navLinks = user?.isDev ? devLinks : user?.role === 'admin' ? adminLinks : kitchenLinks;
  const [notifOpen, setNotifOpen]     = useState(false);
  const [notifs, setNotifs]           = useState<ApiNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [searchVal, setSearchVal]     = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const fetchNotifs = useCallback(async () => {
    try {
      const data = await notifApi.list();
      setNotifs(data.results);
      setUnreadCount(data.unreadCount);
    } catch {}
  }, []);

  useEffect(() => {
    // Only poll notifications when signed in — TopNav also renders on the
    // public landing page, where an unauthenticated call would just 401.
    if (!user) return;
    fetchNotifs();
    const interval = setInterval(fetchNotifs, 30_000);
    return () => clearInterval(interval);
  }, [fetchNotifs, user]);

  const handleMarkRead = async (id: number) => {
    setNotifs((prev) => prev.map((n) => n.id === id ? { ...n, isRead: true } : n));
    setUnreadCount((c) => Math.max(0, c - 1));
    try { await notifApi.markRead(id); } catch {}
  };

  const handleMarkAllRead = async () => {
    setNotifs((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    try { await notifApi.markAllRead(); } catch {}
  };

  const typeIcon = (type: string) => {
    if (type === 'order') return <ShoppingCart size={16} className="text-on-surface" />;
    if (type === 'alert') return <AlertTriangle size={16} className="text-warning" />;
    return <CheckCircle2 size={16} className="text-forest" />;
  };

  return (
    <header className="w-full sticky top-0 z-50 glass-nav flex justify-between items-center px-6 md:px-8 h-18 py-3 border-b border-mist">
      {/* Brand + branch switcher */}
      <div className="flex items-center gap-2 md:gap-3 min-w-0">
        {/* Mobile menu — opens the sidebar drawer (signed-in only). Lives inside
            the header so it never overlaps the brand. */}
        {user && (
          <button
            className="md:hidden p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low rounded-xl transition-all shrink-0"
            onClick={() => window.dispatchEvent(new CustomEvent('prime:toggle-sidebar'))}
            aria-label="القائمة"
          >
            <Menu size={22} />
          </button>
        )}
        <div
          onClick={() => setPage('landing')}
          className="flex items-center cursor-pointer select-none shrink-0"
        >
          <Wordmark className="text-xl md:text-2xl" />
        </div>
        {user && user.branches && user.branches.length > 1 && (
          <div className="relative">
            <Store size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none" />
            <ChevronDown size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none" />
            <select
              value={getActiveBranch() ?? user.activeBranch ?? ''}
              onChange={(e) => switchBranch(e.target.value)}
              className="appearance-none bg-surface-container-low text-on-surface text-sm font-semibold rounded-xl pr-9 pl-8 py-2 outline-none focus:ring-2 focus:ring-lime/40 cursor-pointer max-w-[8rem] md:max-w-none truncate"
              title="تبديل الفرع"
            >
              {user.branches.map((b) => (
                <option key={b.id} value={b.slug}>{b.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Center nav (desktop) — only when signed in */}
      {user && (
        <nav className="hidden lg:flex gap-1">
          {navLinks.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              className={cn(
                'px-4 py-2 rounded-xl text-sm font-semibold transition-all',
                currentPage === id
                  ? 'bg-primary/15 text-on-surface'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      )}

      {/* Right controls — app toolbar when signed in, auth buttons otherwise */}
      {user ? (
      <div className="flex items-center gap-2 md:gap-3">
        {/* Search */}
        <div className="relative hidden sm:block">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            className="bg-slate-100 border-none rounded-full pr-9 pl-4 py-2 text-sm w-44 md:w-56 focus:ring-2 focus:ring-primary/20 focus:outline-none focus:bg-white transition-all"
            placeholder="بحث..."
            type="text"
            value={searchVal}
            onChange={(e) => setSearchVal(e.target.value)}
          />
          {searchVal && (
            <button
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              onClick={() => setSearchVal('')}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Notifications */}
        <div className="relative">
          <button
            className="relative p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low rounded-xl transition-all"
            onClick={() => { setNotifOpen((o) => !o); setSettingsOpen(false); }}
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-lime text-ink text-[9px] font-bold rounded-full flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
              <div className="absolute left-0 top-12 w-80 max-w-[calc(100vw-1.5rem)] bg-white rounded-2xl shadow-2xl border border-slate-100 z-50 overflow-hidden">
                <div className="flex justify-between items-center px-5 py-4 border-b border-slate-50">
                  <span className="font-bold text-slate-900">الإشعارات</span>
                  {unreadCount > 0 && (
                    <button className="text-xs text-on-surface font-semibold hover:underline" onClick={handleMarkAllRead}>
                      تحديد الكل كمقروء
                    </button>
                  )}
                </div>
                <div className="divide-y divide-slate-50 max-h-72 overflow-y-auto">
                  {notifs.length === 0 && (
                    <p className="text-center text-slate-400 text-sm py-8">لا توجد إشعارات</p>
                  )}
                  {notifs.map((n) => (
                    <div
                      key={n.id}
                      className={cn('flex items-start gap-3 px-5 py-4 transition-colors cursor-pointer', !n.isRead && 'bg-lime/5')}
                      onClick={() => handleMarkRead(n.id)}
                    >
                      <div className="mt-0.5 shrink-0">{typeIcon(n.type)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-on-surface">{n.title}</p>
                        <p className="text-xs text-on-surface-variant mt-0.5">{n.body}</p>
                        <p className="text-[10px] text-slate mt-1">{relativeTime(n.createdAt)}</p>
                      </div>
                      {!n.isRead && <div className="w-2 h-2 bg-lime rounded-full shrink-0 mt-2" />}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => { setNotifOpen(false); setPage('notifications'); }}
                  className="w-full text-center px-5 py-3 text-sm font-bold text-on-surface border-t border-slate-50 hover:bg-surface-container-low transition-colors"
                >
                  عرض كل الإشعارات
                </button>
              </div>
            </>
          )}
        </div>

        {/* Settings */}
        <div className="relative">
          <button
            className={cn(
              'p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low rounded-xl transition-all',
              settingsOpen && 'bg-surface-container-low text-on-surface'
            )}
            onClick={() => { setSettingsOpen((o) => !o); setNotifOpen(false); }}
          >
            <Settings size={20} />
          </button>
          {settingsOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSettingsOpen(false)} />
              <div className="absolute left-0 top-12 w-52 bg-white rounded-2xl shadow-2xl border border-slate-100 z-50 overflow-hidden py-2">
                {[
                  { label: 'إعدادات الحساب', action: () => setPage('apps') },
                  { label: 'التطبيقات المربوطة', action: () => setPage('apps') },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={() => { item.action(); setSettingsOpen(false); }}
                    className="w-full text-right px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    {item.label}
                  </button>
                ))}
                <div className="my-1 border-t border-slate-100" />
                <button
                  onClick={() => { setSettingsOpen(false); logout(); }}
                  className="w-full text-right px-4 py-3 text-sm text-red-500 hover:bg-red-50 transition-colors"
                >
                  تسجيل الخروج
                </button>
              </div>
            </>
          )}
        </div>

        {/* Avatar */}
        <button
          onClick={() => { setSettingsOpen((o) => !o); setNotifOpen(false); }}
          className="flex items-center gap-2 hover:ring-2 hover:ring-primary/30 rounded-full transition-all"
          title={user?.name ?? ''}
        >
          <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-on-primary font-bold text-sm select-none">
            {user?.name?.[0] ?? '؟'}
          </div>
        </button>
      </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage('login')}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
          >
            تسجيل الدخول
          </button>
          <button
            onClick={() => setPage('register')}
            className="px-4 py-2 rounded-xl text-sm font-bold bg-primary text-on-primary hover:brightness-105 transition-all"
          >
            إنشاء حساب
          </button>
        </div>
      )}
    </header>
  );
};
