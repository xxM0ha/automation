import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  SUPPORTED_SCHEMA_VERSION,
  type AutomationConfig,
  type PlatformConfig,
} from './config.types';
import { useSession } from '../state/SessionContext';
import {
  fetchRemoteConfig,
  loadCachedConfig,
  saveCachedConfig,
} from './configApi';

/** Where the active config came from. */
export type ConfigSource = 'local' | 'remote';

type ConfigContextValue = {
  /** The active automation config the whole app reads from. */
  config: AutomationConfig;
  /** 'local' for the bundled/cached fallback; 'remote' once the server answers. */
  source: ConfigSource;
  /** True if the loaded config needs a newer app than this build. */
  schemaMismatch: boolean;
  /** Look up one platform's config by slug. */
  getPlatform: (slug: string) => PlatformConfig | undefined;
  /** Re-fetch the config from the server (falls back on failure). */
  reload: () => Promise<void>;
};

const AutomationConfigContext = createContext<ConfigContextValue | null>(null);

/**
 * Empty placeholder held until the backend config loads. The app ships NO
 * bundled config document — automation is fully server-driven; this just keeps
 * the shape valid so the UI renders (with no platforms) until the cached or
 * remote config arrives.
 */
const EMPTY_CONFIG: AutomationConfig = {
  schemaVersion: SUPPORTED_SCHEMA_VERSION,
  updatedAt: '',
  platforms: [],
};

/**
 * Loads the automation config and exposes it app-wide.
 *
 * Config is fully server-driven. On mount we seed from the last good remote
 * config in secure storage (so a relaunch starts from the server's config even
 * before the network answers); then — whenever a session exists — fetch
 * GET /api/app-config/ and use that, caching it for next time. Until that
 * resolves (and on a fresh/offline launch) the app holds EMPTY_CONFIG, so there
 * are simply no flows to run until the backend responds.
 */
export function AutomationConfigProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [config, setConfig] = useState<AutomationConfig>(EMPTY_CONFIG);
  const [source, setSource] = useState<ConfigSource>('local');

  // On mount, seed from the cached remote config if we have one, so a relaunch
  // uses the last server config even before the network fetch completes.
  useEffect(() => {
    let active = true;
    loadCachedConfig().then((cached) => {
      if (active && cached) setConfig(cached);
    });
    return () => {
      active = false;
    };
  }, []);

  // Fetch from the server whenever the session changes (e.g. after login).
  // On success: use it and cache it. On failure: keep the current config
  // (cached remote if we had one, else bundled) and mark the source 'local'.
  const refresh = useCallback(async () => {
    if (!session) {
      setSource('local');
      return;
    }
    const remote = await fetchRemoteConfig(session);
    if (remote) {
      setConfig(remote);
      setSource('remote');
      void saveCachedConfig(remote);
    } else {
      setSource('local');
    }
  }, [session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reload = useCallback(() => refresh(), [refresh]);

  const getPlatform = useCallback(
    (slug: string) => config.platforms.find((p) => p.platform === slug),
    [config],
  );

  const schemaMismatch = config.schemaVersion > SUPPORTED_SCHEMA_VERSION;

  return (
    <AutomationConfigContext.Provider
      value={{ config, source, schemaMismatch, getPlatform, reload }}
    >
      {children}
    </AutomationConfigContext.Provider>
  );
}

export function useAutomationConfig(): ConfigContextValue {
  const ctx = useContext(AutomationConfigContext);
  if (!ctx) {
    throw new Error('useAutomationConfig must be used within an AutomationConfigProvider');
  }
  return ctx;
}
