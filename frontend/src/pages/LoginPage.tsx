import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { AuthShell } from '../components/ui/AuthShell';
import type { Page } from '../types';
import { auth, type AuthUser } from '../lib/api';

interface LoginPageProps {
  setPage: (p: Page) => void;
  onLogin: (user: AuthUser) => void;
}

export const LoginPage = ({ setPage, onLogin }: LoginPageProps) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; server?: string }>({});
  const [loading, setLoading] = useState(false);

  const validate = () => {
    const e: Omit<typeof errors, 'server'> = {};
    // The field accepts an email (owners) or a branch username — only validate
    // email format when it looks like an email.
    if (!email) e.email = 'البريد الإلكتروني أو اسم المستخدم مطلوب';
    else if (email.includes('@') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'صيغة البريد الإلكتروني غير صحيحة';
    if (!password) e.password = 'كلمة المرور مطلوبة';
    else if (password.length < 6) e.password = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
    return e;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    setLoading(true);
    try {
      const user = await auth.login(email, password);
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
    <AuthShell title="مرحباً بعودتك">
      <form className="space-y-5" onSubmit={handleSubmit} noValidate>
        {/* Email */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2">
            البريد الإلكتروني أو اسم المستخدم
          </label>
          <input
            className={inputCls(errors.email)}
            placeholder="name@company.com أو اسم المستخدم"
            type="text"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setErrors((prev) => ({ ...prev, email: undefined })); }}
            autoComplete="username"
          />
          {errors.email && (
            <p className="flex items-center gap-1.5 text-xs text-error mt-1.5 font-medium">
              <AlertCircle size={12} /> {errors.email}
            </p>
          )}
        </div>

        {/* Password */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
              كلمة المرور
            </label>
            <button type="button" className="text-xs font-semibold text-forest hover:underline">
              نسيت كلمة المرور؟
            </button>
          </div>
          <div className="relative">
            <input
              className={`${inputCls(errors.password)} pl-11`}
              placeholder="••••••••"
              type={showPass ? 'text' : 'password'}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setErrors((prev) => ({ ...prev, password: undefined })); }}
              autoComplete="current-password"
            />
            <button
              type="button"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate hover:text-on-surface transition-colors"
              onClick={() => setShowPass((s) => !s)}
            >
              {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {errors.password && (
            <p className="flex items-center gap-1.5 text-xs text-error mt-1.5 font-medium">
              <AlertCircle size={12} /> {errors.password}
            </p>
          )}
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
              جاري تسجيل الدخول...
            </span>
          ) : (
            <>
              تسجيل الدخول
              <ArrowLeft size={18} />
            </>
          )}
        </Button>
      </form>

      <p className="mt-8 text-sm text-on-surface-variant text-center">
        جديد على المنصة؟{' '}
        <button
          type="button"
          className="text-forest font-bold hover:underline decoration-2 underline-offset-4"
          onClick={() => setPage('register')}
        >
          إنشاء حساب
        </button>
      </p>
    </AuthShell>
  );
};
