import { useState, useEffect, useCallback } from 'react';
import { ShoppingCart, AlertTriangle, CheckCircle2, RefreshCw, ChevronRight, ChevronLeft, ExternalLink, Link2Off, CheckCircle } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Sidebar } from '../components/layout/Sidebar';
import { TopNav } from '../components/layout/TopNav';
import { PlatformBadge } from '../components/ui/PlatformBadge';
import { EditOrderModal } from '../components/orders/EditOrderModal';
import { cn } from '../lib/utils';
import { notifications as notifApi, menu as menuApi, type ApiNotification, type ApiUnlinkedItem, type ApiMenuItem } from '../lib/api';
import type { Page } from '../types';

const PAGE_SIZE = 20;

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'منذ لحظة';
  const ms = new Date(iso.replace(' ', 'T')).getTime();
  if (isNaN(ms)) return 'منذ لحظة';
  const diff = Math.floor((Date.now() - ms) / 60000);
  if (diff < 1) return 'منذ لحظة';
  if (diff < 60) return `منذ ${diff} دقيقة`;
  if (diff < 1440) return `منذ ${Math.floor(diff / 60)} ساعة`;
  return `منذ ${Math.floor(diff / 1440)} يوم`;
}

function typeIcon(type: string) {
  if (type === 'order') return <ShoppingCart size={18} className="text-on-surface" />;
  if (type === 'alert') return <AlertTriangle size={18} className="text-warning" />;
  return <CheckCircle2 size={18} className="text-forest" />;
}

interface NotificationsPageProps {
  setPage: (p: Page) => void;
}

export const NotificationsPage = ({ setPage }: NotificationsPageProps) => {
  const [notifs, setNotifs]       = useState<ApiNotification[]>([]);
  const [unreadCount, setUnread]  = useState(0);
  const [page, setPageNum]        = useState(1);
  const [numPages, setNumPages]   = useState(1);
  const [count, setCount]         = useState(0);
  const [loading, setLoading]     = useState(true);
  const [openOrderId, setOpenOrderId] = useState<number | null>(null);
  const [unlinked, setUnlinked]   = useState<ApiUnlinkedItem[]>([]);
  const [menuItems, setMenuItems] = useState<ApiMenuItem[]>([]);
  const [pick, setPick]           = useState<Record<string, number>>({});
  const [linking, setLinking]     = useState<string | null>(null);
  const [linkMsg, setLinkMsg]     = useState<string | null>(null);

  const fetchPage = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const data = await notifApi.listPage(p, PAGE_SIZE);
      setNotifs(data.results);
      setUnread(data.unreadCount);
      setNumPages(data.numPages);
      setCount(data.count);
      setPageNum(data.page);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  const fetchUnlinked = useCallback(async () => {
    try {
      const data = await notifApi.unlinkedItems();
      setUnlinked(data.results);
    } catch {}
  }, []);

  const fetchMenuItems = useCallback(async () => {
    try {
      const res = await menuApi.items();
      setMenuItems(Array.isArray(res) ? res : res.results);
    } catch {}
  }, []);

  useEffect(() => { fetchPage(page); }, [page, fetchPage]);
  useEffect(() => { fetchUnlinked(); }, [fetchUnlinked]);
  useEffect(() => { fetchMenuItems(); }, [fetchMenuItems]);

  const rowKey = (u: ApiUnlinkedItem) => `${u.platform}:${u.name}`;

  const linkItem = async (u: ApiUnlinkedItem) => {
    const key = rowKey(u);
    const itemId = pick[key] ?? u.suggestion?.itemId;
    if (!itemId) return;
    setLinking(key);
    setLinkMsg(null);
    try {
      const res = await notifApi.linkItem(u.platform, u.name, itemId);
      const extra = res.reprocessed > 0 ? ` — أُعيد إرسال ${res.reprocessed} طلب` : '';
      setLinkMsg(`تم ربط «${u.name}» بـ «${res.itemName}»${extra}`);
      await fetchUnlinked();
    } catch {
      setLinkMsg('تعذّر الربط، حاول مجدداً.');
    } finally {
      setLinking(null);
    }
  };

  const markRead = async (id: number) => {
    setNotifs((prev) => prev.map((n) => n.id === id ? { ...n, isRead: true } : n));
    setUnread((c) => Math.max(0, c - 1));
    try { await notifApi.markRead(id); } catch {}
  };

  const markAllRead = async () => {
    setNotifs((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnread(0);
    try { await notifApi.markAllRead(); } catch {}
  };

  const openNotif = (n: ApiNotification) => {
    if (!n.isRead) markRead(n.id);
    if (n.relatedOrder) setOpenOrderId(n.relatedOrder);
  };

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar currentPage="orders" setPage={setPage} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopNav setPage={setPage} currentPage="orders" />
        <main className="p-6 md:p-8 space-y-6">

          {/* Header */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h2 className="text-3xl font-black text-on-surface">الإشعارات</h2>
              <p className="text-on-surface-variant mt-1 text-sm">
                {count} إشعار{unreadCount > 0 ? ` • ${unreadCount} غير مقروء` : ''}
              </p>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-sm font-semibold text-on-surface hover:underline"
              >
                تحديد الكل كمقروء
              </button>
            )}
          </div>

          {/* Unlinked items — order items that arrived with no menu mapping */}
          <Card className="p-0 overflow-hidden" hover={false}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-mist">
              <div className="flex items-center gap-2">
                <Link2Off size={18} className="text-warning" />
                <span className="font-bold text-on-surface">أصناف غير مرتبطة بالقائمة</span>
                {unlinked.length > 0 && (
                  <span className="px-2 py-0.5 bg-warning/15 text-warning text-xs font-bold rounded-full">
                    {unlinked.length}
                  </span>
                )}
              </div>
              <button
                onClick={() => setPage('menu')}
                className="text-sm font-semibold text-primary hover:underline"
              >
                إدارة القائمة
              </button>
            </div>
            {unlinked.length === 0 ? (
              <div className="flex items-center justify-center gap-2 px-5 py-8 text-on-surface-variant text-sm">
                <CheckCircle size={16} className="text-forest" />
                كل الأصناف الواردة مرتبطة بالقائمة
              </div>
            ) : (
              <>
                <p className="px-5 pt-3 text-xs text-on-surface-variant">
                  هذه الأصناف وصلت في طلبات لكنها غير مرتبطة بأي صنف في القائمة. اختر الصنف المطابق (أو أكّد الاقتراح الذكي) واضغط «ربط» — سيُحفظ كمرادف وتُعاد الطلبات المعلّقة تلقائياً.
                </p>
                {linkMsg && (
                  <p className="mx-5 mt-2 text-xs font-semibold text-forest bg-forest/10 rounded-lg px-3 py-2">{linkMsg}</p>
                )}
                <div className="divide-y divide-slate-50 mt-2 max-h-96 overflow-y-auto">
                  {unlinked.map((u) => {
                    const key = rowKey(u);
                    const selected = pick[key] ?? u.suggestion?.itemId ?? 0;
                    return (
                      <div key={key} className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <PlatformBadge platformId={u.platform} variant="icon" size="sm" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-on-surface truncate">{u.name}</p>
                            <p className="text-[11px] text-on-surface-variant">
                              {u.platformName} • {relativeTime(u.lastSeen)}{u.count > 1 ? ` • ×${u.count}` : ''}
                            </p>
                          </div>
                          {u.suggestion && (
                            <span
                              className={cn(
                                'text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0',
                                u.suggestion.confidence >= 80 ? 'bg-forest/15 text-forest' : 'bg-warning/15 text-warning',
                              )}
                              title="اقتراح ذكي"
                            >
                              اقتراح {u.suggestion.confidence}%
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-2 pr-9">
                          <select
                            value={selected}
                            onChange={(e) => setPick((p) => ({ ...p, [key]: Number(e.target.value) }))}
                            className="flex-1 min-w-0 bg-white border border-mist rounded-lg text-xs px-2 py-1.5 outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                          >
                            <option value={0}>— اختر الصنف —</option>
                            {menuItems.map((mi) => (
                              <option key={mi.id} value={mi.id}>{mi.name}</option>
                            ))}
                          </select>
                          <button
                            disabled={!selected || linking === key}
                            onClick={() => linkItem(u)}
                            className="flex items-center gap-1 text-xs font-bold text-on-primary bg-primary px-3 py-1.5 rounded-lg shrink-0 disabled:opacity-40 hover:brightness-105 transition-all"
                          >
                            {linking === key ? <RefreshCw size={12} className="animate-spin" /> : <ExternalLink size={12} />}
                            ربط
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </Card>

          {/* List */}
          <Card className="p-0 overflow-hidden" hover={false}>
            <div className="divide-y divide-slate-50">
              {loading ? (
                <div className="px-5 py-16 text-center text-on-surface-variant text-sm">
                  <RefreshCw size={20} className="mx-auto animate-spin mb-2" />
                  جاري التحميل...
                </div>
              ) : notifs.length === 0 ? (
                <p className="text-center text-on-surface-variant text-sm py-16">لا توجد إشعارات</p>
              ) : notifs.map((n) => (
                <div
                  key={n.id}
                  onClick={() => openNotif(n)}
                  className={cn(
                    'flex items-start gap-4 px-5 py-4 transition-colors cursor-pointer hover:bg-surface-container-low/60',
                    !n.isRead && 'bg-lime/5',
                  )}
                >
                  <div className="mt-0.5 shrink-0">{typeIcon(n.type)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-on-surface">{n.title}</p>
                    <p className="text-xs text-on-surface-variant mt-0.5">{n.body}</p>
                    <p className="text-[10px] text-slate mt-1">{relativeTime(n.createdAt)}</p>
                  </div>
                  {n.relatedOrder && (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-primary shrink-0 mt-1">
                      <ExternalLink size={13} />
                      فتح الطلب
                    </span>
                  )}
                  {!n.isRead && <div className="w-2 h-2 bg-lime rounded-full shrink-0 mt-2" />}
                </div>
              ))}
            </div>

            {/* Pagination */}
            {numPages > 1 && (
              <div className="px-5 py-4 flex items-center justify-between border-t border-mist">
                <button
                  disabled={page === 1}
                  onClick={() => setPageNum((p) => p - 1)}
                  className="flex items-center gap-1 text-sm font-semibold text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={16} />
                  السابق
                </button>
                <div className="flex gap-2">
                  {Array.from({ length: Math.min(numPages, 7) }, (_, i) => {
                    const p = numPages <= 7 ? i + 1
                      : page <= 4 ? i + 1
                      : page >= numPages - 3 ? numPages - 6 + i
                      : page - 3 + i;
                    return (
                      <button
                        key={p}
                        onClick={() => setPageNum(p)}
                        className={cn(
                          'w-8 h-8 flex items-center justify-center rounded-lg text-sm font-bold transition-all',
                          page === p ? 'bg-primary text-on-primary' : 'hover:bg-surface-container-low text-on-surface-variant',
                        )}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
                <button
                  disabled={page === numPages}
                  onClick={() => setPageNum((p) => p + 1)}
                  className="flex items-center gap-1 text-sm font-semibold text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  التالي
                  <ChevronLeft size={16} />
                </button>
              </div>
            )}
          </Card>

        </main>
      </div>

      {openOrderId && (
        <EditOrderModal
          orderId={openOrderId}
          onClose={() => setOpenOrderId(null)}
        />
      )}
    </div>
  );
};
