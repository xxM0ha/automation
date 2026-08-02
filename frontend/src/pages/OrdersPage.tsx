import { useState, useEffect, useCallback } from 'react';
import { Download, RefreshCw, Filter, MoreVertical, ChevronRight, ChevronLeft, X, Search } from 'lucide-react';
import { EditOrderModal } from '../components/orders/EditOrderModal';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PlatformBadge } from '../components/ui/PlatformBadge';
import { Sidebar } from '../components/layout/Sidebar';
import { TopNav } from '../components/layout/TopNav';
import { cn } from '../lib/utils';
import { orders as ordersApi, type ApiOrder } from '../lib/api';
import { PLATFORMS } from '../data/platforms';
import type { Page } from '../types';

const PAGE_SIZE = 15;

const STATUS_COLORS: Record<string, string> = {
  new:       'bg-blue-50 text-blue-600',
  accepted:  'bg-indigo-50 text-indigo-600',
  preparing: 'bg-orange-50 text-orange-600',
  ready:     'bg-teal-50 text-teal-600',
  delivered: 'bg-green-50 text-green-600',
  cancelled: 'bg-red-50 text-red-600',
  rejected:  'bg-red-50 text-red-600',
};


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

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

interface OrdersPageProps {
  setPage: (p: Page) => void;
}

export const OrdersPage = ({ setPage }: OrdersPageProps) => {
  const [data, setData]             = useState<ApiOrder[]>([]);
  const [total, setTotal]           = useState(0);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter]     = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [dateFrom, setDateFrom]             = useState(todayStr());
  const [dateTo, setDateTo]                 = useState(todayStr());
  const [searchQuery, setSearchQuery]       = useState('');

  // Pagination
  const [currentPage, setCurrentPage]   = useState(1);
  const [menuOpenId, setMenuOpenId]     = useState<number | null>(null);
  const [editOrderId, setEditOrderId]   = useState<number | null>(null);
  const [actingId, setActingId]         = useState<number | null>(null);
  const [rejectId, setRejectId]         = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting]       = useState(false);

  const statuses = [
    { value: 'all',       label: 'كل الحالات' },
    { value: 'new',       label: 'جديد' },
    { value: 'accepted',  label: 'مقبول' },
    { value: 'preparing', label: 'قيد التحضير' },
    { value: 'ready',     label: 'جاهز' },
    { value: 'delivered', label: 'مكتمل' },
    { value: 'cancelled', label: 'ملغي' },
    { value: 'rejected',  label: 'مرفوض' },
  ];

  const fetchOrders = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (statusFilter !== 'all')   params.status    = statusFilter;
      if (platformFilter !== 'all') params.platform  = platformFilter;
      if (dateFrom)                 params.date_from = dateFrom;
      if (dateTo)                   params.date_to   = dateTo;
      if (searchQuery.trim())       params.search    = searchQuery.trim();
      const res = await ordersApi.list(params);
      setData(res.results);
      setTotal(res.count);
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter, platformFilter, dateFrom, dateTo, searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, platformFilter, dateFrom, dateTo, searchQuery]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 15_000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  const paginated  = data.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const isFiltered = statusFilter !== 'all' || platformFilter !== 'all'
    || dateFrom !== todayStr() || dateTo !== todayStr() || searchQuery.trim() !== '';

  const clearFilters = () => {
    setStatusFilter('all');
    setPlatformFilter('all');
    setDateFrom(todayStr());
    setDateTo(todayStr());
    setSearchQuery('');
    setCurrentPage(1);
  };

  // Allowed forward transitions per current status (mirrors backend rules).
  // `cancelled` and `rejected` are handled via the reject-with-reason flow below.
  const NEXT_STATUS: Record<string, { value: string; label: string }[]> = {
    new:       [{ value: 'accepted', label: 'قبول الطلب' }],
    accepted:  [{ value: 'preparing', label: 'بدء التحضير' }],
    preparing: [{ value: 'ready', label: 'جاهز للتسليم' }],
    ready:     [{ value: 'delivered', label: 'تم التسليم' }],
  };

  const changeStatus = async (id: number, newStatus: string) => {
    setMenuOpenId(null);
    setActingId(id);
    try {
      await ordersApi.updateStatus(id, newStatus);
      await fetchOrders();
    } catch {
      // surface nothing extra; fetchOrders keeps table consistent
    } finally {
      setActingId(null);
    }
  };

  const submitReject = async () => {
    if (rejectId == null) return;
    setRejecting(true);
    try {
      await ordersApi.reject(rejectId, rejectReason.trim());
      setRejectId(null);
      setRejectReason('');
      await fetchOrders();
    } catch {
      // keep modal open so the user can retry
    } finally {
      setRejecting(false);
    }
  };

  const exportCSV = () => {
    const headers = ['رقم الطلب', 'المنصة', 'العميل', 'الهاتف', 'العنوان', 'الأصناف', 'المجموع', 'الحالة', 'الوقت'];
    const rows = data.map((o) => [
      o.externalId || o.id,
      o.platformId,
      o.customerName,
      o.customerPhone,
      o.address,
      o.items,
      o.total,
      o.statusDisplay,
      new Date(o.createdAt).toLocaleString('ar-IQ'),
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
              <div className="flex items-center gap-3">
                <h2 className="text-3xl font-black text-on-surface">الطلبات</h2>
                <div className="flex items-center gap-1.5 px-3 py-1 bg-red-50 text-red-600 rounded-full text-xs font-bold animate-pulse">
                  <span className="w-1.5 h-1.5 bg-red-600 rounded-full" />
                  مباشر
                </div>
              </div>
              <p className="text-on-surface-variant mt-1 text-sm">إدارة جميع الطلبات الواردة من المنصات المتكاملة.</p>
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" size="sm" onClick={exportCSV}>
                <Download size={15} />
                تصدير CSV
              </Button>
              <Button size="sm" onClick={() => { setRefreshing(true); fetchOrders(); }}>
                <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
                تحديث
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-surface-container-low p-4 rounded-2xl space-y-3">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex items-center gap-2 text-sm font-semibold text-on-surface-variant">
                <Filter size={16} />
                الفلاتر
              </div>

              {/* Status */}
              <select
                className="bg-white border border-mist rounded-xl text-sm px-4 py-2 focus:ring-2 focus:ring-primary/20 outline-none cursor-pointer"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>

              {/* Platform */}
              <select
                className="bg-white border border-mist rounded-xl text-sm px-4 py-2 focus:ring-2 focus:ring-primary/20 outline-none cursor-pointer"
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value)}
              >
                <option value="all">كل المنصات</option>
                {PLATFORMS.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>

              {/* Date from */}
              <div className="flex items-center gap-2 bg-white border border-mist rounded-xl px-3 py-1.5">
                <span className="text-xs text-on-surface-variant font-semibold">من</span>
                <input
                  type="date"
                  className="text-sm outline-none cursor-pointer bg-transparent"
                  value={dateFrom}
                  max={dateTo}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>

              {/* Date to */}
              <div className="flex items-center gap-2 bg-white border border-mist rounded-xl px-3 py-1.5">
                <span className="text-xs text-on-surface-variant font-semibold">إلى</span>
                <input
                  type="date"
                  className="text-sm outline-none cursor-pointer bg-transparent"
                  value={dateTo}
                  min={dateFrom}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>

              {isFiltered && (
                <button
                  className="flex items-center gap-1 text-xs text-red-500 font-semibold hover:underline"
                  onClick={clearFilters}
                >
                  <X size={13} /> مسح الفلاتر
                </button>
              )}

              <div className="mr-auto text-xs text-on-surface-variant font-medium">
                {total} طلب
              </div>
            </div>

            {/* Search */}
            <div className="relative max-w-sm">
              <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <input
                type="text"
                placeholder="ابحث برقم الطلب أو اسم العميل..."
                className="w-full bg-white border border-mist rounded-xl text-sm pr-9 pl-4 py-2 focus:ring-2 focus:ring-primary/20 outline-none"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface-variant"
                  onClick={() => setSearchQuery('')}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <Card className="p-0 overflow-hidden" hover={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse min-w-[640px]">
                <thead>
                  <tr className="bg-surface-container-low border-b border-mist">
                    {['رقم الطلب', 'العميل', 'المنصة', 'الوقت', 'العناصر', 'الحالة', 'الإجمالي', ''].map((h, i) => (
                      <th key={i} className="px-5 py-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant text-right">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center text-on-surface-variant text-sm">
                        <RefreshCw size={20} className="mx-auto animate-spin mb-2" />
                        جاري التحميل...
                      </td>
                    </tr>
                  ) : paginated.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center text-on-surface-variant text-sm">
                        لا توجد طلبات تطابق الفلاتر المحددة
                      </td>
                    </tr>
                  ) : paginated.map((order) => (
                    <tr key={order.id} className="hover:bg-surface-container-low/60 transition-colors">
                      <td className="px-5 py-4">
                        <span className="font-mono font-bold text-on-surface text-sm">#{order.externalId || order.id}</span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-on-surface">{order.customerName}</span>
                          <span className="text-[10px] text-on-surface-variant">{order.customerPhone}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <PlatformBadge platformId={order.platformId} variant="full" size="sm" />
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold">{new Date(order.createdAt).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })}</span>
                          <span className="text-[10px] text-on-surface-variant">{relativeTime(order.createdAt)}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-sm text-on-surface-variant">{order.items}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={cn(
                          'px-3 py-1 text-[10px] font-bold rounded-full',
                          STATUS_COLORS[order.status] ?? 'bg-surface-container-low text-on-surface-variant'
                        )}>
                          {order.statusDisplay}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span className="font-black text-on-surface text-sm">{Number(order.total).toLocaleString()} د.ع</span>
                      </td>
                      <td className="px-5 py-4 text-right relative">
                        <button
                          className="p-1.5 text-on-surface-variant hover:text-on-surface transition-colors rounded-lg hover:bg-surface-container-low disabled:opacity-40"
                          onClick={() => setMenuOpenId(menuOpenId === order.id ? null : order.id)}
                          disabled={actingId === order.id}
                        >
                          {actingId === order.id
                            ? <RefreshCw size={17} className="animate-spin" />
                            : <MoreVertical size={17} />}
                        </button>
                        {menuOpenId === order.id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setMenuOpenId(null)} />
                            <div className="absolute left-2 top-12 bg-white rounded-xl shadow-2xl border border-mist z-20 overflow-hidden w-44 py-1">
                              {(NEXT_STATUS[order.status] ?? []).map((s) => (
                                <button
                                  key={s.value}
                                  className="w-full text-right px-4 py-2.5 text-sm text-on-surface hover:bg-green-50 hover:text-green-600 transition-colors"
                                  onClick={() => changeStatus(order.id, s.value)}
                                >
                                  {s.label}
                                </button>
                              ))}
                              <button
                                className="w-full text-right px-4 py-2.5 text-sm text-on-surface hover:bg-blue-50 hover:text-blue-600 transition-colors"
                                onClick={() => { setEditOrderId(order.id); setMenuOpenId(null); }}
                              >
                                تعديل الطلب
                              </button>
                              {order.status === 'new' && (
                                <button
                                  className="w-full text-right px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors"
                                  onClick={() => { setRejectId(order.id); setRejectReason(''); setMenuOpenId(null); }}
                                >
                                  رفض الطلب
                                </button>
                              )}
                              {(order.status === 'accepted' || order.status === 'preparing') && (
                                <button
                                  className="w-full text-right px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors"
                                  onClick={() => changeStatus(order.id, 'cancelled')}
                                >
                                  إلغاء الطلب
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-5 py-4 flex items-center justify-between border-t border-mist">
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                  className="flex items-center gap-1 text-sm font-semibold text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={16} />
                  السابق
                </button>
                <div className="flex gap-2">
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    const p = totalPages <= 7 ? i + 1
                      : currentPage <= 4 ? i + 1
                      : currentPage >= totalPages - 3 ? totalPages - 6 + i
                      : currentPage - 3 + i;
                    return (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p)}
                        className={cn(
                          'w-8 h-8 flex items-center justify-center rounded-lg text-sm font-bold transition-all',
                          currentPage === p ? 'bg-primary text-on-primary' : 'hover:bg-surface-container-low text-on-surface-variant'
                        )}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
                <button
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
                  className="flex items-center gap-1 text-sm font-semibold text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  التالي
                  <ChevronLeft size={16} />
                </button>
              </div>
            )}
          </Card>

          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <Card className="border-r-4 border-primary">
              <p className="text-xs text-on-surface-variant font-bold mb-2">إجمالي النتائج</p>
              <div className="flex items-baseline gap-2">
                <h3 className="text-2xl font-black text-on-surface">{total}</h3>
              </div>
            </Card>
            <Card className="border-r-4 border-green-500">
              <p className="text-xs text-on-surface-variant font-bold mb-2">مكتملة</p>
              <div className="flex items-baseline gap-2">
                <h3 className="text-2xl font-black text-on-surface">
                  {data.filter((o) => o.status === 'delivered').length}
                </h3>
              </div>
            </Card>
          </div>

        </main>
      </div>
      {editOrderId && (
        <EditOrderModal
          orderId={editOrderId}
          onClose={() => { setEditOrderId(null); fetchOrders(); }}
        />
      )}

      {/* Reject with reason */}
      {rejectId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !rejecting && setRejectId(null)} />
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-5 border-b border-mist">
              <h2 className="text-lg font-black text-on-surface">رفض الطلب</h2>
              <button
                onClick={() => setRejectId(null)}
                disabled={rejecting}
                className="p-2 rounded-xl text-on-surface-variant hover:text-on-surface-variant hover:bg-surface-container-low transition-colors disabled:opacity-40"
              >
                <X size={20} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-3">
              <label className="text-sm font-semibold text-on-surface-variant">سبب الرفض (اختياري)</label>
              <textarea
                className="w-full bg-surface-container-low border border-mist rounded-xl text-sm px-3 py-2.5 outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                rows={3}
                placeholder="اكتب سبب رفض الطلب..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                autoFocus
              />
            </div>
            <div className="px-6 py-4 border-t border-mist flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setRejectId(null)} disabled={rejecting}>
                تراجع
              </Button>
              <Button variant="danger" className="flex-1" onClick={submitReject} disabled={rejecting}>
                {rejecting ? <RefreshCw size={15} className="animate-spin" /> : null}
                تأكيد الرفض
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
