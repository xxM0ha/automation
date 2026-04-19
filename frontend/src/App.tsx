import { useEffect, type ReactNode } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  LandingPage,
  LoginPage,
  DashboardPage,
  OrdersPage,
  MenuPage,
  ReportsPage,
  AppsPage,
} from './pages';
import { setAuth, clearAuth, type AuthUser } from './lib/api';
import { useUser, setUser, registerLogout } from './lib/authStore';
import type { Page } from './types';

function AnimatedRoute({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 1.02 }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const user = useUser();
  const { pathname } = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: pathname }} replace />;
  return <>{children}</>;
}

function RequireGuest({ children }: { children: ReactNode }) {
  const user = useUser();
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  const user = useUser();
  const navigate = useNavigate();
  const location = useLocation();

  const setPage = (page: Page) => navigate(page === 'landing' ? '/' : `/${page}`);

  const handleLogin = (u: AuthUser) => {
    setAuth(u);
    setUser(u);
    const from = (location.state as { from?: string })?.from;
    navigate(from && from !== '/login' && from !== '/' ? from : '/dashboard', { replace: true });
  };

  const handleLogout = () => {
    clearAuth();
    setUser(null);
    navigate('/', { replace: true });
  };

  useEffect(() => { registerLogout(handleLogout); }, []);

  useEffect(() => {
    const handler = () => {
      setUser(null);
      navigate('/', { replace: true });
    };
    window.addEventListener('prime:unauthorized', handler);
    return () => window.removeEventListener('prime:unauthorized', handler);
  }, [navigate]);

  const role = user?.role ?? 'kitchen';

  return (
    <div className="min-h-screen">
      <Routes>
        <Route path="/" element={
          <AnimatedRoute>
            <RequireGuest><LandingPage setPage={setPage} /></RequireGuest>
          </AnimatedRoute>
        } />
        <Route path="/login" element={
          <AnimatedRoute>
            <RequireGuest><LoginPage setPage={setPage} onLogin={handleLogin} /></RequireGuest>
          </AnimatedRoute>
        } />
        <Route path="/dashboard" element={
          <AnimatedRoute>
            <RequireAuth><DashboardPage setPage={setPage} role={role} onLogout={handleLogout} /></RequireAuth>
          </AnimatedRoute>
        } />
        <Route path="/orders" element={
          <AnimatedRoute>
            <RequireAuth><OrdersPage setPage={setPage} /></RequireAuth>
          </AnimatedRoute>
        } />
        <Route path="/menu" element={
          <AnimatedRoute>
            <RequireAuth><MenuPage setPage={setPage} /></RequireAuth>
          </AnimatedRoute>
        } />
        <Route path="/reports" element={
          <AnimatedRoute>
            <RequireAuth><ReportsPage setPage={setPage} /></RequireAuth>
          </AnimatedRoute>
        } />
        <Route path="/apps" element={
          <AnimatedRoute>
            <RequireAuth><AppsPage setPage={setPage} /></RequireAuth>
          </AnimatedRoute>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
