import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type SideMenuApi = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

const SideMenuCtx = createContext<SideMenuApi | null>(null);

export function SideMenuProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const value = useMemo<SideMenuApi>(() => ({ isOpen, open, close }), [isOpen, open, close]);
  return <SideMenuCtx.Provider value={value}>{children}</SideMenuCtx.Provider>;
}

export function useSideMenu() {
  const ctx = useContext(SideMenuCtx);
  if (!ctx) throw new Error('useSideMenu must be used inside <SideMenuProvider>');
  return ctx;
}
