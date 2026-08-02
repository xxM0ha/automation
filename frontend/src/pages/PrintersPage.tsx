import { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronLeft, RefreshCw, Plus, Trash2, Printer as PrinterIcon, Save, X } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Sidebar } from '../components/layout/Sidebar';
import { TopNav } from '../components/layout/TopNav';
import { cn } from '../lib/utils';
import {
  printersApi,
  type ApiPrinter,
  type ApiPrinterInput,
  type ApiRoutingItem,
  type PrinterRole,
} from '../lib/api';
import type { Page } from '../types';

interface PrintersPageProps {
  setPage: (p: Page) => void;
}

const ROLE_LABEL: Record<PrinterRole, string> = {
  station: 'محطة',
  cashier: 'كاشير (كل الأصناف)',
};

const PAPER_OPTIONS = [
  { v: 576, label: '80 مم' },
  { v: 384, label: '58 مم' },
];

const EMPTY_FORM: ApiPrinterInput = { name: '', ip: '', port: 9100, paperWidth: 576, role: 'station' };

export const PrintersPage = ({ setPage }: PrintersPageProps) => {
  const [printers, setPrinters] = useState<ApiPrinter[]>([]);
  const [items, setItems] = useState<ApiRoutingItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState<ApiPrinterInput>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, r] = await Promise.all([printersApi.list(), printersApi.routing()]);
      setPrinters(p);
      setItems(r);
    } catch {
      // empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const stations = useMemo(() => printers.filter((p) => p.role === 'station'), [printers]);
  const hasCashier = useMemo(() => printers.some((p) => p.role === 'cashier' && p.active), [printers]);

  // ── Printer CRUD ──
  const resetForm = () => { setForm(EMPTY_FORM); setEditingId(null); };

  const submitPrinter = async () => {
    if (!form.name.trim() || !form.ip.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        const updated = await printersApi.update(editingId, form);
        setPrinters((prev) => prev.map((p) => (p.id === editingId ? updated : p)));
      } else {
        const created = await printersApi.create(form);
        setPrinters((prev) => [...prev, created]);
      }
      resetForm();
    } catch {
      // ignore; keep form
    } finally {
      setSaving(false);
    }
  };

  const editPrinter = (p: ApiPrinter) => {
    setEditingId(p.id);
    setForm({ name: p.name, ip: p.ip, port: p.port, paperWidth: p.paperWidth, role: p.role, active: p.active });
  };

  const deletePrinter = async (id: number) => {
    if (!confirm('حذف هذه الطابعة؟ سيتم إلغاء توجيه الأصناف إليها.')) return;
    setPrinters((prev) => prev.filter((p) => p.id !== id));
    setItems((prev) => prev.map((it) => (it.printerId === id ? { ...it, printerId: null } : it)));
    if (editingId === id) resetForm();
    try { await printersApi.remove(id); } catch { load(); }
  };

  // ── Routing ──
  const setRoute = async (itemId: number, printerId: number | null) => {
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, printerId } : it)));
    try { await printersApi.setRoute(itemId, printerId); } catch { load(); }
  };

  const setCategoryRoute = async (category: string, printerId: number | null) => {
    const ids = items.filter((it) => it.category === category).map((it) => it.id);
    if (ids.length === 0) return;
    setItems((prev) => prev.map((it) => (it.category === category ? { ...it, printerId } : it)));
    try { await printersApi.setRouteBulk(ids, printerId); } catch { load(); }
  };

  // group items by category, preserving order
  const grouped = useMemo(() => {
    const map = new Map<string, ApiRoutingItem[]>();
    for (const it of items) {
      const key = it.category || 'بدون فئة';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return Array.from(map.entries());
  }, [items]);

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar currentPage="printers" setPage={setPage} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopNav setPage={setPage} currentPage="printers" />
        <main className="p-6 md:p-8 space-y-6">
          <div>
            <button
              onClick={() => setPage('dashboard')}
              className="flex items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface font-semibold mb-3 transition-colors"
            >
              <ChevronLeft size={14} /> العودة للوحة التحكم
            </button>
            <h1 className="text-3xl md:text-4xl font-black text-on-surface">الطابعات</h1>
            <p className="text-on-surface-variant mt-2 text-sm max-w-2xl">
              أضف طابعات الفرع ووجّه كل صنف إلى محطته. طابعة <b>الكاشير</b> تطبع كل الأصناف،
              وطابعة <b>المحطة</b> تطبع الأصناف الموجّهة إليها فقط (المطبخ، المشروبات…).
            </p>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
            {/* ── Printers column ── */}
            <div className="xl:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">الطابعات ({printers.length})</p>
                <button onClick={load} className="p-2 text-on-surface-variant hover:text-on-surface rounded-lg" title="تحديث">
                  <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>

              {printers.map((p) => (
                <Card key={p.id} className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex items-start gap-3">
                    <div className={cn('mt-0.5 w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
                      p.role === 'cashier' ? 'bg-primary/15 text-on-surface' : 'bg-surface-container-low text-on-surface-variant')}>
                      <PrinterIcon size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-on-surface">{p.name}</span>
                        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                          p.role === 'cashier' ? 'bg-primary/20 text-on-surface' : 'bg-surface-container-low text-on-surface-variant')}>
                          {ROLE_LABEL[p.role]}
                        </span>
                        {!p.active && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-500">معطّلة</span>}
                      </div>
                      <p className="text-xs text-on-surface-variant mt-0.5" dir="ltr">{p.ip}:{p.port} · {p.paperWidth === 384 ? '58mm' : '80mm'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => editPrinter(p)} className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low rounded-lg" title="تعديل">
                      <Save size={15} />
                    </button>
                    <button onClick={() => deletePrinter(p.id)} className="p-2 text-on-surface-variant hover:text-red-500 hover:bg-red-50 rounded-lg" title="حذف">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </Card>
              ))}

              {/* Add / edit form */}
              <Card className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-on-surface text-sm">{editingId ? 'تعديل طابعة' : 'إضافة طابعة'}</p>
                  {editingId && (
                    <button onClick={resetForm} className="text-xs text-on-surface-variant hover:text-on-surface flex items-center gap-1">
                      <X size={12} /> إلغاء
                    </button>
                  )}
                </div>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="الاسم (مثال: المطبخ، الكاشير)"
                  className="w-full rounded-xl border border-mist px-4 py-2.5 text-sm bg-white outline-none focus:ring-2 focus:ring-primary/20"
                />
                <div className="grid grid-cols-3 gap-2">
                  <input
                    value={form.ip}
                    onChange={(e) => setForm({ ...form, ip: e.target.value })}
                    placeholder="IP — 192.168.1.50"
                    dir="ltr"
                    className="col-span-2 rounded-xl border border-mist px-4 py-2.5 text-sm bg-white outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <input
                    value={form.port ?? 9100}
                    onChange={(e) => setForm({ ...form, port: Number(e.target.value) || 9100 })}
                    placeholder="Port"
                    dir="ltr"
                    className="rounded-xl border border-mist px-3 py-2.5 text-sm bg-white outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value as PrinterRole })}
                    className="rounded-xl border border-mist px-3 py-2.5 text-sm bg-white outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="station">محطة</option>
                    <option value="cashier">كاشير</option>
                  </select>
                  <select
                    value={form.paperWidth ?? 576}
                    onChange={(e) => setForm({ ...form, paperWidth: Number(e.target.value) })}
                    className="rounded-xl border border-mist px-3 py-2.5 text-sm bg-white outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    {PAPER_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                  </select>
                </div>
                <Button onClick={submitPrinter} disabled={saving || !form.name.trim() || !form.ip.trim()} className="w-full">
                  {editingId ? <Save size={16} /> : <Plus size={16} />} {saving ? 'جارٍ الحفظ…' : editingId ? 'حفظ' : 'إضافة'}
                </Button>
              </Card>
            </div>

            {/* ── Routing column ── */}
            <div className="xl:col-span-3 space-y-4">
              <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">توجيه الأصناف</p>

              {!hasCashier && printers.length > 0 && (
                <div className="text-xs text-amber-700 bg-amber-50 rounded-xl px-4 py-3">
                  لا توجد طابعة كاشير. الأصناف غير الموجّهة لأي محطة لن تُطبع. أضف طابعة بدور «كاشير» لتطبع كل الطلب.
                </div>
              )}

              {stations.length === 0 ? (
                <Card className="p-8 text-center text-sm text-on-surface-variant">
                  أضف طابعة محطة أولاً لتتمكن من توجيه الأصناف إليها.
                </Card>
              ) : (
                grouped.map(([cat, its]) => (
                  <Card key={cat} className="p-4">
                    <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                      <p className="font-bold text-on-surface text-sm">{cat} <span className="text-on-surface-variant font-normal">({its.length})</span></p>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-on-surface-variant">عيّن الكل إلى:</span>
                        <select
                          value=""
                          onChange={(e) => setCategoryRoute(cat, e.target.value ? Number(e.target.value) : null)}
                          className="rounded-lg border border-mist px-2 py-1 text-xs bg-white outline-none focus:ring-2 focus:ring-primary/20"
                        >
                          <option value="">—</option>
                          {stations.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          <option value="">كاشير فقط</option>
                        </select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {its.map((it) => (
                        <div key={it.id} className="flex items-center justify-between gap-3 py-1">
                          <span className="text-sm text-on-surface truncate">{it.name}</span>
                          <select
                            value={it.printerId ?? ''}
                            onChange={(e) => setRoute(it.id, e.target.value ? Number(e.target.value) : null)}
                            className={cn(
                              'rounded-lg border px-3 py-1.5 text-xs bg-white outline-none focus:ring-2 focus:ring-primary/20 shrink-0 min-w-[8rem]',
                              it.printerId ? 'border-primary/40 text-on-surface' : 'border-mist text-on-surface-variant',
                            )}
                          >
                            <option value="">كاشير فقط</option>
                            {stations.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))
              )}
              {!loading && items.length === 0 && (
                <Card className="p-8 text-center text-sm text-on-surface-variant">لا توجد أصناف في القائمة.</Card>
              )}
              {stations.length > 0 && (
                <p className="text-[11px] text-on-surface-variant px-1">
                  «كاشير فقط» يعني أن الصنف يُطبع على طابعة الكاشير ولا يُرسل لأي محطة —
                  {' '}{items.filter((i) => i.printerId).length} موجّه، {items.filter((i) => !i.printerId).length} كاشير فقط.
                </p>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};
