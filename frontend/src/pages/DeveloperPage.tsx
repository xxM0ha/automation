import { useState, useEffect, useCallback, type FC } from 'react';
import { ChevronLeft, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Play, ChevronDown } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Sidebar } from '../components/layout/Sidebar';
import { TopNav } from '../components/layout/TopNav';
import { cn } from '../lib/utils';
import {
  devApi,
  type DevOrder,
  type DevRejection,
  type DevParseResult,
  type DevRestaurant,
} from '../lib/api';
import { PLATFORMS } from '../data/platforms';
import type { Page } from '../types';

interface DeveloperPageProps {
  setPage: (p: Page) => void;
}

type Tab = 'orders' | 'problems' | 'preview' | 'restaurants';

const TABS: { id: Tab; label: string }[] = [
  { id: 'orders', label: 'الطلبات' },
  { id: 'problems', label: 'المشاكل' },
  { id: 'restaurants', label: 'المطاعم' },
  { id: 'preview', label: 'معاينة المحلّل' },
];

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  if (isNaN(d)) return '';
  const m = Math.floor((Date.now() - d) / 60000);
  if (m < 1) return 'الآن';
  if (m < 60) return `منذ ${m} د`;
  if (m < 1440) return `منذ ${Math.floor(m / 60)} س`;
  return `منذ ${Math.floor(m / 1440)} ي`;
}

const STATUS_BADGE: Record<string, string> = {
  accepted: 'bg-green-100 text-green-700',
  new: 'bg-amber-100 text-amber-700',
  rejected: 'bg-red-100 text-red-600',
};

const OrderCard: FC<{ o: DevOrder }> = ({ o }) => {
  const [open, setOpen] = useState(false);
  const pushed = !!o.posExternalId;
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-on-surface">#{o.externalId}</span>
            <span className="text-xs text-on-surface-variant">{o.platform} · {o.restaurant}</span>
            <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', STATUS_BADGE[o.status] ?? 'bg-surface-container-low text-on-surface-variant')}>
              {o.status}
            </span>
            {pushed && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-600">
                Foodics: {o.posExternalId}
              </span>
            )}
            {o.pushMeta && (
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                o.pushMeta.ok ? 'bg-lime/15 text-forest' : 'bg-red-50 text-red-600')}>
                بحث+سعر {o.pushMeta.ok ? '✓' : '✗'}
              </span>
            )}
          </div>
          <p className="text-xs text-on-surface-variant mt-1">{o.customerName} · {o.total} · {timeAgo(o.createdAt)}</p>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="p-1.5 text-on-surface-variant hover:bg-surface-container-low rounded-lg shrink-0">
          <ChevronDown size={16} className={cn('transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {o.items.map((it, i) => (
          <span
            key={i}
            className={cn(
              'text-[11px] px-2 py-1 rounded-lg border',
              it.matched ? 'border-mist text-on-surface-variant' : 'border-red-300 bg-red-50 text-red-600',
            )}
          >
            {it.qty}× {it.name}
          </span>
        ))}
      </div>

      {o.pushMeta && o.pushMeta.picks?.length > 0 && (
        <div className="mt-2 rounded-lg border border-mist bg-surface-container-low px-3 py-2 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">
            اختيار الأصناف بالبحث + السعر
          </p>
          {o.pushMeta.picks.map((p, i) => (
            <div key={i} className="text-[11px] flex items-center gap-1.5 flex-wrap">
              <span className={cn('w-3 text-center font-bold', p.ok ? 'text-forest' : 'text-red-600')}>{p.ok ? '✓' : '✗'}</span>
              <span className="text-on-surface font-medium">{p.qty}× {p.item}</span>
              <ChevronLeft size={11} className="text-on-surface-variant" />
              {p.chosen
                ? <span className="text-on-surface-variant">{p.chosen}{p.chosenPrice != null ? ` (${p.chosenPrice})` : ''}</span>
                : <span className="text-red-600">لم يُعثر عليه</span>}
              {p.orderPrice != null && <span className="text-on-surface-variant">· سعر الصنف {p.orderPrice}</span>}
              {p.byPrice && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-lime/15 text-forest">اختير بالسعر من {p.candidates}</span>
              )}
              {p.chosenPrice != null && p.orderPrice != null && (
                <span className={cn('text-[9px] px-1.5 py-0.5 rounded',
                  p.chosenPrice === p.orderPrice ? 'bg-forest/10 text-forest' : 'bg-amber-100 text-amber-700')}>
                  {p.chosenPrice === p.orderPrice ? 'سعر مطابق' : 'سعر مختلف'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {o.posError ? (
        <div className="mt-2 flex items-start gap-1.5 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span className="flex-1">{o.posError}</span>
        </div>
      ) : null}

      {open && (
        <pre className="mt-3 text-[10px] leading-relaxed text-on-surface-variant bg-surface-container-low rounded-lg p-3 overflow-x-auto whitespace-pre-wrap" dir="ltr">
          {o.rawText || '(لا يوجد نص خام)'}
        </pre>
      )}
    </Card>
  );
}

const RejectionCard: FC<{ r: DevRejection }> = ({ r }) => {
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-4 border-r-4 border-r-red-400">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <XCircle size={14} className="text-red-500" />
            <span className="font-bold text-on-surface">{r.externalId ? `#${r.externalId}` : 'مرفوض'}</span>
            <span className="text-xs text-on-surface-variant">{r.platform} · {r.restaurant}</span>
          </div>
          <p className="text-xs text-red-600 mt-1 font-semibold">{r.reason}</p>
          {r.items?.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {r.items.map((n, i) => (
                <span key={i} className="text-[11px] px-2 py-1 rounded-lg border border-red-300 bg-red-50 text-red-600">{n}</span>
              ))}
            </div>
          )}
          <p className="text-[10px] text-on-surface-variant mt-1">{timeAgo(r.createdAt)}</p>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="p-1.5 text-on-surface-variant hover:bg-surface-container-low rounded-lg shrink-0">
          <ChevronDown size={16} className={cn('transition-transform', open && 'rotate-180')} />
        </button>
      </div>
      {open && (
        <pre className="mt-3 text-[10px] leading-relaxed text-on-surface-variant bg-surface-container-low rounded-lg p-3 overflow-x-auto whitespace-pre-wrap" dir="ltr">
          {r.rawText || '(لا يوجد نص خام)'}
        </pre>
      )}
    </Card>
  );
}

export const DeveloperPage = ({ setPage }: DeveloperPageProps) => {
  const [tab, setTab] = useState<Tab>('orders');

  const [orders, setOrders] = useState<DevOrder[]>([]);
  const [problemOrders, setProblemOrders] = useState<DevOrder[]>([]);
  const [rejections, setRejections] = useState<DevRejection[]>([]);
  const [restaurants, setRestaurants] = useState<DevRestaurant[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (t: Tab) => {
    setLoading(true);
    try {
      if (t === 'orders') {
        setOrders(await devApi.orders({ limit: 100 }));
      } else if (t === 'problems') {
        const [po, rej] = await Promise.all([
          devApi.orders({ problems: true, limit: 100 }),
          devApi.rejections(),
        ]);
        setProblemOrders(po);
        setRejections(rej);
      } else if (t === 'restaurants') {
        setRestaurants(await devApi.restaurants());
      }
    } catch {
      // surfaced as empty state
    } finally {
      setLoading(false);
    }
  }, []);

  const togglePrinting = async (slug: string, current: boolean) => {
    setRestaurants((prev) => prev.map((r) => r.slug === slug ? { ...r, printingEnabled: !current } : r));
    try {
      await devApi.setPrinting(slug, !current);
    } catch {
      setRestaurants((prev) => prev.map((r) => r.slug === slug ? { ...r, printingEnabled: current } : r));
    }
  };

  useEffect(() => { if (tab !== 'preview') load(tab); }, [tab, load]);

  // ── Parse preview state ──
  const [pvPlatform, setPvPlatform] = useState(PLATFORMS[0]?.id ?? 'toters');
  const [pvRestaurant, setPvRestaurant] = useState('');
  const [pvText, setPvText] = useState('');
  const [pvResult, setPvResult] = useState<DevParseResult | null>(null);
  const [pvLoading, setPvLoading] = useState(false);

  // Restaurants for the preview dropdown (needed to resolve each item's Foodics
  // category). Loaded once; default to the first.
  useEffect(() => {
    devApi.restaurants().then((rs) => {
      setRestaurants(rs);
      setPvRestaurant((cur) => cur || rs[0]?.slug || '');
    }).catch(() => {});
  }, []);

  const runPreview = async () => {
    if (!pvText.trim()) return;
    setPvLoading(true);
    setPvResult(null);
    try {
      setPvResult(await devApi.parsePreview({
        platform: pvPlatform,
        rawText: pvText.trim(),
        restaurant: pvRestaurant || undefined,
      }));
    } catch (e) {
      setPvResult({ parsed: false, detail: e instanceof Error ? e.message : 'خطأ' });
    } finally {
      setPvLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar currentPage="developer" setPage={setPage} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopNav setPage={setPage} currentPage="developer" />
        <main className="p-6 md:p-8 space-y-6">
          <div>
            <button
              onClick={() => setPage('dashboard')}
              className="flex items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface font-semibold mb-3 transition-colors"
            >
              <ChevronLeft size={14} /> العودة للوحة التحكم
            </button>
            <h1 className="text-3xl md:text-4xl font-black text-on-surface">المطوّر</h1>
            <p className="text-on-surface-variant mt-2 text-sm max-w-xl">
              تشخيص الطلبات الواردة وكيفية تحليلها وإرسالها إلى Foodics عبر جميع الحسابات.
            </p>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-2 bg-surface-container-low p-1.5 rounded-2xl w-fit">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'px-4 py-2 rounded-xl text-sm font-semibold transition-all',
                  tab === t.id ? 'bg-white text-on-surface shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-high',
                )}
              >
                {t.label}
              </button>
            ))}
            {tab !== 'preview' && (
              <button onClick={() => load(tab)} className="p-2 text-on-surface-variant hover:text-on-surface rounded-lg" title="تحديث">
                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              </button>
            )}
          </div>

          {/* Orders */}
          {tab === 'orders' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {orders.map((o) => <OrderCard key={o.id} o={o} />)}
              {!loading && orders.length === 0 && (
                <p className="text-sm text-on-surface-variant py-10 text-center col-span-full">لا توجد طلبات.</p>
              )}
            </div>
          )}

          {/* Problems */}
          {tab === 'problems' && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-3">طلبات لم تُرسل ({problemOrders.length})</p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {problemOrders.map((o) => <OrderCard key={o.id} o={o} />)}
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-3">مرفوضة عند الاستلام ({rejections.length})</p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {rejections.map((r) => <RejectionCard key={r.id} r={r} />)}
                </div>
              </div>
              {!loading && problemOrders.length === 0 && rejections.length === 0 && (
                <div className="flex items-center gap-2 text-sm text-green-600 py-10 justify-center">
                  <CheckCircle2 size={18} /> لا توجد مشاكل 🎉
                </div>
              )}
            </div>
          )}

          {/* Restaurants — print mode toggle */}
          {tab === 'restaurants' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {restaurants.map((r) => (
                <Card key={r.slug} className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-on-surface">{r.name}</p>
                    <p className="text-xs text-on-surface-variant">
                      {r.slug}{r.foodicsBranch ? ` · فرع: ${r.foodicsBranch}` : ''}
                    </p>
                    <p className="text-[11px] mt-1 font-semibold">
                      {r.printingEnabled
                        ? <span className="text-on-surface">الطباعة المحلية مفعّلة (لا يُرسل إلى Foodics)</span>
                        : <span className="text-on-surface-variant">يُرسل إلى Foodics</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => togglePrinting(r.slug, !!r.printingEnabled)}
                    className={cn(
                      'w-12 h-6 rounded-full relative transition-colors duration-300 shrink-0',
                      r.printingEnabled ? 'bg-primary' : 'bg-slate-300',
                    )}
                    title="تفعيل الطباعة المحلية"
                  >
                    <div className={cn(
                      'absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-300',
                      r.printingEnabled ? 'right-1' : 'left-1',
                    )} />
                  </button>
                </Card>
              ))}
              {!loading && restaurants.length === 0 && (
                <p className="text-sm text-on-surface-variant py-10 text-center col-span-full">لا توجد مطاعم.</p>
              )}
            </div>
          )}

          {/* Parse preview */}
          {tab === 'preview' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-5 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={pvPlatform}
                    onChange={(e) => setPvPlatform(e.target.value)}
                    className="rounded-xl border border-mist px-3 py-2.5 text-sm bg-white outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    {PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <select
                    value={pvRestaurant}
                    onChange={(e) => setPvRestaurant(e.target.value)}
                    className="rounded-xl border border-mist px-3 py-2.5 text-sm bg-white outline-none focus:ring-2 focus:ring-primary/20"
                    title="المطعم (لتحديد تصنيف Foodics)"
                  >
                    {restaurants.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
                  </select>
                </div>
                <textarea
                  value={pvText}
                  onChange={(e) => setPvText(e.target.value)}
                  placeholder="الصق النص الخام للطلب هنا…"
                  dir="ltr"
                  className="w-full h-64 rounded-xl border border-mist px-4 py-3 text-xs font-mono outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                />
                <Button onClick={runPreview} disabled={pvLoading || !pvText.trim()} className="w-full">
                  <Play size={16} /> {pvLoading ? 'جارٍ التحليل…' : 'تشغيل المحلّل'}
                </Button>
              </Card>

              <Card className="p-5">
                {!pvResult ? (
                  <p className="text-sm text-on-surface-variant text-center py-10">النتيجة ستظهر هنا</p>
                ) : !pvResult.parsed ? (
                  <div className="flex items-center gap-2 text-sm text-red-600">
                    <XCircle size={18} /> {pvResult.detail ?? 'فشل التحليل'}
                  </div>
                ) : (
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center gap-2 text-green-600 font-bold">
                      <CheckCircle2 size={18} /> تم التحليل
                    </div>
                    <div className="text-on-surface-variant space-y-1">
                      <div>رقم الطلب: <span className="font-semibold text-on-surface">{pvResult.draft?.externalId || '—'}</span></div>
                      <div>الزبون: <span className="font-semibold text-on-surface">{pvResult.draft?.customerName || '—'}</span></div>
                      <div>المجموع: <span className="font-semibold text-on-surface">{pvResult.draft?.total ?? '—'}</span></div>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-on-surface-variant mb-1.5">الأصناف + تصنيف Foodics</p>
                      {pvResult.itemResults && pvResult.itemResults.length > 0 ? (
                        <div className="space-y-1.5">
                          {pvResult.itemResults.map((it, i) => (
                            <div
                              key={i}
                              className={cn(
                                'rounded-lg border px-3 py-2 text-xs',
                                it.matched ? 'border-mist' : 'border-red-300 bg-red-50',
                              )}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-on-surface font-semibold">{it.qty}× {it.parsedName}</span>
                                {it.matched ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 text-on-surface font-bold text-[10px]">
                                    {it.posCategory}
                                  </span>
                                ) : (
                                  <span className="text-red-600 font-bold text-[10px]">غير مرتبط</span>
                                )}
                              </div>
                              {it.matched && (
                                <div className="text-on-surface-variant mt-0.5">
                                  → {it.menuName}
                                  {it.categorySource === 'default' && ' · (تصنيف افتراضي — لم يُضبط)'}
                                  {it.categorySource === 'item' && ' · (تصنيف الصنف)'}
                                  {it.categorySource === 'per-app' && ' · (تصنيف خاص بالتطبيق)'}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {(pvResult.draft?.items ?? []).map((it, i) => (
                            <span key={i} className="text-[11px] px-2 py-1 rounded-lg border border-mist text-on-surface-variant">
                              {it.qty}× {it.name}{it.notes ? ` (${it.notes})` : ''}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
