import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  clearSession,
  loadSession,
  login,
  saveSession,
  type Session,
} from '../lib/auth';
import { configureDeviceLog } from '../lib/deviceLog';

type SessionApi = {
  session: Session | null;
  loading: boolean;
  signIn: (baseUrl: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionCtx = createContext<SessionApi | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    loadSession()
      .then((s) => {
        if (active) setSession(s);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Device errors are uploaded under the logged-in account; anything queued
  // while logged out (or offline) is flushed once this is set.
  useEffect(() => {
    if (!loading) configureDeviceLog(session);
  }, [session, loading]);

  const signIn = useCallback(
    async (baseUrl: string, email: string, password: string) => {
      const s = await login(baseUrl, email, password);
      await saveSession(s);
      setSession(s);
    },
    [],
  );

  const signOut = useCallback(async () => {
    await clearSession();
    setSession(null);
  }, []);

  const value = useMemo<SessionApi>(
    () => ({ session, loading, signIn, signOut }),
    [session, loading, signIn, signOut],
  );

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
