import type { ReactNode } from 'react';
import { motion } from 'motion/react';

/* ordo wordmark — lowercase geometric Latin with the lime accent. */
const Wordmark = ({ className = '' }: { className?: string }) => (
  <span className={`wordmark inline-flex items-baseline text-white ${className}`}>
    ord<span className="text-lime">o</span>
  </span>
);

/* قوس القبول — the acceptance arc. */
const AcceptArc = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 520 520" fill="none" className={className} aria-hidden="true">
    <path d="M250 26 A234 234 0 0 1 494 250" stroke="#90f018" strokeWidth="34" strokeLinecap="round" />
    <path d="M494 250 A234 234 0 0 1 250 494" stroke="#90f018" strokeWidth="2" strokeOpacity="0.45" />
  </svg>
);

interface AuthShellProps {
  title: string;
  children: ReactNode;
}

export const AuthShell = ({ title, children }: AuthShellProps) => (
  <div className="min-h-screen bg-ink text-white flex items-center justify-center relative overflow-hidden px-6 py-10">
    <AcceptArc className="pointer-events-none absolute -top-44 -left-44 w-[34rem] h-[34rem] opacity-90" />
    <AcceptArc className="pointer-events-none absolute -bottom-52 -right-48 w-[30rem] h-[30rem] rotate-180 opacity-30" />

    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="relative z-10 w-full max-w-md"
    >
      <div className="text-center mb-7">
        <Wordmark className="text-4xl" />
        <p className="text-white/50 text-sm mt-3">{title}</p>
      </div>

      <div className="bg-paper text-on-surface rounded-2xl shadow-2xl p-8 md:p-10">
        {children}
      </div>

      <p className="text-center text-white/30 text-xs mt-6">كل طلب، مقبولٌ في وقته.</p>
    </motion.div>
  </div>
);
