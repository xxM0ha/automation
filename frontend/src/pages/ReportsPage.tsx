import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, CartesianGrid,
} from 'recharts';
import { TrendingUp, Calendar, Download, MoreVertical, Filter, ChevronDown } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PlatformBadge } from '../components/ui/PlatformBadge';
import { Sidebar } from '../components/layout/Sidebar';
import { TopNav } from '../components/layout/TopNav';
import { cn } from '../lib/utils';
import { reports as reportsApi, type ReportSummary, type VelocityPoint, type PlatformStat, type TopItem } from '../lib/api';
import { PLATFORMS } from '../data/platforms';
import type { Page } from '../types';

type Period = '7' | '30' | '90';

interface ReportsPageProps {
  setPage: (p: Page) => void;
}

const periodLabels: Record<Period, string> = {
  '7':  'آخر 7 أيام',
  '30': 'آخر 30 يوم',
  '90': 'آخر 90 يوم',
};

const periodToRange: Record<Period, string> = { '7': '7d', '30': '30d', '90': '30d' };

export const ReportsPage = ({ setPage }: ReportsPageProps) => {
  const [period, setPeriod]         = useState<Period>('30');
  const [periodOpen, setPeriodOpen] = useState(false);
  const [activeChart, setActiveChart] = useState<'area' | 'bar'>('area');

  const [summary, setSummary]       = useState<ReportSummary | null>(null);
  const [velocity, setVelocity]     = useState<VelocityPoint[]>([]);
  const [platformStats, setPlatformStats] = useState<PlatformStat[]>([]);
  const [topItems, setTopItems]     = useState<TopItem[]>([]);

  const range = periodToRange[period];

  const fetchAll = useCallback(async () => {
    try {
      const [s, v, p, t] = await Promise.all([
        reportsApi.summary(range),
        reportsApi.velocity(range),
        reportsApi.platforms(range),
        reportsApi.topItems(range),
      ]);
      setSummary(s);
      setVelocity(v);
      setPlatformStats(p);
      setTopItems(t);
    } catch {}
  }, [range]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar currentPage="reports" setPage={setPage} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopNav setPage={setPage} currentPage="reports" />
        <main className="p-6 md:p-8 space-y-6 overflow-y-auto">

          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <span className="text-xs font-bold tracking-[0.2em] text-primary uppercase">لوحة المدير التنفيذي</span>
              <h1 className="text-3xl md:text-4xl font-black text-on-surface mt-1">التقارير والرؤى</h1>
            </div>
            <div className="flex items-center gap-3">
              {/* Period selector */}
              <div className="relative">
                <button
                  className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:border-primary/40 transition-colors"
                  onClick={() => setPeriodOpen((o) => !o)}
                >
                  <Calendar size={16} />
                  {periodLabels[period]}
                  <ChevronDown size={14} />
                </button>
                {periodOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setPeriodOpen(false)} />
                    <div className="absolute left-0 top-12 bg-white rounded-xl shadow-2xl border border-slate-100 z-20 overflow-hidden w-44 py-1">
                      {(Object.keys(periodLabels) as Period[]).map((p) => (
                        <button
                          key={p}
                          className={cn(
                            'w-full text-right px-4 py-2.5 text-sm transition-colors',
                            period === p ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-slate-700 hover:bg-slate-50'
                          )}
                          onClick={() => { setPeriod(p); setPeriodOpen(false); }}
                        >
                          {periodLabels[p]}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <Button size="sm">
                <Download size={15} />
                تصدير Excel
              </Button>
            </div>
          </div>

          {/* KPI top row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'إجمالي الإيرادات',  value: summary ? `${summary.totalRevenue.toLocaleString()} ر.س` : '—' },
              { label: 'إجمالي الطلبات',    value: summary ? summary.totalOrders.toString() : '—' },
              { label: 'الطلبات المكتملة',  value: summary ? summary.completedOrders.toString() : '—' },
              { label: 'متوسط قيمة الطلب',  value: summary ? `${summary.avgOrderValue.toFixed(1)} ر.س` : '—' },
            ].map((kpi) => (
              <Card key={kpi.label} hover={false} className="py-5">
                <p className="text-xs text-slate-400 font-medium mb-1">{kpi.label}</p>
                <p className="text-2xl font-black text-slate-900">{kpi.value}</p>
                <div className="flex items-center gap-1 text-xs font-bold mt-1 text-green-500">
                  <TrendingUp size={12} />
                  {periodLabels[period]}
                </div>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-5">

            {/* Revenue chart */}
            <Card className="md:col-span-8 p-6 md:p-8" hover={false}>
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-6">
                <div>
                  <h3 className="text-xl font-bold">أداء الإيرادات</h3>
                  <p className="text-sm text-on-surface-variant">تحليل النمو للفترة المالية الحالية</p>
                </div>
                <div className="flex items-center gap-3">
                  {/* Chart type toggle */}
                  <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
                    {(['area', 'bar'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => setActiveChart(type)}
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                          activeChart === type ? 'bg-white shadow text-slate-800' : 'text-slate-400 hover:text-slate-600'
                        )}
                      >
                        {type === 'area' ? 'منطقة' : 'أعمدة'}
                      </button>
                    ))}
                  </div>
                  <div className="text-right">
                    <span className="text-xl font-black text-primary">
                      {summary ? `${summary.totalRevenue.toLocaleString()} ر.س` : '—'}
                    </span>
                    <div className="flex items-center justify-end text-xs font-bold text-green-600 mt-0.5">
                      <TrendingUp size={12} className="ml-1" />
                      {periodLabels[period]}
                    </div>
                  </div>
                </div>
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  {activeChart === 'area' ? (
                    <AreaChart data={velocity}>
                      <defs>
                        <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#0060ac" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#0060ac" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="time" tick={{ fontSize: 11, fontFamily: 'Cairo', fill: '#94a3b8' }} />
                      <YAxis tick={{ fontSize: 11, fontFamily: 'Cairo', fill: '#94a3b8' }} />
                      <Tooltip
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 30px -5px rgb(0 0 0 / 0.15)', fontFamily: 'Cairo' }}
                        formatter={(v: number) => [`${v} طلب`, 'الطلبات']}
                      />
                      <Area type="monotone" dataKey="orders" stroke="#0060ac" fillOpacity={1} fill="url(#colorRev)" strokeWidth={2.5} dot={{ fill: '#0060ac', r: 4 }} />
                    </AreaChart>
                  ) : (
                    <BarChart data={velocity}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="time" tick={{ fontSize: 11, fontFamily: 'Cairo', fill: '#94a3b8' }} />
                      <YAxis tick={{ fontSize: 11, fontFamily: 'Cairo', fill: '#94a3b8' }} />
                      <Tooltip
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 30px -5px rgb(0 0 0 / 0.15)', fontFamily: 'Cairo' }}
                        formatter={(v: number) => [`${v} طلب`, 'الطلبات']}
                      />
                      <Bar dataKey="orders" fill="#0060ac" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Pie chart */}
            <Card className="md:col-span-4 p-6 md:p-8 flex flex-col" hover={false}>
              <h3 className="text-xl font-bold mb-1">مصادر الطلبات</h3>
              <p className="text-sm text-on-surface-variant mb-6">توزيع القنوات</p>
              <div className="flex-1 flex flex-col justify-center items-center">
                <div className="relative w-44 h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={platformStats}
                        cx="50%" cy="50%"
                        innerRadius={52} outerRadius={72}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {platformStats.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 30px -5px rgb(0 0 0 / 0.15)', fontFamily: 'Cairo' }}
                        formatter={(v: number) => [`${v}%`, '']}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-2xl font-black">1.2k</span>
                    <span className="text-[10px] font-bold text-slate-400">طلب</span>
                  </div>
                </div>
                <div className="w-full mt-6 space-y-2.5">
                  {platformStats.map((source) => {
                    const total = platformStats.reduce((s, p) => s + p.value, 0) || 1;
                    const pct = Math.round((source.value / total) * 100);
                    return (
                      <div key={source.slug} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <PlatformBadge platformId={source.slug} variant="icon" size="sm" />
                          <span className="text-sm font-medium">{source.name}</span>
                        </div>
                        <span className="text-sm font-bold">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>

            {/* Top selling */}
            <Card className="md:col-span-5 p-6 md:p-8" hover={false}>
              <div className="flex justify-between items-center mb-5">
                <h3 className="text-xl font-bold">الأكثر مبيعاً</h3>
                <button className="p-1.5 text-on-surface-variant hover:bg-slate-100 rounded-lg transition-colors">
                  <MoreVertical size={18} />
                </button>
              </div>
              <div className="space-y-5">
                {topItems.map((item, i) => (
                  <div key={item.name} className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 bg-slate-100 rounded-lg flex items-center justify-center text-[10px] font-black text-slate-500">{i + 1}</span>
                        <span className="font-semibold">{item.name}</span>
                      </div>
                      <span className="font-bold text-slate-700">{item.units} وحدة</span>
                    </div>
                    <div className="w-full bg-surface-container-high h-2 rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all duration-700', item.progress < 30 ? 'bg-tertiary-container' : 'bg-primary')}
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Daily summary table */}
            <Card className="md:col-span-7 p-0 overflow-hidden flex flex-col" hover={false}>
              <div className="p-6 md:p-8 pb-4 flex justify-between items-center border-b border-slate-50">
                <h3 className="text-xl font-bold">ملخص المبيعات اليومي</h3>
                <button className="p-1.5 text-on-surface-variant hover:bg-slate-100 rounded-lg transition-colors">
                  <Filter size={18} />
                </button>
              </div>
              <div className="overflow-x-auto flex-1 px-6 md:px-8 pb-6">
                <table className="w-full text-right border-separate border-spacing-y-2 min-w-[420px]">
                  <thead>
                    <tr className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">
                      <th className="pb-3 font-bold">التاريخ</th>
                      <th className="pb-3 font-bold">الطلبات</th>
                      <th className="pb-3 font-bold">الإيرادات</th>
                      <th className="pb-3 font-bold">الحالة</th>
                      <th className="pb-3 font-bold text-left">الإجراء</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {topItems.slice(0, 5).map((item, i) => (
                      <tr key={i} className="hover:bg-slate-50/80 transition-colors rounded-xl">
                        <td className="py-3 font-semibold text-slate-800">{item.name}</td>
                        <td className="py-3 text-slate-600">{item.units} وحدة</td>
                        <td className="py-3 font-bold text-slate-800">—</td>
                        <td className="py-3">
                          <span className="px-3 py-1 rounded-full text-[11px] font-bold bg-green-100 text-green-700">
                            مكتمل
                          </span>
                        </td>
                        <td className="py-3 text-left">
                          <button className="text-primary hover:underline font-bold text-xs">التفاصيل</button>
                        </td>
                      </tr>
                    ))}
                    {topItems.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-400 text-sm">لا توجد بيانات</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

          </div>
        </main>
      </div>
    </div>
  );
};
