import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  ChevronLeft, RefreshCw, Plus, Trash2, Store, KeyRound, Check, X, Eye, FolderSync,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Sidebar } from '../components/layout/Sidebar';
import { TopNav } from '../components/layout/TopNav';
import { cn } from '../lib/utils';
import { branchesApi, getActiveBranch, type BranchAdmin, type BranchSyncResult } from '../lib/api';
import { useUser, switchBranch } from '../lib/authStore';
import type { Page } from '../types';

interface BranchesPageProps {
  setPage: (p: Page) => void;
}

const EMPTY_CREATE = {
  name: '', foodicsBranch: '', mode: 'empty' as 'empty' | 'clone',
  cloneFrom: '', username: '', password: '',
};

export const BranchesPage = ({ setPage }: BranchesPageProps) => {
  const user = useUser();
  const active = getActiveBranch();
  const [branches, setBranches] = useState<BranchAdmin[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_CREATE);
  const [creating, setCreating] = useState(false);

  const [loginFor, setLoginFor] = useState<number | null>(null);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });

  const [showSync, setShowSync] = useState(false);
  const [syncFrom, setSyncFrom] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<BranchSyncResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setBranches(await branchesApi.list()); }
    catch { /* empty state */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setErr('');
    if (!form.name.trim()) { setErr('اسم الفرع مطلوب.'); return; }
    if (form.username && form.password.length < 6) { setErr('كلمة مرور الفرع يجب أن تكون 6 أحرف على الأقل.'); return; }
    setCreating(true);
    try {
      const b = await branchesApi.create({
        name: form.name.trim(),
        foodicsBranch: form.foodicsBranch.trim() || undefined,
        mode: form.mode,
        cloneFrom: form.mode === 'clone' ? form.cloneFrom || undefined : undefined,
        username: form.username.trim() || undefined,
        password: form.password || undefined,
      });
      setBranches((p) => [...p, b]);
      setForm(EMPTY_CREATE);
      setShowCreate(false);
    } catch (e) { setErr(e instanceof Error ? e.message : 'تعذّر إنشاء الفرع.'); }
    finally { setCreating(false); }
  };

  const del = async (b: BranchAdmin) => {
    if (!confirm(`حذف فرع «${b.name}»؟ سيُحذف كل ما يخصّه (القائمة، الطلبات، الإعدادات). لا يمكن التراجع.`)) return;
    setBranches((p) => p.filter((x) => x.id !== b.id));
    try { await branchesApi.remove(b.id); } catch { load(); }
  };

  const runSync = async () => {
    setErr(''); setSyncResult(null);
    const src = branches.find((b) => b.slug === syncFrom);
    if (!src) { setErr('اختر الفرع المصدر.'); return; }
    const others = branches.filter((b) => b.slug !== syncFrom).map((b) => b.name).join('، ');
    if (!confirm(`مزامنة قائمة «${src.name}» إلى: ${others}؟\nستُضاف الأصناف الجديدة وتُحدّث الموجودة ومابنغها. لا تُحذف أصناف الفروع الأخرى.`)) return;
    setSyncing(true);
    try {
      const res = await branchesApi.syncMenus({ from: syncFrom });
      setSyncResult(res);
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'تعذّرت المزامنة.'); }
    finally { setSyncing(false); }
  };

  const saveLogin = async (id: number) => {
    setErr('');
    if (!loginForm.username.trim()) { setErr('اسم المستخدم مطلوب.'); return; }
    try {
      const updated = await branchesApi.setLogin(id, {
        username: loginForm.username.trim(),
        password: loginForm.password || undefined,
      });
      setBranches((p) => p.map((b) => (b.id === id ? updated : b)));
      setLoginFor(null);
      setLoginForm({ username: '', password: '' });
    } catch (e) { setErr(e instanceof Error ? e.message : 'تعذّر حفظ تسجيل الدخول.'); }
  };

  if (user && !user.isOwner) {
    return (
      <div className="flex min-h-screen bg-surface">
        <Sidebar currentPage="branches" setPage={setPage} />
        <div className="flex-1 flex flex-col min-w-0">
          <TopNav setPage={setPage} currentPage="branches" />
          <main className="p-8">
            <Card className="py-16 text-center" hover={false}>
              <Store size={40} className="mx-auto mb-3 text-on-surface-variant opacity-40" />
              <p className="text-on-surface-variant">إدارة الفروع متاحة لحساب صاحب المطعم فقط.</p>
            </Card>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar currentPage="branches" setPage={setPage} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopNav setPage={setPage} currentPage="branches" />
        <main className="p-6 md:p-8 space-y-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <button
                onClick={() => setPage('dashboard')}
                className="flex items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface font-semibold mb-3 transition-colors"
              >
                <ChevronLeft size={14} /> العودة للوحة التحكم
              </button>
              <h1 className="text-3xl md:text-4xl font-black text-on-surface">الفروع</h1>
              <p className="text-on-surface-variant mt-2 text-sm max-w-2xl">
                أضِف فروع مطعمك، عيّن اسم مستخدم وكلمة مرور لكل فرع، وانتقل بين الفروع لعرضها وإدارتها.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={load} className="p-2.5 text-on-surface-variant hover:text-on-surface rounded-xl" title="تحديث">
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              </button>
              {branches.length > 1 && (
                <Button variant="secondary" onClick={() => { setShowSync((v) => !v); setShowCreate(false); setErr(''); setSyncResult(null); setSyncFrom(active || branches[0]?.slug || ''); }}>
                  <FolderSync size={18} /> مزامنة القوائم
                </Button>
              )}
              <Button onClick={() => { setShowCreate((v) => !v); setShowSync(false); setErr(''); }}>
                <Plus size={18} /> إضافة فرع
              </Button>
            </div>
          </div>

          {err && (
            <div className="text-sm text-error bg-error/5 rounded-xl px-4 py-3 font-medium">{err}</div>
          )}

          {/* Sync menus */}
          {showSync && (
            <Card hover={false} className="p-6 space-y-4 border border-mist">
              <div>
                <h3 className="font-bold text-on-surface flex items-center gap-2"><FolderSync size={18} /> مزامنة قوائم الفروع</h3>
                <p className="text-xs text-on-surface-variant mt-1">
                  اختر الفرع الذي عدّلت قائمته (المصدر)؛ ستُنسخ أصنافه وأسعاره وربط التطبيقات والتصنيفات إلى بقية الفروع.
                  تُضاف الأصناف الجديدة وتُحدّث الموجودة — <b>ولا تُحذف</b> أصناف الفروع الأخرى.
                </p>
              </div>
              <div className="flex items-end gap-3 flex-wrap">
                <Field label="الفرع المصدر">
                  <select className={inputCls} value={syncFrom} onChange={(e) => setSyncFrom(e.target.value)}>
                    {branches.map((b) => <option key={b.id} value={b.slug}>{b.name} ({b.itemCount} صنف)</option>)}
                  </select>
                </Field>
                <Button onClick={runSync} disabled={syncing}>
                  {syncing ? 'جارٍ المزامنة…' : <><Check size={18} /> مزامنة إلى بقية الفروع</>}
                </Button>
                <Button variant="ghost" onClick={() => { setShowSync(false); setSyncResult(null); }}>إلغاء</Button>
              </div>

              {syncResult && (
                <div className="rounded-lg border border-mist bg-surface-container-low p-4 space-y-1.5">
                  <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-1">نتيجة المزامنة</p>
                  {syncResult.results.length === 0 && <p className="text-sm text-on-surface-variant">لا توجد فروع أخرى.</p>}
                  {syncResult.results.map((r) => (
                    <div key={r.branch} className="text-[13px] flex items-center gap-2 flex-wrap">
                      <Check size={13} className="text-forest" />
                      <span className="font-semibold text-on-surface">{r.name}</span>
                      {r.error
                        ? <span className="text-error">خطأ: {r.error}</span>
                        : <span className="text-on-surface-variant">
                            {r.created || 0} جديد · {r.updated || 0} محدّث · {r.mappings || 0} ربط
                            {r.categories ? ` · ${r.categories} تصنيف` : ''}
                            {r.aliases ? ` · ${r.aliases} اسم بديل` : ''}
                          </span>}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Create form */}
          {showCreate && (
            <Card hover={false} className="p-6 space-y-4 border border-mist">
              <h3 className="font-bold text-on-surface">فرع جديد</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="اسم الفرع">
                  <input className={inputCls} value={form.name} placeholder="مثال: فرع المنصور"
                    onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </Field>
                <Field label="فرع Foodics (اختياري)">
                  <input className={inputCls} value={form.foodicsBranch} placeholder="اسم الفرع في Foodics"
                    onChange={(e) => setForm({ ...form, foodicsBranch: e.target.value })} />
                </Field>
              </div>

              {/* Empty vs clone */}
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2">محتوى الفرع</p>
                <div className="flex flex-wrap gap-2">
                  <Choice active={form.mode === 'empty'} onClick={() => setForm({ ...form, mode: 'empty' })}>فارغ</Choice>
                  <Choice active={form.mode === 'clone'} onClick={() => setForm({ ...form, mode: 'clone' })}>نسخ من فرع موجود</Choice>
                </div>
                {form.mode === 'clone' && (
                  <select
                    className={cn(inputCls, 'mt-2')}
                    value={form.cloneFrom}
                    onChange={(e) => setForm({ ...form, cloneFrom: e.target.value })}
                  >
                    <option value="">اختر الفرع المصدر…</option>
                    {branches.map((b) => <option key={b.id} value={b.slug}>{b.name}</option>)}
                  </select>
                )}
              </div>

              {/* Optional login */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="اسم المستخدم للفرع (اختياري)">
                  <input className={inputCls} value={form.username} placeholder="مثال: mansour" dir="ltr"
                    onChange={(e) => setForm({ ...form, username: e.target.value })} />
                </Field>
                <Field label="كلمة المرور">
                  <input className={inputCls} value={form.password} type="text" placeholder="6 أحرف على الأقل" dir="ltr"
                    onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </Field>
              </div>

              <div className="flex gap-2 pt-1">
                <Button onClick={create} disabled={creating}>
                  {creating ? 'جارٍ الإنشاء…' : <><Check size={18} /> إنشاء الفرع</>}
                </Button>
                <Button variant="ghost" onClick={() => { setShowCreate(false); setForm(EMPTY_CREATE); }}>إلغاء</Button>
              </div>
            </Card>
          )}

          {/* Branch list */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {branches.map((b) => {
              const login = b.logins[0];
              const isActive = b.slug === active;
              return (
                <Card key={b.id} hover={false} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className={cn('mt-0.5 w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                        isActive ? 'bg-lime text-ink' : 'bg-surface-container-low text-on-surface-variant')}>
                        <Store size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-on-surface">{b.name}</span>
                          {isActive && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-lime/15 text-forest">الفرع الحالي</span>}
                          {!b.isActive && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant">معطّل</span>}
                        </div>
                        <p className="text-xs text-on-surface-variant mt-0.5">
                          {b.itemCount} صنف{b.foodicsBranch ? ` · Foodics: ${b.foodicsBranch}` : ''}
                        </p>
                        <p className="text-xs mt-1 flex items-center gap-1.5">
                          <KeyRound size={12} className="text-on-surface-variant" />
                          {login
                            ? <span className="text-on-surface" dir="ltr">{login.username}</span>
                            : <span className="text-on-surface-variant">لا يوجد تسجيل دخول</span>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!isActive && (
                        <button onClick={() => switchBranch(b.slug)} title="عرض هذا الفرع"
                          className="p-2 text-on-surface-variant hover:text-forest hover:bg-lime/10 rounded-lg">
                          <Eye size={16} />
                        </button>
                      )}
                      <button onClick={() => { setLoginFor(loginFor === b.id ? null : b.id); setLoginForm({ username: login?.username || '', password: '' }); setErr(''); }}
                        title="تسجيل دخول الفرع"
                        className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low rounded-lg">
                        <KeyRound size={16} />
                      </button>
                      <button onClick={() => del(b)} title="حذف"
                        className="p-2 text-on-surface-variant hover:text-error hover:bg-error/5 rounded-lg">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Inline login editor */}
                  {loginFor === b.id && (
                    <div className="mt-4 pt-4 border-t border-mist space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input className={inputCls} value={loginForm.username} placeholder="اسم المستخدم" dir="ltr"
                          onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} />
                        <input className={inputCls} value={loginForm.password} type="text" dir="ltr"
                          placeholder={login ? 'كلمة مرور جديدة (اتركها فارغة للإبقاء)' : 'كلمة المرور'}
                          onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => saveLogin(b.id)}><Check size={16} /> حفظ</Button>
                        <Button size="sm" variant="ghost" onClick={() => setLoginFor(null)}><X size={16} /> إلغاء</Button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          {!loading && branches.length === 0 && (
            <Card className="py-16 text-center" hover={false}>
              <Store size={40} className="mx-auto mb-3 text-on-surface-variant opacity-40" />
              <p className="text-on-surface-variant text-sm">لا توجد فروع بعد — أضِف أول فرع.</p>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
};

const inputCls =
  'w-full rounded-xl px-4 py-3 text-sm border border-mist bg-paper outline-none transition-all focus:ring-2 focus:ring-lime/40 focus:border-forest/40';

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <label className="block text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2">{label}</label>
    {children}
  </div>
);

const Choice = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) => (
  <button
    onClick={onClick}
    className={cn('px-4 py-2 rounded-xl text-sm font-semibold border transition-all',
      active ? 'bg-ink text-white border-ink' : 'bg-paper text-on-surface-variant border-mist hover:border-on-surface/30')}
  >
    {children}
  </button>
);
