import { useState, useEffect, useCallback } from 'react';
import { Search, Bell, Settings, X, ShoppingCart, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { notifications as notifApi, type ApiNotification } from '../../lib/api';
import { useUser, logout } from '../../lib/authStore';
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

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return 'منذ لحظة';
  if (diff < 60) return `منذ ${diff} دقيقة`;
  return `منذ ${Math.floor(diff / 60)} ساعة`;
}

export const TopNav = ({ setPage, currentPage }: TopNavProps) => {
  const user = useUser();
  const navLinks = user?.role === 'admin' ? adminLinks : kitchenLinks;
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
    fetchNotifs();
    const interval = setInterval(fetchNotifs, 30_000);
    return () => clearInterval(interval);
  }, [fetchNotifs]);

  const handleMarkRead = async (id: number) => {
    setNotifs((prev) => prev.map((n) => n.id === id ? { ...n, is_read: true } : n));
    setUnreadCount((c) => Math.max(0, c - 1));
    try { await notifApi.markRead(id); } catch {}
  };

  const handleMarkAllRead = async () => {
    setNotifs((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    try { await notifApi.markAllRead(); } catch {}
  };

  const typeIcon = (type: string) => {
    if (type === 'order') return <ShoppingCart size={16} className="text-blue-500" />;
    if (type === 'alert') return <AlertTriangle size={16} className="text-orange-500" />;
    return <CheckCircle2 size={16} className="text-green-500" />;
  };

  return (
    <header className="w-full sticky top-0 z-50 glass-nav flex justify-between items-center px-6 md:px-8 h-18 py-3 shadow-sm border-b border-slate-100">
      {/* Brand */}
      <span
        onClick={() => setPage('landing')}
        className="text-xl md:text-2xl font-black text-gradient cursor-pointer select-none"
      >
        برايم أوتوميشن
      </span>

      {/* Center nav (desktop) */}
      <nav className="hidden lg:flex gap-1">
        {navLinks.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setPage(id)}
            className={cn(
              'px-4 py-2 rounded-xl text-sm font-semibold transition-all',
              currentPage === id
                ? 'bg-blue-50 text-blue-600'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
            )}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Right controls */}
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
            className="relative p-2 text-slate-600 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-all"
            onClick={() => { setNotifOpen((o) => !o); setSettingsOpen(false); }}
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
              <div className="absolute left-0 top-12 w-80 bg-white rounded-2xl shadow-2xl border border-slate-100 z-50 overflow-hidden">
                <div className="flex justify-between items-center px-5 py-4 border-b border-slate-50">
                  <span className="font-bold text-slate-900">الإشعارات</span>
                  {unreadCount > 0 && (
                    <button className="text-xs text-primary font-semibold hover:underline" onClick={handleMarkAllRead}>
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
                      className={cn('flex items-start gap-3 px-5 py-4 transition-colors cursor-pointer', !n.is_read && 'bg-blue-50/50')}
                      onClick={() => handleMarkRead(n.id)}
                    >
                      <div className="mt-0.5 shrink-0">{typeIcon(n.type)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{n.title}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{n.body}</p>
                        <p className="text-[10px] text-slate-400 mt-1">{relativeTime(n.created_at)}</p>
                      </div>
                      {!n.is_read && <div className="w-2 h-2 bg-blue-500 rounded-full shrink-0 mt-2" />}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Settings */}
        <div className="relative">
          <button
            className={cn(
              'p-2 text-slate-600 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-all',
              settingsOpen && 'bg-blue-50 text-blue-500'
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
          <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white font-bold text-sm select-none">
            {user?.name?.[0] ?? '؟'}
          </div>
        </button>
      </div>
    </header>
  );
};
