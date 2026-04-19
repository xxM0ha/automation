import { Receipt, RefreshCw, TrendingUp, Globe, Terminal, Share2, ArrowLeft, Play } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { TopNav } from '../components/layout/TopNav';
import type { Page } from '../types';

interface LandingPageProps {
  setPage: (p: Page) => void;
}

const features = [
  {
    icon: Receipt,
    title: 'تكامل نقاط البيع',
    desc: 'اتصال مباشر بنظام نقاط البيع الحالي لديك. لا مزيد من الإدخال اليدوي أو التعامل المزدوج مع الطلبات.',
    highlight: false,
  },
  {
    icon: RefreshCw,
    title: 'مزامنة فورية',
    desc: 'تزامن المخزون والتوافر عبر أوبر إيتس ودورداش وجميع المنصات بشكل فوري.',
    highlight: true,
  },
  {
    icon: TrendingUp,
    title: 'تحليلات متعمقة',
    desc: 'افهم هوامش ربحك لكل منصة وحسّن قائمتك بناءً على بيانات دقيقة.',
    highlight: false,
  },
];

export const LandingPage = ({ setPage }: LandingPageProps) => (
  <div className="bg-surface min-h-screen">
    <TopNav setPage={setPage} currentPage="landing" />
    <main>
      {/* Hero */}
      <section className="relative px-6 md:px-8 pt-16 pb-28 overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
          <div className="absolute top-[-10%] right-[-5%] w-[40%] h-[60%] bg-primary/5 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-[-5%] w-[30%] h-[40%] bg-primary-container/10 rounded-full blur-3xl" />
        </div>

        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center relative z-10">
          {/* Text */}
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-block px-4 py-1.5 bg-blue-50 text-primary text-xs font-bold rounded-full mb-6 tracking-wide">
              🚀 منصة الأتمتة الرائدة للمطاعم
            </span>
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-black text-on-surface leading-tight mb-6">
              أتمت نمو{' '}
              <span className="text-gradient">مطعمك</span>{' '}
              الآن
            </h1>
            <p className="text-lg md:text-xl text-on-surface-variant mb-10 leading-relaxed max-w-xl">
              ادمج جميع تطبيقات التوصيل في لوحة تحكم واحدة. توقف عن الإدارة اليدوية وابدأ في توسيع إمبراطوريتك الغذائية بأتمتة ذكية في الوقت الفعلي.
            </p>
            <div className="flex flex-wrap gap-4">
              <Button size="lg" onClick={() => setPage('login')}>
                ابدأ تجربتك المجانية
                <ArrowLeft size={20} />
              </Button>
              <Button variant="secondary" size="lg" onClick={() => setPage('dashboard')}>
                <Play size={18} />
                مشاهدة العرض التوضيحي
              </Button>
            </div>

            {/* Trust badges */}
            <div className="flex flex-wrap items-center gap-6 mt-10 pt-10 border-t border-slate-100">
              {[
                { value: '+2,400', label: 'مطعم نشط' },
                { value: '98.4%', label: 'معدل الرضا' },
                { value: '+24%', label: 'نمو الإيرادات' },
              ].map((s) => (
                <div key={s.label} className="text-center">
                  <div className="text-2xl font-black text-primary">{s.value}</div>
                  <div className="text-xs text-on-surface-variant font-medium mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Dashboard preview */}
          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="relative"
          >
            <div className="bg-surface-container-lowest p-5 rounded-2xl shadow-2xl border border-outline-variant/20 relative z-10">
              <img
                className="w-full h-auto rounded-xl"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuASRWI5C_xBtCqeD3I-iBtq12LfKx8p9gb-wWu27WIaQnlhSh9VP_xfxndkh_oJY7_1u0u2gGByZQtBxnnlVfJOnTtxV70DSw16E5l51DCtd3RO_PWR3EsP3VjZB8x12WIKXKM8WyZNcVYpKviAKVXvSnl7B64P544EI_UjTkYLeFDd8Zrw7BjAcwy_XwqrWPBBJ15ClX99rDt_l5vC0sBV-SwnLWmUACWCOiLwwe1l1C8LStDCeMYdTfUrZ70covnpliR80AAZlf8"
                alt="معاينة لوحة التحكم"
              />
            </div>
            {/* Floating badge */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.6 }}
              className="absolute -bottom-5 -right-4 bg-primary text-white p-5 rounded-2xl shadow-xl shadow-primary/30"
            >
              <div className="text-xs font-semibold opacity-80 mb-1">توفير فوري</div>
              <div className="text-2xl font-black">+24% إيرادات</div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 bg-surface-container-low px-6 md:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-primary font-bold text-xs uppercase tracking-widest">الإمكانيات</span>
            <h2 className="text-4xl md:text-5xl font-black mt-4 text-on-surface">
              ميزات قوية للمطابخ الحديثة
            </h2>
            <p className="text-on-surface-variant mt-4 max-w-2xl mx-auto text-lg">
              كل ما تحتاجه لإدارة مطعمك بكفاءة عالية من مكان واحد
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {features.map((f) => (
              <Card
                key={f.title}
                className={f.highlight ? 'p-10 border-2 border-primary/20 shadow-xl shadow-primary/5' : 'p-10'}
              >
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-8 ${f.highlight ? 'bg-primary text-white' : 'bg-primary/10'}`}>
                  <f.icon className={f.highlight ? 'text-white' : 'text-primary'} size={32} />
                </div>
                <h3 className="text-2xl font-bold mb-4">{f.title}</h3>
                <p className="text-on-surface-variant leading-relaxed">{f.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Banner */}
      <section className="py-20 px-6 md:px-8 bg-primary-gradient">
        <div className="max-w-4xl mx-auto text-center text-white">
          <h2 className="text-4xl font-black mb-4">ابدأ اليوم مجاناً</h2>
          <p className="text-blue-100 text-lg mb-8">لا يلزم بطاقة ائتمان · إعداد خلال 5 دقائق · دعم على مدار الساعة</p>
          <Button variant="secondary" size="lg" className="bg-white text-primary hover:bg-slate-50" onClick={() => setPage('login')}>
            إنشاء حساب مجاني
            <ArrowLeft size={20} />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full border-t border-slate-200 bg-slate-50 px-10 py-12">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div>
            <div className="font-black text-slate-900 text-2xl mb-1">برايم أوتوميشن</div>
            <p className="text-slate-500 text-xs">© 2024 برايم أوتوميشن. جميع الحقوق محفوظة.</p>
          </div>
          <div className="flex gap-10 text-sm">
            {['الخصوصية', 'الشروط', 'الأمان', 'تواصل معنا'].map((l) => (
              <a key={l} className="text-slate-500 hover:text-primary transition-colors" href="#">{l}</a>
            ))}
          </div>
          <div className="flex gap-4">
            {[Globe, Terminal, Share2].map((Icon, i) => (
              <button key={i} className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-primary hover:border-primary/30 transition-all shadow-sm">
                <Icon size={18} />
              </button>
            ))}
          </div>
        </div>
      </footer>
    </main>
  </div>
);
