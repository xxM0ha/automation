import { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import {
  RefreshCw, PauseCircle, PlayCircle,
  Rocket, Flame, Users, TrendingUp, LayoutGrid,
  ChefHat, Clock, CheckCircle2, Bell, Utensils,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PlatformBadge } from '../components/ui/PlatformBadge';
import { Sidebar } from '../components/layout/Sidebar';
import { TopNav } from '../components/layout/TopNav';
import { cn } from '../lib/utils';
import { orders as ordersApi, reports as reportsApi, platforms as platformsApi, type ApiOrder, type ApiOrderStats, type VelocityPoint, type PlatformStat } from '../lib/api';
import { PLATFORMS } from '../data/platforms';
import type { Page, Role } from '../types';

interface DashboardPageProps {
  setPage: (p: Page) => void;
  role: Role;
  onLogout: () => void;
}

// Logos scattered in the left portion — right side reserved for text/button
const LOGO_POSITIONS = [
  { top: '12%',  left: '24%', rotate: '-8deg',  scale: 1    },
  { top: '52%',  left: '32%', rotate: '6deg',   scale: 0.85 },
  { top: '10%',  left: '42%', rotate: '12deg',  scale: 0.9  },
  { top: '55%',  left: '50%', rotate: '-5deg',  scale: 1    },
  { top: '8%',   left: '60%', rotate: '3deg',   scale: 0.8  },
  { top: '48%',  left: '68%', rotate: '-12deg', scale: 0.9  },
  { top: '15%',  left: '76%', rotate: '8deg',   scale: 0.85 },
];

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return 'منذ لحظة';
  if (diff < 60) return `منذ ${diff} دقيقة`;
  return `منذ ${Math.floor(diff / 60)} ساعة`;
}

// ─── Kitchen view ─────────────────────────────────────────────────────────────

const KitchenDashboard = ({ setPage }: { setPage: (p: Page) => void }) => {
  const [paused, setPaused]         = useState(false);
  const [liveOrders, setLiveOrders] = useState<ApiOrder[]>([]);
  const [stats, setStats]           = useState<ApiOrderStats>({ active: 0, preparing: 0, completedToday: 0, avgPrepMinutes: 0 });
  const [connectedCount, setConnectedCount] = useState<number>(0);

  const fetchData = useCallback(async () => {
    try {
      const [live, s, plList] = await Promise.all([ordersApi.live(), ordersApi.stats(), platformsApi.list()]);
      setLiveOrders(live);
      setStats(s);
      setConnectedCount(plList.filter(p => p.isConnected).length);
    } catch {}
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const activeOrders = liveOrders.filter((o) => ['new', 'accepted', 'preparing'].includes(o.status));
  const newOrders    = liveOrders.filter((o) => o.status === 'new');
  const preparing    = liveOrders.filter((o) => o.status === 'preparing');
  const doneToday    = stats.completedToday;

  const statusColor: Record<string, string> = {
    'جديد':          'bg-blue-500',
    'مقبول':         'bg-indigo-500',
    'قيد التحضير':   'bg-orange-500',
    'مكتمل':         'bg-green-500',
  };

  const statusBadge: Record<string, string> = {
    'جديد':          'bg-blue-50 text-blue-600',
    'مقبول':         'bg-indigo-50 text-indigo-600',
    'قيد التحضير':   'bg-orange-50 text-orange-600',
    'مكتمل':         'bg-green-50 text-green-600',
  };

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar currentPage="dashboard" setPage={setPage} role="kitchen" />
      <div className="flex-1 flex flex-col min-w-0">
        <TopNav setPage={setPage} currentPage="dashboard" />
        <main className="p-6 md:p-8 space-y-6">

          {/* Manage Apps banner */}
          <button
            onClick={() => setPage('apps')}
            className="w-full relative overflow-hidden rounded-2xl bg-gradient-to-l from-slate-900 to-slate-700 px-8 py-6 text-right group hover:from-slate-800 hover:to-slate-600 transition-all duration-300 shadow-lg"
          >
            {PLATFORMS.map((platform, i) => {
              const pos = LOGO_POSITIONS[i];
              return (
                <div
                  key={platform.id}
                  className="absolute pointer-events-none opacity-80 group-hover:opacity-100 transition-opacity duration-300"
                  style={{ top: pos.top, left: pos.left, transform: `rotate(${pos.rotate}) scale(${pos.scale})` }}
                >
                  <div className="w-10 h-10 rounded-xl bg-white shadow-md overflow-hidden flex items-center justify-center p-1">
                    <img src={platform.logo} alt={platform.nameEn} className="w-full h-full object-contain" />
                  </div>
                </div>
              );
            })}
            <div className="relative z-10 flex items-center justify-between">
              <div className="flex items-center gap-3 bg-white/10 backdrop-blur-sm px-5 py-2.5 rounded-full text-white font-bold text-sm group-hover:bg-white/20 transition-colors">
                <LayoutGrid size={16} />
                إدارة التطبيقات
              </div>
              <div className="text-right">
                <p className="text-white font-black text-xl">{connectedCount} تطبيقات مربوطة</p>
                <p className="text-slate-400 text-xs mt-0.5">اضغط للتحكم في الاتصالات والإعدادات</p>
              </div>
            </div>
          </button>

          {/* Kitchen header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-orange-100 flex items-center justify-center">
                <ChefHat className="text-orange-500" size={24} />
              </div>
              <div>
                <h1 className="text-2xl font-black text-slate-900">لوحة المطبخ</h1>
                <p className="text-sm text-slate-400">مرحباً، الطاقم النشط — اليوم الخميس</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant={paused ? 'primary' : 'danger'}
                onClick={() => setPaused((p) => !p)}
              >
                {paused ? <><PlayCircle size={18} /> استئناف</> : <><PauseCircle size={18} /> إيقاف الطلبات</>}
              </Button>
            </div>
          </div>

          {/* Operational KPIs — no financials */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="border-b-4 border-blue-500 py-5">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">طلبات جديدة</p>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-black text-slate-900">{newOrders.length}</span>
                {newOrders.length > 0 && <Bell size={14} className="text-blue-500 animate-bounce" />}
              </div>
            </Card>
            <Card className="border-b-4 border-orange-400 py-5">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">قيد التحضير</p>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-black text-slate-900">{preparing.length}</span>
                <Utensils size={14} className="text-orange-400" />
              </div>
            </Card>
            <Card className="border-b-4 border-green-500 py-5">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">مكتملة اليوم</p>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-black text-slate-900">{doneToday}</span>
                <CheckCircle2 size={14} className="text-green-500" />
              </div>
            </Card>
            <Card className="border-b-4 border-primary py-5">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">متوسط التحضير</p>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-black text-slate-900">{stats.avgPrepMinutes || '—'}</span>
                <span className="text-sm text-slate-400 font-semibold">دقيقة</span>
              </div>
            </Card>
          </div>

          {/* Active orders queue */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-800">قائمة الانتظار النشطة</h2>
                <div className="flex items-center gap-1.5 px-3 py-1 bg-red-50 text-red-600 rounded-full text-xs font-bold animate-pulse">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                  مباشر
                </div>
              </div>
              {activeOrders.length === 0 ? (
                <Card className="py-16 text-center" hover={false}>
                  <CheckCircle2 size={40} className="mx-auto mb-3 text-green-400 opacity-50" />
                  <p className="text-slate-400 text-sm">لا توجد طلبات نشطة حالياً</p>
                </Card>
              ) : activeOrders.map((order) => (
                <Card key={order.id} className="p-0 overflow-hidden" hover={false}>
                  <div className={cn('h-1', order.status === 'new' ? 'bg-blue-500' : order.status === 'accepted' ? 'bg-indigo-500' : 'bg-orange-500')} />
                  <div className="p-4 flex items-center gap-4">
                    <PlatformBadge platformId={order.platformId} variant="icon" size="md" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 text-sm">#{order.externalId || order.id}</span>
                        <span className="text-slate-400 text-xs">—</span>
                        <span className="text-slate-700 text-sm font-medium">{order.customerName}</span>
                        <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold',
                          order.status === 'new' ? 'bg-blue-50 text-blue-600' :
                          order.status === 'accepted' ? 'bg-indigo-50 text-indigo-600' : 'bg-orange-50 text-orange-600'
                        )}>
                          {order.statusDisplay}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 truncate">{order.items}</p>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-400 shrink-0">
                      <Clock size={13} />
                      <span className="text-xs font-semibold">{relativeTime(order.createdAt)}</span>
                    </div>
                  </div>
                </Card>
              ))}
              <button
                className="w-full text-xs font-bold text-primary hover:underline text-center pt-1"
                onClick={() => setPage('orders')}
              >
                عرض كل الطلبات ←
              </button>
            </div>

            {/* Live activity feed */}
            <Card className="flex flex-col">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-lg font-bold text-slate-900">النشاط الفوري</h2>
                <span className="flex h-2.5 w-2.5 rounded-full bg-orange-500 animate-pulse" />
              </div>
              <div className="space-y-4 flex-1 overflow-y-auto">
                {liveOrders.slice(0, 8).map((order) => (
                  <div key={order.id} className="flex gap-3 items-start">
                    <PlatformBadge platformId={order.platformId} variant="icon" size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate">
                        #{order.externalId || order.id} — {order.customerName}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{relativeTime(order.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Peak time warning */}
          <Card className="flex items-center gap-5 py-5" hover={false}>
            <div className="w-12 h-12 bg-orange-100 rounded-2xl flex items-center justify-center shrink-0">
              <Flame className="text-orange-500" size={24} />
            </div>
            <div className="flex-1">
              <p className="font-bold text-slate-900">ذروة الطلبات المتوقعة الساعة 18:45</p>
              <p className="text-xs text-slate-400 mt-0.5">استعد لحمل 4.2x — يُنصح بتجهيز محطات إضافية قبل 30 دقيقة</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-2xl font-black text-orange-500">18:45</p>
              <p className="text-[10px] text-slate-400">بعد ~2 ساعة</p>
            </div>
          </Card>

        </main>
      </div>
    </div>
  );
};

// ─── Admin view ───────────────────────────────────────────────────────────────

const AdminDashboard = ({ setPage }: { setPage: (p: Page) => void }) => {
  const [available, setAvailable] = useState(true);
  const [paused, setPaused]       = useState(false);
  const [activeTab, setActiveTab] = useState<'today' | 'yesterday'>('today');
  const [stats, setStats]           = useState<ApiOrderStats>({ active: 0, preparing: 0, completedToday: 0, avgPrepMinutes: 0 });
  const [velocity, setVelocity]     = useState<VelocityPoint[]>([]);
  const [platformStats, setPlatformStats] = useState<PlatformStat[]>([]);
  const [liveOrders, setLiveOrders] = useState<ApiOrder[]>([]);
  const [connectedCount, setConnectedCount] = useState<number>(0);

  const fetchAll = useCallback(async () => {
    try {
      const [s, v, pl, live, plList] = await Promise.all([
        ordersApi.stats(),
        reportsApi.velocity(),
        reportsApi.platforms(),
        ordersApi.live(),
        platformsApi.list(),
      ]);
      setStats(s);
      setVelocity(v);
      setPlatformStats(pl);
      setLiveOrders(live);
      setConnectedCount(plList.filter(p => p.isConnected).length);
    } catch {}
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 10_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar currentPage="dashboard" setPage={setPage} role="admin" />
      <div className="flex-1 flex flex-col min-w-0">
        <TopNav setPage={setPage} currentPage="dashboard" />
        <main className="p-6 md:p-8 space-y-6 md:space-y-8">

          {/* Manage Apps banner */}
          <button
            onClick={() => setPage('apps')}
            className="w-full relative overflow-hidden rounded-2xl bg-gradient-to-l from-slate-900 to-slate-700 px-8 py-6 text-right group hover:from-slate-800 hover:to-slate-600 transition-all duration-300 shadow-lg"
          >
            {PLATFORMS.map((platform, i) => {
              const pos = LOGO_POSITIONS[i];
              return (
                <div
                  key={platform.id}
                  className="absolute pointer-events-none opacity-80 group-hover:opacity-100 transition-opacity duration-300"
                  style={{ top: pos.top, left: pos.left, transform: `rotate(${pos.rotate}) scale(${pos.scale})` }}
                >
                  <div className="w-10 h-10 rounded-xl bg-white shadow-md overflow-hidden flex items-center justify-center p-1">
                    <img src={platform.logo} alt={platform.nameEn} className="w-full h-full object-contain" />
                  </div>
                </div>
              );
            })}
            <div className="relative z-10 flex items-center justify-between">
              <div className="flex items-center gap-3 bg-white/10 backdrop-blur-sm px-5 py-2.5 rounded-full text-white font-bold text-sm group-hover:bg-white/20 transition-colors">
                <LayoutGrid size={16} />
                إدارة التطبيقات
              </div>
              <div className="text-right">
                <p className="text-white font-black text-xl">{connectedCount} تطبيقات مربوطة</p>
                <p className="text-slate-400 text-xs mt-0.5">اضغط للتحكم في الاتصالات والإعدادات</p>
              </div>
            </div>
          </button>

          {/* Admin KPI stats */}
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 md:gap-6">
            <div className="xl:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
              {[
                { label: 'الطلبات اليوم',    value: stats.completedToday + stats.active, badge: null, badgeColor: '', border: 'border-b-4 border-primary' },
                { label: 'الطلبات النشطة',   value: stats.active,  badge: null, badgeColor: '', border: '' },
                { label: 'قيد التحضير',      value: stats.preparing, badge: null, badgeColor: '', border: '' },
                { label: 'متوسط التحضير', value: stats.avgPrepMinutes ? `${stats.avgPrepMinutes} د` : '—', badge: null, badgeColor: '', border: '' },
              ].map((stat) => (
                <Card key={stat.label} className={stat.border}>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{stat.label}</span>
                  <div className="flex items-baseline gap-2 mt-2">
                    <span className="text-2xl md:text-3xl font-black text-on-surface">{stat.value}</span>
                    {stat.badge && <span className={`text-xs font-semibold ${stat.badgeColor}`}>{stat.badge}</span>}
                    {stat.label === 'الطلبات النشطة' && <RefreshCw className="text-primary animate-spin" size={14} style={{ animationDuration: '3s' }} />}
                  </div>
                </Card>
              ))}
            </div>
            <Card className="flex flex-col gap-4 bg-surface-container-highest/30">
              <h3 className="font-bold text-sm text-on-surface-variant uppercase tracking-widest">ضوابط النظام</h3>
              <div className="flex items-center justify-between p-3 bg-white rounded-xl shadow-sm">
                <span className="text-sm font-semibold">التوافر</span>
                <button
                  onClick={() => setAvailable((v) => !v)}
                  className={cn('w-12 h-6 rounded-full relative transition-colors duration-300', available ? 'bg-primary' : 'bg-slate-300')}
                >
                  <div className={cn('absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-300', available ? 'right-1' : 'left-1')} />
                </button>
              </div>
              <div className="flex items-center justify-between p-3 bg-white rounded-xl shadow-sm">
                <span className="text-sm font-semibold">الإشعارات</span>
                <button className="w-12 h-6 rounded-full relative bg-primary transition-colors duration-300">
                  <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full shadow" />
                </button>
              </div>
              <Button variant={paused ? 'primary' : 'danger'} className="w-full" onClick={() => setPaused((p) => !p)}>
                {paused ? <><PlayCircle size={18} /> استئناف الطلبات</> : <><PauseCircle size={18} /> إيقاف الطلبات</>}
              </Button>
            </Card>
          </div>

          {/* Charts & Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
            <div className="lg:col-span-2">
              <Card className="h-full flex flex-col">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">سرعة الطلبات</h2>
                    <p className="text-sm text-slate-500">الحجم الفوري خلال آخر 24 ساعة</p>
                  </div>
                  <div className="flex gap-2">
                    {(['today', 'yesterday'] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={cn('px-3 py-1.5 rounded-full text-xs font-semibold transition-all', activeTab === tab ? 'bg-blue-100 text-blue-600' : 'bg-slate-50 text-slate-400 hover:bg-slate-100')}
                      >
                        {tab === 'today' ? 'اليوم' : 'أمس'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={velocity}>
                      <XAxis dataKey="time" hide />
                      <Tooltip
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontFamily: 'Cairo' }}
                        formatter={(v: number) => [`${v} طلب`, '']}
                      />
                      <Bar dataKey="orders" fill={activeTab === 'today' ? '#0060ac' : '#94a3b8'} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-between mt-3 text-[10px] text-slate-400 font-bold px-2">
                  <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:59</span>
                </div>
              </Card>
            </div>
            <Card className="flex flex-col">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-xl font-bold text-slate-900">النشاط الفوري</h2>
                <span className="flex h-2.5 w-2.5 rounded-full bg-orange-500 animate-pulse" />
              </div>
              <div className="space-y-5 flex-1 overflow-y-auto">
                {liveOrders.slice(0, 6).map((order) => (
                  <div key={order.id} className="flex gap-3 items-start">
                    <PlatformBadge platformId={order.platformId} variant="icon" size="md" />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          #{order.externalId || order.id} — {order.customerName}
                        </p>
                        <span className="text-[10px] text-slate-400 shrink-0 mr-2">{relativeTime(order.createdAt)}</span>
                      </div>
                      <p className="text-xs text-slate-500 mb-1.5">{order.items}</p>
                      <span className={cn(
                        'inline-block px-2 py-0.5 rounded-full text-[10px] font-bold',
                        order.status === 'new'       ? 'bg-blue-100 text-blue-700' :
                        order.status === 'preparing' ? 'bg-orange-100 text-orange-700' :
                        order.status === 'delivered' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'
                      )}>
                        {order.statusDisplay}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <button className="mt-5 text-xs font-bold text-primary hover:underline text-center w-full" onClick={() => setPage('orders')}>
                عرض كل النشاطات ←
              </button>
            </Card>
          </div>

          {/* Bento bottom */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            <div className="lg:col-span-2 bg-primary-gradient p-8 rounded-2xl text-white relative overflow-hidden">
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp size={16} className="opacity-80" />
                  <span className="text-xs font-bold uppercase tracking-widest opacity-80">اقتراح ذكي</span>
                </div>
                <h3 className="text-2xl font-bold mb-2">اقتراح تحسين الأداء</h3>
                <p className="text-blue-100 text-sm mb-6 max-w-sm leading-relaxed">
                  يُظهر تحليل الذكاء الاصطناعي أن إضافة محطة تحضير إضافية بين 18:00 و20:00 يمكن أن تقلل أوقات التوصيل بنسبة 14%.
                </p>
                <button className="px-5 py-2.5 bg-white text-primary rounded-full font-bold text-sm shadow-lg hover:scale-105 transition-transform" onClick={() => setPage('reports')}>
                  تطبيق الخطة
                </button>
              </div>
              <Rocket className="absolute -bottom-4 -left-4 text-white/10" size={120} />
            </div>
            <Card>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
                  <Flame className="text-orange-500" size={20} />
                </div>
                <h4 className="font-bold text-sm">توقع ذروة الطلب</h4>
              </div>
              <p className="text-3xl font-black text-slate-900">18:45</p>
              <p className="text-xs text-slate-400 mt-1">متوقع حمل 4.2x</p>
              <div className="mt-4 w-full bg-orange-100 rounded-full h-1.5">
                <div className="bg-orange-400 h-1.5 rounded-full w-3/4" />
              </div>
            </Card>
            <Card className="flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                    <Users className="text-primary" size={20} />
                  </div>
                  <h4 className="font-bold text-sm">الفريق النشط</h4>
                </div>
                <div className="flex -space-x-2 space-x-reverse">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="w-9 h-9 rounded-full border-2 border-white bg-slate-200 overflow-hidden">
                      <img src={`https://i.pravatar.cc/150?u=${i}`} alt="موظف" />
                    </div>
                  ))}
                  <div className="w-9 h-9 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500">+4</div>
                </div>
              </div>
              <div className="flex items-center justify-between mt-4">
                <p className="text-xs text-slate-400">7 أعضاء متصلون</p>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-green-400 rounded-full" />
                  <span className="text-xs text-green-600 font-semibold">نشط</span>
                </div>
              </div>
            </Card>
          </div>

          {/* Platform breakdown */}
          {platformStats.length > 0 && (
            <div>
              <h3 className="text-lg font-bold text-slate-800 mb-4">توزيع المنصات اليوم</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                {platformStats.map((source) => {
                  const total = platformStats.reduce((s, p) => s + p.value, 0) || 1;
                  const pct   = Math.round((source.value / total) * 100);
                  return (
                    <Card key={source.slug} className="flex flex-col items-center py-5 gap-3" hover={false}>
                      <PlatformBadge platformId={source.slug} variant="icon" size="md" />
                      <div className="text-center">
                        <p className="text-xl font-black text-slate-900">{pct}%</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">{source.name}</p>
                      </div>
                      <div className="w-full px-2">
                        <div className="w-full bg-slate-100 rounded-full h-1.5">
                          <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${pct * 3.5}%`, backgroundColor: source.color }} />
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
};

// ─── Router ───────────────────────────────────────────────────────────────────

export const DashboardPage = ({ setPage, role }: DashboardPageProps) =>
  role === 'admin'
    ? <AdminDashboard setPage={setPage} />
    : <KitchenDashboard setPage={setPage} />;

