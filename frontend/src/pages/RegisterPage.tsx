import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, Eye, EyeOff, AlertCircle, Plus, Trash2, Store } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { AuthShell } from '../components/ui/AuthShell';
import type { Page } from '../types';
import { auth, type AuthUser } from '../lib/api';

interface RegisterPageProps {
  setPage: (p: Page) => void;
  onLogin: (user: AuthUser) => void;
}

type FieldErrors = {
  name?: string;
  email?: string;
  password?: string;
  branches?: string;
  server?: string;
};

interface BranchRow { name: string; username: string; password: string; }

export const RegisterPage = ({ setPage, onLogin }: RegisterPageProps) => {
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);

  const addBranch = () => setBranches((b) => [...b, { name: '', username: '', password: '' }]);
  const removeBranch = (i: number) => setBranches((b) => b.filter((_, idx) => idx !== i));
  const updateBranch = (i: number, key: keyof BranchRow, val: string) =>
    setBranches((b) => b.map((row, idx) => (idx === i ? { ...row, [key]: val } : row)));

  const validate = () => {
    const e: FieldErrors = {};
    if (!name.trim()) e.name = 'الاسم مطلوب';
    if (!email) e.email = 'البريد الإلكتروني مطلوب';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'صيغة البريد الإلكتروني غير صحيحة';
    if (!password) e.password = 'كلمة المرور مطلوبة';
    else if (password.length < 6) e.password = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
    for (const b of branches) {
      if (b.username.trim() && b.password.length < 6) {
        e.branches = 'كل فرع له اسم مستخدم يجب أن تكون كلمة مروره 6 أحرف على الأقل';
        break;
      }
    }
    return e;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    setLoading(true);
    try {
      const cleaned = branches
        .filter((b) => b.name.trim())
        .map((b) => ({
          name: b.name.trim(),
          username: b.username.trim() || undefined,
          password: b.password || undefined,
        }));
      const user = await auth.register({
        name: name.trim(),
        email: email.trim(),
        password,
        businessName: businessName.trim() || undefined,
        branches: cleaned.length ? cleaned : undefined,
      });
      onLogin(user);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
      setErrors({ server: msg });
    } finally {
      setLoading(false);
    }
  };

  const inputCls = (hasError?: string) =>
    `w-full rounded-xl px-4 py-3 text-sm border transition-all outline-none ${
      hasError
        ? 'border-error/50 bg-error/5 focus:ring-2 focus:ring-error/20'
        : 'border-mist bg-paper focus:ring-2 focus:ring-lime/40 focus:border-forest/40'
    }`;

  return (
    <AuthShell title="أنشئ حساب مطعمك وابدأ القبول الآلي">
      <form className="space-y-5" onSubmit={handleSubmit} noValidate>
        {/* Owner name */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2">الاسم</label>
          <input
            className={inputCls(errors.name)}
            placeholder="اسمك الكامل"
            value={name}
            onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: undefined })); }}
            autoComplete="name"
          />
          {errors.name && <p className="flex items-center gap-1.5 text-xs text-error mt-1.5 font-medium"><AlertCircle size={12} /> {errors.name}</p>}
        </div>

        {/* Business name */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2">
            اسم المطعم <span className="text-slate normal-case">(اختياري)</span>
          </label>
          <input
            className={inputCls()}
            placeholder="اسم نشاطك التجاري"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            autoComplete="organization"
          />
        </div>

        {/* Email */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2">البريد الإلكتروني</label>
          <input
            className={inputCls(errors.email)}
            placeholder="name@company.com"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setErrors((p) => ({ ...p, email: undefined })); }}
            autoComplete="email"
          />
          {errors.email && <p className="flex items-center gap-1.5 text-xs text-error mt-1.5 font-medium"><AlertCircle size={12} /> {errors.email}</p>}
        </div>

        {/* Password */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2">كلمة المرور</label>
          <div className="relative">
            <input
              className={`${inputCls(errors.password)} pl-11`}
              placeholder="••••••••"
              type={showPass ? 'text' : 'password'}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setErrors((p) => ({ ...p, password: undefined })); }}
              autoComplete="new-password"
            />
            <button type="button" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate hover:text-on-surface transition-colors" onClick={() => setShowPass((s) => !s)}>
              {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {errors.password && <p className="flex items-center gap-1.5 text-xs text-error mt-1.5 font-medium"><AlertCircle size={12} /> {errors.password}</p>}
        </div>

        {/* Branches (optional) */}
        <div className="rounded-xl border border-mist p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant flex items-center gap-1.5">
              <Store size={13} /> الفروع <span className="text-slate normal-case">(اختياري)</span>
            </span>
            <button type="button" onClick={addBranch} className="text-xs font-bold text-forest hover:underline flex items-center gap-1">
              <Plus size={14} /> إضافة فرع
            </button>
          </div>
          <p className="text-[11px] text-on-surface-variant mb-3">
            أضِف فروعك الآن (أو لاحقاً من لوحة التحكم). يمكنك تعيين اسم مستخدم وكلمة مرور لكل فرع لتسجيل دخوله.
          </p>

          {branches.length === 0 && (
            <p className="text-[11px] text-slate text-center py-2">سيُنشأ فرع واحد باسم مطعمك إن لم تُضف فروعاً.</p>
          )}

          <div className="space-y-3">
            {branches.map((b, i) => (
              <div key={i} className="rounded-lg bg-surface-container-low p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    className={inputCls()}
                    placeholder={`اسم الفرع ${i + 1}`}
                    value={b.name}
                    onChange={(e) => updateBranch(i, 'name', e.target.value)}
                  />
                  <button type="button" onClick={() => removeBranch(i)} className="p-2 text-on-surface-variant hover:text-error rounded-lg shrink-0">
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className={inputCls()} placeholder="اسم المستخدم" dir="ltr" value={b.username} onChange={(e) => updateBranch(i, 'username', e.target.value)} />
                  <input className={inputCls()} placeholder="كلمة المرور" dir="ltr" value={b.password} onChange={(e) => updateBranch(i, 'password', e.target.value)} />
                </div>
              </div>
            ))}
          </div>
          {errors.branches && <p className="flex items-center gap-1.5 text-xs text-error mt-2 font-medium"><AlertCircle size={12} /> {errors.branches}</p>}
        </div>

        {errors.server && (
          <p className="flex items-center gap-1.5 text-xs text-error font-medium bg-error/5 px-3 py-2 rounded-lg">
            <AlertCircle size={12} /> {errors.server}
          </p>
        )}

        <Button className="w-full py-3.5" type="submit" disabled={loading}>
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" />
              جاري إنشاء الحساب...
            </span>
          ) : (
            <>إنشاء حساب <ArrowLeft size={18} /></>
          )}
        </Button>
      </form>

      <p className="mt-8 text-sm text-on-surface-variant text-center">
        لديك حساب بالفعل؟{' '}
        <button type="button" className="text-forest font-bold hover:underline decoration-2 underline-offset-4" onClick={() => setPage('login')}>
          تسجيل الدخول
        </button>
      </p>
    </AuthShell>
  );
};
