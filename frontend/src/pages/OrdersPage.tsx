import { useState, useMemo, useEffect, useCallback } from 'react';
import { Download, RefreshCw, Filter, Calendar, MoreVertical, ChevronRight, ChevronLeft, X } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PlatformBadge } from '../components/ui/PlatformBadge';
import { Sidebar } from '../components/layout/Sidebar';
import { TopNav } from '../components/layout/TopNav';
import { cn } from '../lib/utils';
import { orders as ordersApi, type ApiOrder } from '../lib/api';
import { PLATFORMS } from '../data/platforms';
import type { Page } from '../types';

const PAGE_SIZE = 4;

const STATUS_COLORS: Record<string, string> = {
  new:       'bg-blue-50 text-blue-600',
  accepted:  'bg-indigo-50 text-indigo-600',
  preparing: 'bg-orange-50 text-orange-600',
  ready:     'bg-teal-50 text-teal-600',
  delivered: 'bg-green-50 text-green-600',
  cancelled: 'bg-red-50 text-red-600',
  rejected:  'bg-red-50 text-red-600',
};

const STATUS_NEXT: Record<string, string> = {
  new: 'accepted', accepted: 'preparing', preparing: 'delivered',
};

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return 'منذ لحظة';
  if (diff < 60) return `منذ ${diff} دقيقة`;
  return `منذ ${Math.floor(diff / 60)} ساعة`;
}

interface OrdersPageProps {
  setPage: (p: Page) => void;
}

export const OrdersPage = ({ setPage }: OrdersPageProps) => {
  const [data, setData]       = useState<ApiOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter]     = useState('all');
  const [platformFilter, setPlatformFilter] = useState('الكل');
  const [currentPage, setCurrentPage]       = useState(1);
  const [menuOpenId, setMenuOpenId]         = useState<number | null>(null);
  const [refreshing, setRefreshing]         = useState(false);

  const statuses = [
    { value: 'all',       label: 'الكل' },
    { value: 'new',       label: 'جديد' },
    { value: 'accepted',  label: 'مقبول' },
    { value: 'preparing', label: 'قيد التحضير' },
    { value: 'delivered', label: 'مكتمل' },
  ];

  const fetchOrders = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      const res = await ordersApi.list(params);
      setData(res.results);
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 10_000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  const filtered = useMemo(() => data.filter((o) => {
    if (platformFilter !== 'الكل' && o.platform_id !== platformFilter) return false;
    return true;
  }), [data, platformFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const advanceStatus = async (id: number, currentStatus: string) => {
    const next = STATUS_NEXT[currentStatus];
    if (!next) return;
    try {
      const updated = await ordersApi.updateStatus(id, next);
      setData((prev) => prev.map((o) => o.id === id ? updated : o));
    } catch {}
    setMenuOpenId(null);
  };

  const exportCSV = () => {
    const headers = ['رقم الطلب', 'المنصة', 'العميل', 'الهاتف', 'العنوان', 'الأصناف', 'المجموع', 'الحالة', 'الوقت'];
    const rows = filtered.map((o) => [
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
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRefresh =() => {
    setRefreshing(true);
    fetchOrders();
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
                <h2 className="text-3xl font-black text-slate-900">الطلبات الحية</h2>
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
              <Button size="sm" onClick={handleRefresh}>
                <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
                تحديث
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-surface-container-low p-4 rounded-2xl flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
              <Filter size={16} />
              الفلاتر
            </div>
            {/* Status filter */}
            <select
              className="bg-white border border-slate-200 rounded-xl text-sm px-4 py-2 focus:ring-2 focus:ring-primary/20 outline-none cursor-pointer"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
            >
              {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {/* Platform filter */}
            <select
              className="bg-white border border-slate-200 rounded-xl text-sm px-4 py-2 focus:ring-2 focus:ring-primary/20 outline-none cursor-pointer"
              value={platformFilter}
              onChange={(e) => { setPlatformFilter(e.target.value); setCurrentPage(1); }}
            >
              <option value="الكل">كل المنصات</option>
              {PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2">
              <Calendar className="text-slate-400" size={15} />
              <span className="text-sm">اليوم</span>
            </div>
            {(statusFilter !== 'all' || platformFilter !== 'الكل') && (
              <button
                className="flex items-center gap-1 text-xs text-red-500 font-semibold hover:underline"
                onClick={() => { setStatusFilter('all'); setPlatformFilter('الكل'); setCurrentPage(1); }}
              >
                <X size={13} /> مسح الفلاتر
              </button>
            )}
            <div className="mr-auto text-xs text-slate-400 font-medium">
              عرض {filtered.length} من أصل {data.length} طلب
            </div>
          </div>

          {/* Table */}
          <Card className="p-0 overflow-hidden" hover={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse min-w-[640px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    {['رقم الطلب', 'العميل', 'المنصة', 'الوقت', 'العناصر', 'الحالة', 'الإجمالي', ''].map((h, i) => (
                      <th key={i} className="px-5 py-4 text-xs font-bold uppercase tracking-widest text-slate-400 text-right">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center text-slate-400 text-sm">
                        <RefreshCw size={20} className="mx-auto animate-spin mb-2" />
                        جاري التحميل...
                      </td>
                    </tr>
                  ) : paginated.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center text-slate-400 text-sm">
                        لا توجد طلبات تطابق الفلاتر المحددة
                      </td>
                    </tr>
                  ) : paginated.map((order) => (
                    <tr key={order.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-5 py-4">
                        <span className="font-mono font-bold text-slate-900 text-sm">#{order.externalId || order.id}</span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-slate-800">{order.customerName}</span>
                          <span className="text-[10px] text-slate-400">{order.customerPhone}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <PlatformBadge platformId={order.platformId} variant="full" size="sm" />
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold">{new Date(order.createdAt).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })}</span>
                          <span className="text-[10px] text-slate-400">{relativeTime(order.createdAt)}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-sm text-slate-600">{order.items}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={cn(
                          'px-3 py-1 text-[10px] font-bold rounded-full',
                          STATUS_COLORS[order.status] ?? 'bg-slate-100 text-slate-600'
                        )}>
                          {order.statusDisplay}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span className="font-black text-slate-900 text-sm">{Number(order.total).toLocaleString()} ر.س</span>
                      </td>
                      <td className="px-5 py-4 text-right relative">
                        <button
                          className="p-1.5 text-slate-400 hover:text-primary transition-colors rounded-lg hover:bg-slate-100"
                          onClick={() => setMenuOpenId(menuOpenId === order.id ? null : order.id)}
                        >
                          <MoreVertical size={17} />
                        </button>
                        {menuOpenId === order.id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setMenuOpenId(null)} />
                            <div className="absolute left-2 top-12 bg-white rounded-xl shadow-2xl border border-slate-100 z-20 overflow-hidden w-44 py-1">
                              {STATUS_NEXT[order.status] && (
                                <button
                                  className="w-full text-right px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                                  onClick={() => advanceStatus(order.id, order.status)}
                                >
                                  تقدم الحالة
                                </button>
                              )}
                              <button className="w-full text-right px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                                عرض التفاصيل
                              </button>
                              <button className="w-full text-right px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors">
                                إلغاء الطلب
                              </button>
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
            <div className="px-5 py-4 flex items-center justify-between border-t border-slate-100">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => p - 1)}
                className="flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight size={16} />
                السابق
              </button>
              <div className="flex gap-2">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    onClick={() => setCurrentPage(p)}
                    className={cn(
                      'w-8 h-8 flex items-center justify-center rounded-lg text-sm font-bold transition-all',
                      currentPage === p ? 'bg-primary text-white' : 'hover:bg-slate-100 text-slate-600'
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => p + 1)}
                className="flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                التالي
                <ChevronLeft size={16} />
              </button>
            </div>
          </Card>

          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <Card className="border-r-4 border-primary">
              <p className="text-xs text-slate-400 font-bold mb-2">حجم اليوم</p>
              <div className="flex items-baseline gap-2">
                <h3 className="text-2xl font-black text-slate-900">{data.length}</h3>
              </div>
            </Card>
            <Card className="border-r-4 border-tertiary">
              <p className="text-xs text-slate-400 font-bold mb-2">قيد التحضير</p>
              <div className="flex items-baseline gap-2">
                <h3 className="text-2xl font-black text-slate-900">
                  {data.filter((o) => o.status === 'preparing').length}
                </h3>
                <span className="text-xs text-orange-600 font-bold">طلب نشط</span>
              </div>
            </Card>
            <Card className="border-r-4 border-green-500">
              <p className="text-xs text-slate-400 font-bold mb-2">مكتملة</p>
              <div className="flex items-baseline gap-2">
                <h3 className="text-2xl font-black text-slate-900">
                  {data.filter((o) => o.status === 'delivered').length}
                </h3>
              </div>
            </Card>
          </div>

        </main>
      </div>
    </div>
  );
};
