import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getSelectedApp, setSelectedApp as persist } from '../lib/deviceApp';

type DeviceAppApi = {
  /** The selected delivery app's targetPackage, or null if not chosen yet. */
  selectedApp: string | null;
  /** True while loading the saved selection on mount. */
  loading: boolean;
  /** Choose which app this device runs. */
  selectApp: (targetPackage: string) => Promise<void>;
};

const DeviceAppCtx = createContext<DeviceAppApi | null>(null);

export function DeviceAppProvider({ children }: { children: ReactNode }) {
  const [selectedApp, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getSelectedApp()
      .then((v) => {
        if (active) setSelected(v);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectApp = useCallback(async (targetPackage: string) => {
    await persist(targetPackage);
    setSelected(targetPackage);
  }, []);

  const value = useMemo<DeviceAppApi>(
    () => ({ selectedApp, loading, selectApp }),
    [selectedApp, loading, selectApp],
  );

  return <DeviceAppCtx.Provider value={value}>{children}</DeviceAppCtx.Provider>;
}

export function useDeviceApp() {
  const ctx = useContext(DeviceAppCtx);
  if (!ctx) throw new Error('useDeviceApp must be used inside <DeviceAppProvider>');
  return ctx;
}
