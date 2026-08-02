import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, XCircle, Settings, RefreshCw, Plug, AlertTriangle, ChevronLeft } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { PlatformBadge } from '../components/ui/PlatformBadge';
import { Sidebar } from '../components/layout/Sidebar';
import { TopNav } from '../components/layout/TopNav';
import { PLATFORMS } from '../data/platforms';
import { cn } from '../lib/utils';
import { platforms as platformsApi, type ApiPlatform } from '../lib/api';
import type { Page } from '../types';

function relativeTime(iso: string | null): string {
  if (!iso) return 'لم تتم';
  const ms = new Date(iso.replace(' ', 'T')).getTime();
  if (isNaN(ms)) return 'لم تتم';
  const diff = Math.floor((Date.now() - ms) / 60000);
  if (diff < 1) return 'منذ لحظة';
  if (diff < 60) return `منذ ${diff} دقيقة`;
  if (diff < 1440) return `منذ ${Math.floor(diff / 60)} ساعة`;
  return `منذ ${Math.floor(diff / 1440)} يوم`;
}

interface AppsPageProps {
  setPage: (p: Page) => void;
}

export const AppsPage = ({ setPage }: AppsPageProps) => {
  const [connections, setConnections] = useState<ApiPlatform[]>([]);
  const [syncing, setSyncing]         = useState<string | null>(null);
  const [expanded, setExpanded]       = useState<string | null>(null);

  const fetchPlatforms = useCallback(async () => {
    try {
      const data = await platformsApi.list();
      setConnections(data);
    } catch {}
  }, []);

  useEffect(() => { fetchPlatforms(); }, [fetchPlatforms]);

  const toggleConnect = async (slug: string, current: boolean) => {
    setConnections((prev) => prev.map((c) => c.slug === slug ? { ...c, isConnected: !current } : c));
    try {
      const updated = await platformsApi.connect(slug, !current);
      setConnections((prev) => prev.map((c) => c.slug === slug ? updated : c));
    } catch {
      setConnections((prev) => prev.map((c) => c.slug === slug ? { ...c, isConnected: current } : c));
    }
  };

  const toggleSetting = async (slug: string, field: 'autoAccept' | 'menuSync', current: boolean) => {
    setConnections((prev) => prev.map((c) => c.slug === slug ? { ...c, [field]: !current } : c));
    try {
      const updated = await platformsApi.updateSettings(slug, { [field]: !current });
      setConnections((prev) => prev.map((c) => c.slug === slug ? updated : c));
    } catch {
      setConnections((prev) => prev.map((c) => c.slug === slug ? { ...c, [field]: current } : c));
    }
  };

  const handleSync = async (slug: string) => {
    setSyncing(slug);
    try {
      await platformsApi.sync(slug);
      await fetchPlatforms();
    } catch {}
    setSyncing(null);
  };

  const connectedCount    = connections.filter((c) => c.isConnected).length;
  const totalOrdersToday  = connections.reduce((sum, c) => sum + c.ordersToday, 0);

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar currentPage="apps" setPage={setPage} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopNav setPage={setPage} currentPage="apps" />
        <main className="p-6 md:p-8 space-y-8">

          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <button
                onClick={() => setPage('dashboard')}
                className="flex items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface font-semibold mb-3 transition-colors"
              >
                <ChevronLeft size={14} />
                العودة للوحة التحكم
              </button>
              <h1 className="text-3xl md:text-4xl font-black text-on-surface">إدارة التطبيقات</h1>
              <p className="text-on-surface-variant mt-2 text-sm max-w-xl">
                تحكم في اتصالات منصات التوصيل، وفّق قوائمك، واضبط الأتمتة لكل تطبيق.
              </p>
            </div>
            <div className="flex gap-3 items-center">
              <div className="text-center px-5 py-3 bg-green-50 rounded-2xl">
                <p className="text-2xl font-black text-green-600">{connectedCount}</p>
                <p className="text-[11px] text-green-500 font-bold">منصة متصلة</p>
              </div>
              <div className="text-center px-5 py-3 bg-blue-50 rounded-2xl">
                <p className="text-2xl font-black text-blue-600">{totalOrdersToday}</p>
                <p className="text-[11px] text-blue-500 font-bold">طلب اليوم</p>
              </div>
            </div>
          </div>

          {/* Summary bar */}
          <div className="flex flex-wrap gap-3">
            {connections.map((conn) => (
              <div
                key={conn.slug}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-xl border transition-all cursor-pointer',
                  conn.isConnected
                    ? 'bg-white border-green-200 shadow-sm'
                    : 'bg-surface-container-low border-mist opacity-60'
                )}
                onClick={() => setExpanded(expanded === conn.slug ? null : conn.slug)}
              >
                <PlatformBadge platformId={conn.slug} variant="icon" size="sm" />
                <div className={cn('w-2 h-2 rounded-full', conn.isConnected ? 'bg-green-400' : 'bg-slate-300')} />
              </div>
            ))}
          </div>

          {/* App cards grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {connections.map((conn) => {
              const platform  = PLATFORMS.find((p) => p.id === conn.slug);
              const isExpanded = expanded === conn.slug;
              const isSyncing  = syncing === conn.slug;

              return (
                <Card
                  key={conn.slug}
                  className={cn(
                    'flex flex-col gap-0 p-0 overflow-hidden transition-all',
                    !conn.isConnected && 'opacity-70'
                  )}
                  hover={false}
                >
                  {/* Card header */}
                  <div className="p-5 flex items-center gap-4">
                    <PlatformBadge platformId={conn.slug} variant="icon" size="lg" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-on-surface text-base">{conn.nameAr}</h3>
                        <span className={cn(
                          'flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full',
                          conn.isConnected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                        )}>
                          {conn.isConnected ? <><CheckCircle2 size={9} /> متصل</> : <><XCircle size={9} /> غير متصل</>}
                        </span>
                      </div>
                      <p className="text-xs text-on-surface-variant mt-0.5">{platform?.nameEn ?? conn.nameEn}</p>
                    </div>
                    <button
                      className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low rounded-xl transition-colors"
                      onClick={() => setExpanded(isExpanded ? null : conn.slug)}
                    >
                      <Settings size={16} />
                    </button>
                  </div>

                  {/* Stats row */}
                  <div className="px-5 pb-4 flex gap-4 text-center">
                    <div className="flex-1 bg-surface-container-low rounded-xl py-2">
                      <p className="text-lg font-black text-on-surface">{conn.ordersToday}</p>
                      <p className="text-[10px] text-on-surface-variant font-medium">طلب اليوم</p>
                    </div>
                    <div className="flex-1 bg-surface-container-low rounded-xl py-2">
                      <p className="text-[11px] font-semibold text-on-surface-variant mt-1">{relativeTime(conn.lastSyncAt ?? null)}</p>
                      <p className="text-[10px] text-on-surface-variant font-medium">آخر مزامنة</p>
                    </div>
                  </div>

                  {/* Connect toggle */}
                  <div className="px-5 pb-4 flex items-center justify-between">
                    <span className="text-sm font-semibold text-on-surface">
                      {conn.isConnected ? 'الاتصال نشط' : 'غير متصل'}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        disabled={!conn.isConnected}
                        onClick={() => handleSync(conn.slug)}
                        className="p-1.5 text-on-surface-variant hover:text-on-surface disabled:opacity-30 hover:bg-surface-container-low rounded-lg transition-colors"
                        title="مزامنة الآن"
                      >
                        <RefreshCw size={15} className={isSyncing ? 'animate-spin text-on-surface' : ''} />
                      </button>
                      <button
                        onClick={() => toggleConnect(conn.slug, conn.isConnected)}
                        className={cn(
                          'w-12 h-6 rounded-full relative transition-colors duration-300',
                          conn.isConnected ? 'bg-green-500' : 'bg-slate-300'
                        )}
                      >
                        <div className={cn(
                          'absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-300',
                          conn.isConnected ? 'right-1' : 'left-1'
                        )} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded settings */}
                  {isExpanded && (
                    <div className="border-t border-mist px-5 py-4 space-y-3 bg-surface-container-low/60">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">إعدادات متقدمة</p>

                      {/* Auto-accept */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-on-surface">قبول تلقائي</p>
                          <p className="text-[11px] text-on-surface-variant">قبول الطلبات الواردة فوراً</p>
                        </div>
                        <button
                          onClick={() => toggleSetting(conn.slug, 'autoAccept', conn.autoAccept)}
                          className={cn(
                            'w-11 h-6 rounded-full relative transition-colors duration-300',
                            conn.autoAccept ? 'bg-primary' : 'bg-slate-300'
                          )}
                        >
                          <div className={cn(
                            'absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-300',
                            conn.autoAccept ? 'right-0.5' : 'left-0.5'
                          )} />
                        </button>
                      </div>

                      {/* Sync menu */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-on-surface">مزامنة القائمة</p>
                          <p className="text-[11px] text-on-surface-variant">تحديث القائمة تلقائياً على المنصة</p>
                        </div>
                        <button
                          onClick={() => toggleSetting(conn.slug, 'menuSync', conn.menuSync)}
                          className={cn(
                            'w-11 h-6 rounded-full relative transition-colors duration-300',
                            conn.menuSync ? 'bg-primary' : 'bg-slate-300'
                          )}
                        >
                          <div className={cn(
                            'absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-300',
                            conn.menuSync ? 'right-0.5' : 'left-0.5'
                          )} />
                        </button>
                      </div>

                      {/* Warning if disconnected */}
                      {!conn.isConnected && (
                        <div className="flex items-center gap-2 mt-2 p-3 bg-amber-50 rounded-xl">
                          <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                          <p className="text-xs text-amber-700">فعّل الاتصال أولاً لاستخدام هذه الإعدادات</p>
                        </div>
                      )}

                      <button
                        className="mt-1 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-primary/30 text-on-surface text-sm font-semibold hover:bg-primary/5 transition-colors"
                        onClick={() => toggleConnect(conn.slug, conn.isConnected)}
                      >
                        <Plug size={14} />
                        {conn.isConnected ? 'قطع الاتصال' : 'ربط المنصة'}
                      </button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

        </main>
      </div>
    </div>
  );
};
