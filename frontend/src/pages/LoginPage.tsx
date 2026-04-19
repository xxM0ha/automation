import { useState } from 'react';
import type { FormEvent } from 'react';
import { Zap, ArrowLeft, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '../components/ui/Button';
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
    if (!email) e.email = 'البريد الإلكتروني مطلوب';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'صيغة البريد الإلكتروني غير صحيحة';
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

  return (
    <div className="bg-surface min-h-screen flex items-center justify-center relative overflow-hidden px-6">
      <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary-container/10 rounded-full blur-[120px]" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-tertiary-container/5 rounded-full blur-[120px]" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="z-10 w-full max-w-md bg-white/80 backdrop-blur-2xl border border-white/30 shadow-2xl rounded-2xl p-8 md:p-10"
      >
        {/* Brand */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-gradient mb-4 shadow-lg shadow-primary/20">
            <Zap className="text-white" size={28} />
          </div>
          <h1 className="text-2xl font-black text-gradient">برايم أوتوميشن</h1>
          <p className="text-on-surface-variant text-sm mt-1">مرحباً بعودتك إلى المنصة</p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit} noValidate>
          {/* Email */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2">
              البريد الإلكتروني
            </label>
            <input
              className={`w-full rounded-xl px-4 py-3 text-sm border transition-all outline-none ${
                errors.email
                  ? 'border-red-400 bg-red-50 focus:ring-2 focus:ring-red-200'
                  : 'border-outline-variant/30 bg-surface-container-lowest focus:ring-2 focus:ring-primary/30 focus:border-primary/40'
              }`}
              placeholder="name@company.com"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setErrors((prev) => ({ ...prev, email: undefined })); }}
              autoComplete="email"
            />
            {errors.email && (
              <p className="flex items-center gap-1.5 text-xs text-red-500 mt-1.5 font-medium">
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
              <button type="button" className="text-xs font-semibold text-primary hover:underline">
                نسيت كلمة المرور؟
              </button>
            </div>
            <div className="relative">
              <input
                className={`w-full rounded-xl px-4 py-3 text-sm border transition-all outline-none pl-11 ${
                  errors.password
                    ? 'border-red-400 bg-red-50 focus:ring-2 focus:ring-red-200'
                    : 'border-outline-variant/30 bg-surface-container-lowest focus:ring-2 focus:ring-primary/30 focus:border-primary/40'
                }`}
                placeholder="••••••••"
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setErrors((prev) => ({ ...prev, password: undefined })); }}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                onClick={() => setShowPass((s) => !s)}
              >
                {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {errors.password && (
              <p className="flex items-center gap-1.5 text-xs text-red-500 mt-1.5 font-medium">
                <AlertCircle size={12} /> {errors.password}
              </p>
            )}
          </div>

          {errors.server && (
            <p className="flex items-center gap-1.5 text-xs text-red-500 font-medium bg-red-50 px-3 py-2 rounded-lg">
              <AlertCircle size={12} /> {errors.server}
            </p>
          )}
          <Button className="w-full py-3.5" type="submit" disabled={loading}>
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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

        <div className="flex items-center gap-4 my-7">
          <div className="h-px flex-1 bg-outline-variant/30" />
          <span className="text-xs font-bold text-outline">أو تسجيل الدخول بـ</span>
          <div className="h-px flex-1 bg-outline-variant/30" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            className="flex items-center justify-center gap-2 bg-surface-container-lowest hover:bg-surface-container-high transition-colors rounded-xl py-3 border border-outline-variant/20 shadow-sm text-sm font-semibold text-on-surface-variant"
          >
            <img
              className="w-5 h-5"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuAsDJXn9Rsj6M8kFnlUOT0bvpthQEB8FRHsTzlWpMnU5i_9MOzrqByKt7_JUC4gDzMJ37B6UEiTUTEvrSM57niynEeqfpgNwejwkeRUanNwEhWts55v1HW5lRcTBukSi3zKWufcDr3HYyukysHDH8rP8U9qpP-dRjmjSkHljhOrcEqMUXGojR2JmvDQSZHBW8dN5wy7J13nN-FmY1GhDz8bz4JqgBPxgzO46rPua9jAcGjDL3nzzrar0cseHVr6uZjmCFUrHjtKqRE"
              alt="Google"
            />
            جوجل
          </button>
          <button
            type="button"
            className="flex items-center justify-center gap-2 bg-surface-container-lowest hover:bg-surface-container-high transition-colors rounded-xl py-3 border border-outline-variant/20 shadow-sm text-sm font-semibold text-on-surface-variant"
          >
            <Zap size={18} className="text-primary" />
            SSO
          </button>
        </div>

        <p className="mt-8 text-sm text-on-surface-variant text-center">
          جديد على المنصة؟{' '}
          <button
            type="button"
            className="text-primary font-bold hover:underline decoration-2 underline-offset-4"
            onClick={() => setPage('landing')}
          >
            إنشاء حساب
          </button>
        </p>
      </motion.div>
    </div>
  );
};
