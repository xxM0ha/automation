import { motion } from 'motion/react';
import { ArrowLeft, Download, Link2, Zap, CheckCircle2, ChevronLeft } from 'lucide-react';
import type { Page } from '../types';

interface LandingPageProps {
  setPage: (p: Page) => void;
}

/* ── ordo wordmark — lowercase geometric Latin (brand mark) ────────────── */
const Wordmark = ({ className = '', tone = 'light' }: { className?: string; tone?: 'light' | 'dark' }) => (
  <span className={`wordmark inline-flex items-baseline ${tone === 'light' ? 'text-white' : 'text-ink'} ${className}`}>
    ord<span className="text-lime">o</span>
  </span>
);

/* ── قوس القبول — the acceptance arc, the signature brand graphic ──────── */
const AcceptArc = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 520 520" fill="none" className={className} aria-hidden="true">
    {/* thick lime arc — the order being "caught" */}
    <path d="M250 26 A234 234 0 0 1 494 250" stroke="#90f018" strokeWidth="34" strokeLinecap="round" />
    {/* thin hairline continuing the circle inward */}
    <path d="M494 250 A234 234 0 0 1 250 494" stroke="#90f018" strokeWidth="2" strokeOpacity="0.45" />
  </svg>
);

const ORDERS = [
  { id: '4821', app: 'توترز', items: '2× مارغريتا · 1× خبز بالثوم', t: '0.4 ث' },
  { id: '4822', app: 'بلي', items: '1× باد تاي · 1× سبرينغ رول', t: '0.3 ث' },
  { id: '4823', app: 'يمك', items: '3× تشيز برغر · 2× بطاطا', t: '0.5 ث' },
];

const PROMISE = [
  { icon: Link2, title: 'لا شيء يفوت', desc: 'كل طلبٍ وارد يُقبل تلقائياً عبر كل تطبيق توصيل — حتى وسط الزحام.' },
  { icon: Zap, title: 'لا شيء ينتظر', desc: 'القبول يحدث لحظة وصول الطلب، فلا تتسبّب أوقات التأكيد في أي إلغاء.' },
  { icon: CheckCircle2, title: 'لا شيء يُدار', desc: 'لا أجهزة تُراقَب ولا أزرار تُضغط. يعمل Ordo بهدوء بين التطبيقات ونظامك.' },
];

const APPS = ['بلي', 'توترز', 'طلبات', 'ليزو', 'يمك', 'طلباتي'];

export const LandingPage = ({ setPage }: LandingPageProps) => (
  <div className="bg-paper min-h-screen">
    {/* ── Header (dark) ──────────────────────────────────────────────── */}
    <header className="sticky top-0 z-50 bg-ink/90 backdrop-blur-md border-b border-white/5">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Wordmark className="text-2xl" />
        <nav className="hidden md:flex items-center gap-1 text-sm text-white/60">
          {[
            { label: 'المنتج', href: '#promise' },
            { label: 'كيف يعمل', href: '#how' },
            { label: 'التطبيقات', href: '#apps' },
          ].map((l) => (
            <a key={l.href} href={l.href} className="px-4 py-2 rounded-lg hover:text-white hover:bg-white/5 transition-colors">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage('login')}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white/80 hover:bg-white/5 transition-colors"
          >
            دخول
          </button>
          <button
            onClick={() => setPage('register')}
            className="px-4 py-2 rounded-xl text-sm font-bold bg-lime text-ink hover:brightness-105 transition-all"
          >
            إنشاء حساب
          </button>
        </div>
      </div>
    </header>

    <main>
      {/* ── Hero (dark) ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-ink text-white">
        <AcceptArc className="pointer-events-none absolute -top-40 -left-40 w-[34rem] h-[34rem] opacity-90" />
        <div className="relative z-10 max-w-7xl mx-auto px-6 py-20 lg:py-28 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Text */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-block px-3.5 py-1.5 rounded-full bg-white/5 border border-white/10 text-white/70 text-xs font-semibold mb-7">
              قبولٌ آليّ للطلبات، خاصٌّ بالمطاعم
            </span>
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold leading-[1.12] mb-6">
              كل طلب،
              <br />
              <span className="text-lime">مقبولٌ في وقته.</span>
            </h1>
            <p className="text-lg text-white/60 leading-relaxed max-w-xl mb-9">
              يربط Ordo تطبيقات التوصيل مباشرةً بنظام نقاط البيع لديك، ويقبل كل طلبٍ لحظة وصوله —
              بلا أجهزة تُراقَب ولا تأكيدات متأخرة.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setPage('register')}
                className="flex items-center gap-2 px-7 py-4 rounded-xl text-base font-bold bg-lime text-ink hover:brightness-105 active:scale-95 transition-all"
              >
                اربط نظام نقاط بيعك
                <ArrowLeft size={18} />
              </button>
              <button
                onClick={() => { window.location.href = '/ordo.apk'; }}
                className="flex items-center gap-2 px-7 py-4 rounded-xl text-base font-bold border border-white/15 text-white hover:bg-white/5 active:scale-95 transition-all"
              >
                <Download size={18} />
                تحميل التطبيق
              </button>
            </div>
            <p className="text-xs text-white/40 mt-4">متوفر لأجهزة Android · فعّل «التثبيت من مصادر غير معروفة»</p>
          </motion.div>

          {/* Product preview — the live-orders card (mono + one lime accent) */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="relative"
          >
            <div className="rounded-2xl bg-graphite/60 border border-white/10 p-5 shadow-2xl backdrop-blur-sm">
              <div className="flex items-center justify-between mb-5">
                <span className="font-bold text-white text-lg">الطلبات المباشرة</span>
                <Wordmark className="text-base" />
              </div>
              <div className="space-y-3">
                {ORDERS.map((o) => (
                  <div key={o.id} className="rounded-xl bg-white/[0.03] border border-white/10 p-4">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-lime text-ink">مقبول</span>
                      <span className="text-xs text-white/45">{o.app} · #{o.id}</span>
                    </div>
                    <p className="text-sm text-white/85">{o.items}</p>
                    <p className="text-[11px] text-white/40 mt-1">قُبل خلال {o.t}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── How it works (light) ─────────────────────────────────────── */}
      <section id="how" className="bg-smoke px-6 py-20 md:py-24">
        <div className="max-w-5xl mx-auto text-center">
          <span className="text-xs font-bold uppercase tracking-widest text-slate">كيف يعمل</span>
          <h2 className="text-3xl md:text-4xl font-extrabold text-ink mt-3 mb-12">من التطبيق إلى المطبخ — بلا توقّف</h2>
          <div className="flex flex-col md:flex-row items-stretch justify-center gap-3">
            {[
              { t: 'تطبيقات التوصيل', d: 'الطلبات تصل بلا توقّف' },
              { t: 'Ordo يقبل فوراً', d: 'لحظة وصول الطلب', accent: true },
              { t: 'نظام نقاط البيع', d: 'المطبخ يبدأ الطهي' },
            ].map((s, i, arr) => (
              <div key={s.t} className="flex items-center gap-3 flex-1">
                <div className={`flex-1 rounded-2xl border p-6 text-center ${s.accent ? 'bg-ink text-white border-ink' : 'bg-paper border-mist'}`}>
                  <div className={`font-bold text-lg ${s.accent ? 'text-lime' : 'text-ink'}`}>{s.t}</div>
                  <div className={`text-sm mt-1 ${s.accent ? 'text-white/60' : 'text-slate'}`}>{s.d}</div>
                </div>
                {i < arr.length - 1 && <ChevronLeft className="hidden md:block text-slate shrink-0" size={22} />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── The promise, in three parts (light) ──────────────────────── */}
      <section id="promise" className="bg-paper px-6 py-20 md:py-28">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-2xl mb-14">
            <span className="text-xs font-bold uppercase tracking-widest text-slate">الوعد في ثلاثة أجزاء</span>
            <h2 className="text-3xl md:text-5xl font-extrabold text-ink mt-3">
              للمطاعم التي لا تستطيع أن تفوّت طلباً.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PROMISE.map((f) => (
              <div key={f.title} className="rounded-2xl border border-mist bg-paper p-8 transition-all hover:border-forest/30 hover:shadow-lg hover:shadow-ink/5">
                <div className="w-12 h-12 rounded-xl bg-lime/15 flex items-center justify-center mb-6">
                  <f.icon className="text-forest" size={22} />
                </div>
                <h3 className="text-xl font-bold text-ink mb-2">{f.title}</h3>
                <p className="text-slate leading-relaxed text-[15px]">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Apps strip ───────────────────────────────────────────────── */}
      <section id="apps" className="bg-smoke px-6 py-16">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-sm font-semibold text-slate mb-6">يعمل مع تطبيقات التوصيل في العراق</p>
          <div className="flex flex-wrap justify-center gap-3">
            {APPS.map((a) => (
              <span key={a} className="px-5 py-2.5 rounded-full bg-paper border border-mist text-ink font-bold text-sm">
                {a}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Download CTA (dark) ───────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-ink text-white px-6 py-24">
        <AcceptArc className="pointer-events-none absolute -bottom-48 -right-44 w-[34rem] h-[34rem] rotate-180 opacity-90" />
        <div className="relative z-10 max-w-3xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-extrabold leading-tight mb-4">
            الطلب الفائت زبونٌ ضائع.
            <br />
            <span className="text-lime">لذلك لا نفوّت طلباً أبداً.</span>
          </h2>
          <p className="text-white/55 text-lg mb-9">حمّل تطبيق Ordo وابدأ بقبول كل طلبٍ لحظة وصوله.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              onClick={() => { window.location.href = '/ordo.apk'; }}
              className="flex items-center gap-2 px-8 py-4 rounded-xl text-base font-bold bg-lime text-ink hover:brightness-105 active:scale-95 transition-all"
            >
              <Download size={18} />
              تحميل التطبيق
            </button>
            <button
              onClick={() => setPage('register')}
              className="flex items-center gap-2 px-8 py-4 rounded-xl text-base font-bold border border-white/15 text-white hover:bg-white/5 active:scale-95 transition-all"
            >
              إنشاء حساب
              <ArrowLeft size={18} />
            </button>
          </div>
        </div>
      </section>

      {/* ── Footer (dark) ─────────────────────────────────────────────── */}
      <footer className="bg-ink border-t border-white/5 px-6 py-12">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-center md:text-right">
            <Wordmark className="text-2xl" />
            <p className="text-white/40 text-sm mt-1.5">كل طلب، مقبولٌ في وقته.</p>
          </div>
          <div className="flex gap-8 text-sm text-white/50">
            {['الخصوصية', 'الشروط', 'تواصل معنا'].map((l) => (
              <a key={l} href="#" className="hover:text-white transition-colors">{l}</a>
            ))}
          </div>
          <p className="text-white/30 text-xs">© 2026 Ordo · جميع الحقوق محفوظة</p>
        </div>
      </footer>
    </main>
  </div>
);
