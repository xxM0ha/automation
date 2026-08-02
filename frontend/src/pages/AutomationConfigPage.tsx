import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, RefreshCw, Save, Code2, LayoutGrid, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Sidebar } from '../components/layout/Sidebar';
import { TopNav } from '../components/layout/TopNav';
import { cn } from '../lib/utils';
import {
  appConfig as appConfigApi,
  type AutomationConfig,
  type AutomationPlatformConfig,
  type AutomationControl,
  type AutomationRunMode,
} from '../lib/api';
import type { Page } from '../types';

interface AutomationConfigPageProps {
  setPage: (p: Page) => void;
}

const CONTROL_OPTIONS: { value: AutomationControl; label: string; active: string }[] = [
  { value: 'running', label: 'تشغيل', active: 'bg-green-500 text-white' },
  { value: 'paused',  label: 'إيقاف مؤقت', active: 'bg-amber-500 text-white' },
  { value: 'stopped', label: 'متوقف', active: 'bg-red-500 text-white' },
];

const RUN_MODE_OPTIONS: { value: AutomationRunMode; label: string }[] = [
  { value: 'once',       label: 'مرة واحدة' },
  { value: 'continuous', label: 'مستمر' },
];

export const AutomationConfigPage = ({ setPage }: AutomationConfigPageProps) => {
  const [config, setConfig]     = useState<AutomationConfig | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [rawText, setRawText]   = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [message, setMessage]   = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load the single global config (shared by all restaurants).
  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    setJsonError(null);
    try {
      const data = await appConfigApi.get();
      setConfig(data);
      setRawText(JSON.stringify(data, null, 2));
    } catch (e) {
      setConfig(null);
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'تعذّر تحميل الإعدادات' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Keep the raw JSON text in sync when card edits change the config object.
  const updateConfig = (next: AutomationConfig) => {
    setConfig(next);
    setRawText(JSON.stringify(next, null, 2));
  };

  const patchPlatform = (index: number, patch: Partial<AutomationPlatformConfig>) => {
    if (!config) return;
    const platforms = config.platforms.map((p, i) => (i === index ? { ...p, ...patch } : p));
    updateConfig({ ...config, platforms });
  };

  const handleRawChange = (text: string) => {
    setRawText(text);
    try {
      const parsed = JSON.parse(text) as AutomationConfig;
      setConfig(parsed);
      setJsonError(null);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'JSON غير صالح');
    }
  };

  const handleSave = async () => {
    setMessage(null);
    let doc: AutomationConfig | null = config;
    if (advanced) {
      try {
        doc = JSON.parse(rawText) as AutomationConfig;
        setJsonError(null);
      } catch (e) {
        setJsonError(e instanceof Error ? e.message : 'JSON غير صالح');
        setMessage({ type: 'error', text: 'تعذّر الحفظ: صيغة JSON غير صالحة' });
        return;
      }
    }
    if (!doc) return;
    setSaving(true);
    try {
      const updated = await appConfigApi.save(doc);
      setConfig(updated);
      setRawText(JSON.stringify(updated, null, 2));
      setMessage({ type: 'success', text: 'تم حفظ الإعدادات بنجاح' });
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'تعذّر حفظ الإعدادات' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar currentPage="automation" setPage={setPage} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopNav setPage={setPage} currentPage="automation" />
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
              <h1 className="text-3xl md:text-4xl font-black text-on-surface">الأتمتة</h1>
              <p className="text-on-surface-variant mt-2 text-sm max-w-xl">
                الإعداد العام المشترك لجميع المطاعم — اضبط سلوك الأتمتة لكل منصة،
                وتحكم في التشغيل والأولوية، أو حرّر المستند بالكامل من المحرر المتقدم.
              </p>
            </div>
            <div className="flex gap-2 items-center">
              <button
                onClick={() => setAdvanced((a) => !a)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors',
                  advanced
                    ? 'bg-primary/10 border-primary/30 text-on-surface'
                    : 'bg-white border-mist text-on-surface-variant hover:bg-surface-container-low'
                )}
              >
                {advanced ? <LayoutGrid size={15} /> : <Code2 size={15} />}
                {advanced ? 'عرض البطاقات' : 'محرر JSON'}
              </button>
              <button
                onClick={() => fetchConfig()}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-mist bg-white text-on-surface-variant hover:bg-surface-container-low disabled:opacity-50 transition-colors"
              >
                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                إعادة تحميل
              </button>
              <button
                onClick={handleSave}
                disabled={saving || loading || (advanced && !!jsonError)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-primary text-on-primary hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <Save size={15} className={saving ? 'animate-pulse' : ''} />
                حفظ
              </button>
            </div>
          </div>

          {/* Status message */}
          {message && (
            <div
              className={cn(
                'flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold',
                message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
              )}
            >
              {message.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              {message.text}
            </div>
          )}

          {loading && (
            <p className="text-center text-on-surface-variant text-sm py-12">جارٍ التحميل...</p>
          )}

          {/* Advanced raw JSON editor */}
          {!loading && advanced && (
            <Card hover={false} className="p-0 overflow-hidden">
              <div className="px-5 py-4 border-b border-mist flex items-center justify-between">
                <p className="font-bold text-on-surface text-sm">محرر المستند (JSON)</p>
                {jsonError && (
                  <span className="flex items-center gap-1 text-xs text-red-600 font-semibold">
                    <AlertTriangle size={13} /> {jsonError}
                  </span>
                )}
              </div>
              <textarea
                dir="ltr"
                spellCheck={false}
                value={rawText}
                onChange={(e) => handleRawChange(e.target.value)}
                className={cn(
                  'w-full h-[60vh] p-5 font-mono text-xs leading-relaxed text-left text-on-surface bg-surface-container-low/60 resize-y focus:outline-none focus:ring-2 focus:ring-primary/20',
                  jsonError && 'ring-2 ring-red-200'
                )}
              />
            </Card>
          )}

          {/* Quick-edit platform cards */}
          {!loading && !advanced && config && (
            <>
              <div className="flex flex-wrap gap-4 text-sm">
                <div className="px-4 py-2 bg-white rounded-xl border border-mist">
                  <span className="text-on-surface-variant">إصدار المخطط: </span>
                  <span className="font-bold text-on-surface">{config.schemaVersion}</span>
                </div>
                {config.updatedAt && (
                  <div className="px-4 py-2 bg-white rounded-xl border border-mist">
                    <span className="text-on-surface-variant">آخر تحديث: </span>
                    <span className="font-bold text-on-surface">{config.updatedAt}</span>
                  </div>
                )}
                <div className="px-4 py-2 bg-white rounded-xl border border-mist">
                  <span className="text-on-surface-variant">عدد المنصات: </span>
                  <span className="font-bold text-on-surface">{config.platforms?.length ?? 0}</span>
                </div>
              </div>

              {(!config.platforms || config.platforms.length === 0) && (
                <p className="text-center text-on-surface-variant text-sm py-12">لا توجد منصات مُعدّة بعد</p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {config.platforms?.map((p, i) => (
                  <Card key={p.platform ?? i} hover={false} className="flex flex-col gap-4">
                    {/* Title row */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-bold text-on-surface text-base truncate">{p.label || p.platform}</h3>
                        <p className="text-xs text-on-surface-variant mt-0.5 font-technical">{p.platform}</p>
                      </div>
                      {/* Enabled toggle */}
                      <button
                        onClick={() => patchPlatform(i, { enabled: !p.enabled })}
                        title={p.enabled ? 'مُفعّل' : 'معطّل'}
                        className={cn(
                          'w-12 h-6 rounded-full relative transition-colors duration-300 shrink-0',
                          p.enabled ? 'bg-green-500' : 'bg-slate-300'
                        )}
                      >
                        <div className={cn(
                          'absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-300',
                          p.enabled ? 'right-1' : 'left-1'
                        )} />
                      </button>
                    </div>

                    {/* Control segmented buttons */}
                    <div>
                      <p className="text-[11px] font-bold text-on-surface-variant mb-1.5">الحالة</p>
                      <div className="flex gap-1 bg-surface-container-low rounded-xl p-1">
                        {CONTROL_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => patchPlatform(i, { control: opt.value })}
                            className={cn(
                              'flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors',
                              (p.control ?? 'stopped') === opt.value ? opt.active : 'text-on-surface-variant hover:text-on-surface'
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Run mode */}
                    <div>
                      <p className="text-[11px] font-bold text-on-surface-variant mb-1.5">نمط التشغيل</p>
                      <div className="flex gap-1 bg-surface-container-low rounded-xl p-1">
                        {RUN_MODE_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => patchPlatform(i, { runMode: opt.value })}
                            className={cn(
                              'flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors',
                              (p.runMode ?? 'once') === opt.value ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Priority */}
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-bold text-on-surface-variant">الأولوية</p>
                      <input
                        type="number"
                        value={p.priority ?? 0}
                        onChange={(e) => patchPlatform(i, { priority: Number(e.target.value) })}
                        className="w-20 text-center text-sm font-semibold border border-mist rounded-lg py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}

        </main>
      </div>
    </div>
  );
};
