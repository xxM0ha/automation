import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, CartesianGrid,
} from 'recharts';
import { TrendingUp, TrendingDown, Calendar, Download, ChevronDown, Store, Check, Activity, Clock, Link2Off } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PlatformBadge } from '../components/ui/PlatformBadge';
import { Sidebar } from '../components/layout/Sidebar';
import { TopNav } from '../components/layout/TopNav';
import { cn } from '../lib/utils';
import { reports as reportsApi, getActiveBranch, type ReportSummary, type VelocityPoint, type PlatformStat, type TopItem, type DailySummaryPoint, type AutomationHealth, type Fulfillment, type HeatmapCell } from '../lib/api';
import { useUser } from '../lib/authStore';
import type { Page } from '../types';

type Period = 'today' | '7' | '30' | '90';

interface ReportsPageProps {
  setPage: (p: Page) => void;
}

const periodLabels: Record<Period, string> = {
  'today': 'اليوم',
  '7':     'آخر 7 أيام',
  '30':    'آخر 30 يوم',
  '90':    'آخر 90 يوم',
};

const periodToRange: Record<Period, string> = {
  'today': 'today',
  '7':     '7d',
  '30':    '30d',
  '90':    '90d',
};

interface ExportOpts {
  periodLabel: string;
  branchLabel: string;
  summary: ReportSummary | null;
  platforms: PlatformStat[];
  health: AutomationHealth | null;
  fulfillment: Fulfillment | null;
  daily: DailySummaryPoint[];
  topItems: TopItem[];
  topBy: 'units' | 'revenue';
}

// Build a CSV from exactly the data currently on screen — which is fetched for
// the active filter (period + selected branches) — so the export always matches
// the chosen filter. The filter itself is stamped at the top of the file.
function exportCSV(o: ExportOpts) {
  const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const row = (...cells: (string | number)[]) => cells.map(esc).join(',');
  const rows: string[] = [];

  rows.push(row('تقرير أوردو'));
  rows.push(row('الفترة', o.periodLabel));
  rows.push(row('الفروع', o.branchLabel));
  rows.push('');

  if (o.summary) {
    rows.push(row('المؤشرات'));
    rows.push(row('إجمالي الإيرادات', 'إجمالي الطلبات', 'الطلبات المقبولة', 'متوسط قيمة الطلب'));
    rows.push(row(o.summary.totalRevenue.toFixed(0), o.summary.totalOrders, o.summary.completedOrders, o.summary.avgOrderValue.toFixed(0)));
    rows.push('');
  }

  if (o.platforms.length) {
    rows.push(row('حسب المنصة'));
    rows.push(row('المنصة', 'الطلبات', 'الإيراد (د.ع)', 'متوسط الطلب (د.ع)'));
    o.platforms.forEach((p) => rows.push(row(p.name, p.value, p.revenue.toFixed(0), p.avgOrderValue.toFixed(0))));
    rows.push('');
  }

  if (o.health) {
    rows.push(row('صحة الأتمتة'));
    rows.push(row('الواردة', 'دُفعت بنجاح', 'فشل الدفع', 'مرفوضة', 'نسبة النجاح %'));
    rows.push(row(o.health.incoming, o.health.pushedOk, o.health.pushFailed, o.health.rejected, o.health.successRate));
    if (o.health.reasons.length) {
      rows.push(row('أسباب الرفض', 'العدد'));
      o.health.reasons.forEach((r) => rows.push(row(r.reason, r.count)));
    }
    rows.push('');
  }

  if (o.fulfillment) {
    rows.push(row('التوقيت والحالة'));
    rows.push(row('متوسط وقت القبول (دقيقة)', 'متوسط وقت التحضير (دقيقة)', 'نسبة الإلغاء/الرفض %'));
    rows.push(row(o.fulfillment.avgAcceptMinutes ?? '—', o.fulfillment.avgFulfilMinutes ?? '—', o.fulfillment.cancelRate));
    rows.push('');
  }

  rows.push(row('ملخص يومي'));
  rows.push(row('التاريخ', 'الطلبات', 'المقبولة', 'الإيرادات (د.ع)'));
  o.daily.forEach((d) => rows.push(row(d.date, d.orders, d.completed, d.revenue.toFixed(0))));
  rows.push('');

  rows.push(row(`الأكثر مبيعاً (${o.topBy === 'revenue' ? 'بالإيراد' : 'بالكمية'})`));
  rows.push(row('الصنف', 'الوحدات', 'الإيراد (د.ع)'));
  o.topItems.forEach((i) => rows.push(row(i.name, i.units, Math.round(i.revenue))));

  const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `تقرير-${o.periodLabel}-${o.branchLabel}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export const ReportsPage = ({ setPage }: ReportsPageProps) => {
  const user = useUser();
  const branches = user?.branches ?? [];
  const isOwner = !!user?.isOwner && branches.length > 1;

  const [period, setPeriod]         = useState<Period>('30');
  const [periodOpen, setPeriodOpen] = useState(false);
  const [activeChart, setActiveChart] = useState<'area' | 'bar'>('area');

  // Branches included in the reports (owner only). Defaults to the active branch.
  const [branchSel, setBranchSel] = useState<string[]>(() => {
    const a = getActiveBranch();
    return a ? [a] : [];
  });
  const [branchOpen, setBranchOpen] = useState(false);

  const toggleBranch = (slug: string) =>
    setBranchSel((sel) => {
      const next = sel.includes(slug) ? sel.filter((s) => s !== slug) : [...sel, slug];
      return next.length ? next : sel;   // keep at least one branch selected
    });

  const branchLabel =
    branchSel.length >= branches.length ? 'كل الفروع'
    : branchSel.length === 1 ? (branches.find((b) => b.slug === branchSel[0])?.name ?? 'فرع')
    : `${branchSel.length} فروع`;

  // Label of what the report actually covers — the owner's branch selection, or
  // (for non-owners) just their active branch. Used to stamp the CSV export.
  const exportBranchLabel = isOwner
    ? branchLabel
    : (branches.find((b) => b.slug === getActiveBranch())?.name ?? 'الفرع الحالي');

  const [summary, setSummary]           = useState<ReportSummary | null>(null);
  const [velocity, setVelocity]         = useState<VelocityPoint[]>([]);
  const [platformStats, setPlatformStats] = useState<PlatformStat[]>([]);
  const [topItems, setTopItems]         = useState<TopItem[]>([]);
  const [topBy, setTopBy]               = useState<'units' | 'revenue'>('units');
  const [dailySummary, setDailySummary] = useState<DailySummaryPoint[]>([]);
  const [health, setHealth]             = useState<AutomationHealth | null>(null);
  const [fulfillment, setFulfillment]   = useState<Fulfillment | null>(null);
  const [heatmap, setHeatmap]           = useState<HeatmapCell[]>([]);
  const [loading, setLoading]           = useState(true);

  const range = periodToRange[period];

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const b = isOwner && branchSel.length ? branchSel : undefined;
    try {
      const [s, v, p, t, d, h, f, hm] = await Promise.all([
        reportsApi.summary(range, b),
        reportsApi.velocity(range, b),
        reportsApi.platforms(range, b),
        reportsApi.topItems(range, b, topBy),
        reportsApi.dailySummary(range, b),
        reportsApi.automationHealth(range, b),
        reportsApi.fulfillment(range, b),
        reportsApi.peakHeatmap(range, b),
      ]);
      setSummary(s);
      setVelocity(v);
      setPlatformStats(p);
      setTopItems(t);
      setDailySummary(d);
      setHealth(h);
      setFulfillment(f);
      setHeatmap(hm);
    } catch {} finally {
      setLoading(false);
    }
  }, [range, isOwner, branchSel, topBy]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const totalOrders = platformStats.reduce((s, p) => s + p.value, 0);

  // Peak heatmap — Arabic week order (Sat→Fri) and a (day-hour)→count lookup.
  const DAY_ORDER = [5, 6, 0, 1, 2, 3, 4];
  const DAY_LABELS: Record<number, string> = { 5: 'السبت', 6: 'الأحد', 0: 'الإثنين', 1: 'الثلاثاء', 2: 'الأربعاء', 3: 'الخميس', 4: 'الجمعة' };
  const HOURS = Array.from({ length: 24 }, (_, h) => h);
  const hmMap: Record<string, number> = {};
  heatmap.forEach((c) => { hmMap[`${c.day}-${c.hour}`] = c.count; });
  const hmMax = Math.max(1, ...heatmap.map((c) => c.count));

  const STATUS_META: { k: string; label: string; color: string }[] = [
    { k: 'new',       label: 'جديد',        color: '#60a5fa' },
    { k: 'accepted',  label: 'مقبول',       color: '#818cf8' },
    { k: 'preparing', label: 'قيد التحضير', color: '#fb923c' },
    { k: 'ready',     label: 'جاهز',        color: '#2dd4bf' },
    { k: 'delivered', label: 'مكتمل',       color: '#22c55e' },
    { k: 'cancelled', label: 'ملغي',        color: '#f87171' },
    { k: 'rejected',  label: 'مرفوض',       color: '#ef4444' },
  ];

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar currentPage="reports" setPage={setPage} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopNav setPage={setPage} currentPage="reports" />
        <main className="p-6 md:p-8 space-y-6 overflow-y-auto">

          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <span className="text-xs font-bold tracking-[0.2em] text-on-surface uppercase">لوحة المدير التنفيذي</span>
              <h1 className="text-3xl md:text-4xl font-black text-on-surface mt-1">التقارير والرؤى</h1>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Branch filter (owner only) */}
              {isOwner && (
                <div className="relative">
                  <button
                    className="flex items-center gap-2 bg-white border border-mist rounded-xl px-4 py-2.5 text-sm font-semibold text-on-surface-variant hover:border-primary/40 transition-colors"
                    onClick={() => setBranchOpen((o) => !o)}
                  >
                    <Store size={16} />
                    {branchLabel}
                    <ChevronDown size={14} />
                  </button>
                  {branchOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setBranchOpen(false)} />
                      <div className="absolute left-0 top-12 bg-white rounded-xl shadow-2xl border border-mist z-20 w-60 py-1">
                        <div className="flex items-center justify-between px-4 py-2 border-b border-mist">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">الفروع</span>
                          <button
                            className="text-xs font-bold text-forest hover:underline"
                            onClick={() => setBranchSel(branchSel.length >= branches.length ? (getActiveBranch() ? [getActiveBranch()!] : []) : branches.map((b) => b.slug))}
                          >
                            {branchSel.length >= branches.length ? 'الفرع الحالي فقط' : 'تحديد الكل'}
                          </button>
                        </div>
                        {branches.map((b) => {
                          const on = branchSel.includes(b.slug);
                          return (
                            <button
                              key={b.slug}
                              className="w-full flex items-center gap-2.5 text-right px-4 py-2.5 text-sm text-on-surface hover:bg-surface-container-low transition-colors"
                              onClick={() => toggleBranch(b.slug)}
                            >
                              <span className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0',
                                on ? 'bg-lime border-lime' : 'border-mist')}>
                                {on && <Check size={12} className="text-ink" />}
                              </span>
                              {b.name}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
              {/* Period selector */}
              <div className="relative">
                <button
                  className="flex items-center gap-2 bg-white border border-mist rounded-xl px-4 py-2.5 text-sm font-semibold text-on-surface-variant hover:border-primary/40 transition-colors"
                  onClick={() => setPeriodOpen((o) => !o)}
                >
                  <Calendar size={16} />
                  {periodLabels[period]}
                  <ChevronDown size={14} />
                </button>
                {periodOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setPeriodOpen(false)} />
                    <div className="absolute left-0 top-12 bg-white rounded-xl shadow-2xl border border-mist z-20 overflow-hidden w-44 py-1">
                      {(Object.keys(periodLabels) as Period[]).map((p) => (
                        <button
                          key={p}
                          className={cn(
                            'w-full text-right px-4 py-2.5 text-sm transition-colors',
                            period === p ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-on-surface hover:bg-surface-container-low'
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
              <Button size="sm" onClick={() => exportCSV({ periodLabel: periodLabels[period], branchLabel: exportBranchLabel, summary, platforms: platformStats, health, fulfillment, daily: dailySummary, topItems, topBy })}>
                <Download size={15} />
                تصدير CSV
              </Button>
            </div>
          </div>

          {/* KPI top row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'إجمالي الإيرادات',  value: summary ? `${summary.totalRevenue.toLocaleString()} د.ع` : '—', delta: summary?.deltas?.totalRevenue },
              { label: 'إجمالي الطلبات',    value: summary ? summary.totalOrders.toString() : '—',                 delta: summary?.deltas?.totalOrders },
              { label: 'الطلبات المقبولة',  value: summary ? summary.completedOrders.toString() : '—',             delta: summary?.deltas?.completedOrders },
              { label: 'متوسط قيمة الطلب',  value: summary ? `${summary.avgOrderValue.toFixed(0)} د.ع` : '—',      delta: summary?.deltas?.avgOrderValue },
            ].map((kpi) => {
              const d = kpi.delta;
              const up = (d ?? 0) >= 0;
              return (
                <Card key={kpi.label} hover={false} className="py-5">
                  <p className="text-xs text-on-surface-variant font-medium mb-1">{kpi.label}</p>
                  <p className="text-2xl font-black text-on-surface">{kpi.value}</p>
                  {d == null ? (
                    <div className="flex items-center gap-1 text-xs font-bold mt-1 text-on-surface-variant">
                      <Calendar size={12} />
                      {periodLabels[period]}
                    </div>
                  ) : (
                    <div className={cn('flex items-center gap-1 text-xs font-bold mt-1', up ? 'text-forest' : 'text-red-500')}>
                      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {up ? '+' : ''}{d}%
                      <span className="text-on-surface-variant font-medium">عن الفترة السابقة</span>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-5">

            {/* Velocity chart */}
            <Card className="md:col-span-8 p-6 md:p-8" hover={false}>
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-6">
                <div>
                  <h3 className="text-xl font-bold">
                    {period === 'today' ? 'طلبات اليوم بالساعة' : 'الطلبات اليومية'}
                  </h3>
                  <p className="text-sm text-on-surface-variant">{periodLabels[period]}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex bg-surface-container-low rounded-xl p-1 gap-1">
                    {(['area', 'bar'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => setActiveChart(type)}
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                          activeChart === type ? 'bg-white shadow text-on-surface' : 'text-on-surface-variant hover:text-on-surface-variant'
                        )}
                      >
                        {type === 'area' ? 'منطقة' : 'أعمدة'}
                      </button>
                    ))}
                  </div>
                  <div className="text-right">
                    <span className="text-xl font-black text-on-surface">
                      {summary ? summary.totalOrders.toLocaleString() : '—'} طلب
                    </span>
                  </div>
                </div>
              </div>
              <div className="h-56">
                {loading ? (
                  <div className="h-full flex items-center justify-center text-slate-300 text-sm">جارٍ التحميل…</div>
                ) : velocity.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-300 text-sm">لا توجد بيانات</div>
                ) : (
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
                        <YAxis tick={{ fontSize: 11, fontFamily: 'Cairo', fill: '#94a3b8' }} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 30px -5px rgb(0 0 0 / 0.15)', fontFamily: 'Cairo' }}
                          formatter={(v: number) => [`${v} طلب`, 'الطلبات']}
                        />
                        <Area type="monotone" dataKey="orders" stroke="#0060ac" fillOpacity={1} fill="url(#colorRev)" strokeWidth={2.5} dot={{ fill: '#0060ac', r: 3 }} />
                      </AreaChart>
                    ) : (
                      <BarChart data={velocity}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="time" tick={{ fontSize: 11, fontFamily: 'Cairo', fill: '#94a3b8' }} />
                        <YAxis tick={{ fontSize: 11, fontFamily: 'Cairo', fill: '#94a3b8' }} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 30px -5px rgb(0 0 0 / 0.15)', fontFamily: 'Cairo' }}
                          formatter={(v: number) => [`${v} طلب`, 'الطلبات']}
                        />
                        <Bar dataKey="orders" fill="#0060ac" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                )}
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
                        data={platformStats.length ? platformStats : [{ value: 1, color: '#e2e8f0', name: '—', slug: '', revenue: 0 }]}
                        cx="50%" cy="50%"
                        innerRadius={52} outerRadius={72}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {(platformStats.length ? platformStats : [{ color: '#e2e8f0' }]).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 30px -5px rgb(0 0 0 / 0.15)', fontFamily: 'Cairo' }}
                        formatter={(v: number, _name: string, props: { payload?: { name?: string } }) => [
                          `${v} طلب`, props.payload?.name ?? ''
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-2xl font-black">{totalOrders > 999 ? `${(totalOrders / 1000).toFixed(1)}k` : totalOrders}</span>
                    <span className="text-[10px] font-bold text-on-surface-variant">طلب</span>
                  </div>
                </div>
                <div className="w-full mt-6 space-y-2.5">
                  {platformStats.map((source) => {
                    const pct = Math.round((source.value / (totalOrders || 1)) * 100);
                    return (
                      <div key={source.slug} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <PlatformBadge platformId={source.slug} variant="icon" size="sm" />
                          <div className="flex flex-col">
                            <span className="text-sm font-medium leading-tight">{source.name}</span>
                            <span className="text-[10px] text-on-surface-variant">متوسط {Math.round(source.avgOrderValue).toLocaleString()} د.ع</span>
                          </div>
                        </div>
                        <span className="text-sm font-bold">{pct}%</span>
                      </div>
                    );
                  })}
                  {platformStats.length === 0 && (
                    <p className="text-sm text-on-surface-variant text-center">لا توجد بيانات</p>
                  )}
                </div>
              </div>
            </Card>

            {/* Top selling */}
            <Card className="md:col-span-5 p-6 md:p-8" hover={false}>
              <div className="flex justify-between items-center mb-5">
                <h3 className="text-xl font-bold">الأكثر مبيعاً</h3>
                <div className="flex bg-surface-container-low rounded-xl p-1 gap-1">
                  {([['units', 'بالكمية'], ['revenue', 'بالإيراد']] as const).map(([k, lbl]) => (
                    <button
                      key={k}
                      onClick={() => setTopBy(k)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                        topBy === k ? 'bg-white shadow text-on-surface' : 'text-on-surface-variant hover:text-on-surface',
                      )}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-5">
                {topItems.length === 0 && (
                  <p className="text-sm text-on-surface-variant text-center py-6">لا توجد بيانات</p>
                )}
                {topItems.map((item, i) => (
                  <div key={item.name} className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 bg-surface-container-low rounded-lg flex items-center justify-center text-[10px] font-black text-on-surface-variant">{i + 1}</span>
                        <span className="font-semibold">{item.name}</span>
                      </div>
                      <span className="font-bold text-on-surface">
                        {topBy === 'revenue' ? `${Math.round(item.revenue).toLocaleString()} د.ع` : `${item.units} وحدة`}
                      </span>
                    </div>
                    <div className="w-full bg-surface-container-low h-2 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-700"
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
                <button
                  onClick={() => exportCSV({ periodLabel: periodLabels[period], branchLabel: exportBranchLabel, summary, platforms: platformStats, health, fulfillment, daily: dailySummary, topItems, topBy })}
                  disabled={dailySummary.length === 0}
                  className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low rounded-lg transition-colors disabled:opacity-30"
                  title="تصدير CSV"
                >
                  <Download size={18} />
                </button>
              </div>
              <div className="overflow-x-auto flex-1 px-6 md:px-8 pb-6">
                <table className="w-full text-right border-separate border-spacing-y-2 min-w-[420px]">
                  <thead>
                    <tr className="text-[10px] uppercase font-bold text-on-surface-variant tracking-widest">
                      <th className="pb-3 font-bold">التاريخ</th>
                      <th className="pb-3 font-bold">الطلبات</th>
                      <th className="pb-3 font-bold">المكتملة</th>
                      <th className="pb-3 font-bold">الإيرادات</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {dailySummary.slice(0, 10).map((row) => (
                      <tr key={row.date} className="hover:bg-surface-container-low/80 transition-colors">
                        <td className="py-3 font-semibold text-on-surface">{row.date}</td>
                        <td className="py-3 text-on-surface-variant">{row.orders}</td>
                        <td className="py-3 text-on-surface-variant">{row.completed}</td>
                        <td className="py-3 font-bold text-on-surface">{row.revenue.toLocaleString()} د.ع</td>
                      </tr>
                    ))}
                    {dailySummary.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-on-surface-variant text-sm">لا توجد بيانات</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

          </div>

          {/* ── Automation health ─────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
            <Card className="md:col-span-7 p-6 md:p-8" hover={false}>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <Activity size={20} className="text-primary" />
                  <h3 className="text-xl font-bold">صحة الأتمتة</h3>
                </div>
                <span className="text-xs font-semibold text-on-surface-variant">{periodLabels[period]}</span>
              </div>
              {health ? (
                <>
                  <div className="flex items-end gap-2 mb-1">
                    <span className={cn('text-4xl font-black', health.successRate >= 70 ? 'text-forest' : health.successRate >= 40 ? 'text-orange-500' : 'text-red-500')}>
                      {health.successRate}%
                    </span>
                    <span className="text-sm text-on-surface-variant mb-1.5">دُفعت للنظام بنجاح</span>
                  </div>
                  <p className="text-xs text-on-surface-variant mb-4">
                    من إجمالي {health.incoming.toLocaleString()} طلب وارد
                  </p>
                  {/* Stacked funnel bar */}
                  <div className="flex h-3 rounded-full overflow-hidden mb-3">
                    {[
                      { v: health.pushedOk,   c: '#22c55e' },
                      { v: health.pushFailed, c: '#f59e0b' },
                      { v: health.rejected,   c: '#ef4444' },
                    ].map((seg, i) => seg.v > 0 && (
                      <div key={i} style={{ width: `${(seg.v / Math.max(1, health.incoming)) * 100}%`, backgroundColor: seg.c }} />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs mb-5">
                    {[
                      { label: 'دُفعت بنجاح', v: health.pushedOk,   c: '#22c55e' },
                      { label: 'فشل الدفع',   v: health.pushFailed, c: '#f59e0b' },
                      { label: 'مرفوضة',      v: health.rejected,   c: '#ef4444' },
                    ].map((l) => (
                      <div key={l.label} className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: l.c }} />
                        <span className="font-semibold text-on-surface">{l.v.toLocaleString()}</span>
                        <span className="text-on-surface-variant">{l.label}</span>
                      </div>
                    ))}
                  </div>
                  {health.reasons.length > 0 && (
                    <div className="space-y-2 border-t border-mist pt-4">
                      <p className="text-xs font-bold text-on-surface-variant">أسباب الرفض</p>
                      {health.reasons.map((r) => (
                        <div key={r.reason} className="flex items-center justify-between text-sm">
                          <span className="text-on-surface">{r.reason}</span>
                          <span className="font-bold text-on-surface">{r.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-on-surface-variant text-center py-8">لا توجد بيانات</p>
              )}
            </Card>

            {/* Top unmatched items */}
            <Card className="md:col-span-5 p-6 md:p-8" hover={false}>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <Link2Off size={18} className="text-warning" />
                  <h3 className="text-xl font-bold">أصناف غير مرتبطة</h3>
                </div>
                <button onClick={() => setPage('menu')} className="text-xs font-semibold text-primary hover:underline">
                  إدارة القائمة
                </button>
              </div>
              <div className="space-y-3">
                {(!health || health.topUnmatched.length === 0) && (
                  <p className="text-sm text-on-surface-variant text-center py-6">لا توجد أصناف غير مرتبطة</p>
                )}
                {health?.topUnmatched.map((u, i) => (
                  <div key={u.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 h-5 bg-surface-container-low rounded-lg flex items-center justify-center text-[10px] font-black text-on-surface-variant shrink-0">{i + 1}</span>
                      <span className="font-semibold truncate">{u.name}</span>
                    </div>
                    <span className="px-2 py-0.5 bg-warning/15 text-warning text-xs font-bold rounded-full shrink-0">{u.count}×</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* ── Timing + status funnel ────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
            <Card className="md:col-span-5 p-6 md:p-8" hover={false}>
              <div className="flex items-center gap-2 mb-5">
                <Clock size={20} className="text-primary" />
                <h3 className="text-xl font-bold">التوقيت والحالة</h3>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { label: 'متوسط وقت القبول', v: fulfillment?.avgAcceptMinutes, unit: 'دقيقة' },
                  { label: 'متوسط وقت التحضير', v: fulfillment?.avgFulfilMinutes, unit: 'دقيقة' },
                  { label: 'نسبة الإلغاء/الرفض', v: fulfillment?.cancelRate, unit: '%' },
                ].map((s) => (
                  <div key={s.label} className="bg-surface-container-low rounded-xl p-3">
                    <p className="text-[10px] text-on-surface-variant font-semibold leading-tight mb-1">{s.label}</p>
                    <p className="text-lg font-black text-on-surface">
                      {s.v == null ? '—' : s.unit === '%' ? `${s.v}%` : s.v}
                      {s.v != null && s.unit !== '%' && <span className="text-[10px] font-medium text-on-surface-variant"> {s.unit}</span>}
                    </p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="md:col-span-7 p-6 md:p-8" hover={false}>
              <h3 className="text-xl font-bold mb-5">قمع الحالات</h3>
              <div className="space-y-3">
                {fulfillment && fulfillment.total > 0 ? STATUS_META.map((s) => {
                  const count = fulfillment.statusCounts[s.k] ?? 0;
                  if (count === 0) return null;
                  const pct = Math.round((count / fulfillment.total) * 100);
                  return (
                    <div key={s.k} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-semibold" style={{ color: s.color }}>{s.label}</span>
                        <span className="font-bold text-on-surface">{count} <span className="text-on-surface-variant font-medium text-xs">({pct}%)</span></span>
                      </div>
                      <div className="w-full bg-surface-container-low h-2 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: s.color }} />
                      </div>
                    </div>
                  );
                }) : (
                  <p className="text-sm text-on-surface-variant text-center py-6">لا توجد بيانات</p>
                )}
              </div>
            </Card>
          </div>

          {/* ── Peak-hours heatmap ────────────────────────────────────────── */}
          <Card className="p-6 md:p-8" hover={false}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-xl font-bold">خريطة ساعات الذروة</h3>
              <span className="text-xs font-semibold text-on-surface-variant">{periodLabels[period]} — حسب اليوم والساعة</span>
            </div>
            {heatmap.length === 0 ? (
              <p className="text-sm text-on-surface-variant text-center py-8">لا توجد بيانات</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[680px]">
                  <div className="flex">
                    <div className="w-12 shrink-0" />
                    {HOURS.map((h) => (
                      <div key={h} className="flex-1 text-center text-[9px] text-on-surface-variant">{h % 3 === 0 ? h : ''}</div>
                    ))}
                  </div>
                  {DAY_ORDER.map((day) => (
                    <div key={day} className="flex items-center mb-1">
                      <div className="w-12 shrink-0 text-[11px] font-semibold text-on-surface-variant">{DAY_LABELS[day]}</div>
                      {HOURS.map((h) => {
                        const count = hmMap[`${day}-${h}`] ?? 0;
                        const intensity = count / hmMax;
                        return (
                          <div key={h} className="flex-1 px-0.5">
                            <div
                              className="h-5 rounded"
                              title={`${DAY_LABELS[day]} ${h}:00 — ${count} طلب`}
                              style={{ backgroundColor: count === 0 ? '#f1f5f9' : `rgba(0, 96, 172, ${0.15 + intensity * 0.85})` }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

        </main>
      </div>
    </div>
  );
};
