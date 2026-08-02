import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import PrimeNative from '../../modules/prime-native';
import type { EngineLogPayload, EngineStatePayload } from '../../modules/prime-native';
import { useAutomationConfig } from './AutomationConfigContext';
import { useDeviceApp } from '../state/DeviceAppContext';
import { useSession } from '../state/SessionContext';
import { createDryRunExecutor } from './dryRunExecutor';
import { runLoop, type RunLogEntry } from './interpreter';

const MAX_LOG_ENTRIES = 200;

/** What mode the engine is using to execute a platform's flow. */
export type EngineMode = 'native' | 'dry';

/** Status of one platform's engine. */
export type EngineStatus = 'idle' | 'running' | 'paused' | 'error';

export type EnginePlatformState = {
  status: EngineStatus;
  mode: EngineMode | null;
  startedAt: number | null;
  iterationCount: number;
  /** Tail of the engine log (most recent entries). */
  log: RunLogEntry[];
  lastError: string | null;
};

type DryHandle = {
  kind: 'dry';
  abort: () => void;
};

type NativeHandle = {
  kind: 'native';
};

type RunHandle = DryHandle | NativeHandle;

const DEFAULT_STATE: EnginePlatformState = {
  status: 'idle',
  mode: null,
  startedAt: null,
  iterationCount: 0,
  log: [],
  lastError: null,
};

type EngineContextValue = {
  /** Map of platformSlug -> state. Missing slugs are treated as idle. */
  platforms: Record<string, EnginePlatformState>;
  /** True if any platform is currently running. */
  anyRunning: boolean;
  start: (platformSlug: string, mode: EngineMode) => void;
  stop: (platformSlug: string) => void;
  /** Stop a task then start it again (recovers a stuck/slow run). */
  restart: (platformSlug: string) => void;
  /** Pause a running task between iterations (native mode). */
  pause: (platformSlug: string) => void;
  /** Resume a paused task. */
  resume: (platformSlug: string) => void;
  /** Convenience: state for one platform, defaulted. */
  stateOf: (platformSlug: string) => EnginePlatformState;
};

const EngineContext = createContext<EngineContextValue | null>(null);

export function EngineProvider({ children }: { children: ReactNode }) {
  const { getPlatform, config } = useAutomationConfig();
  const { selectedApp } = useDeviceApp();
  const { session } = useSession();
  const [platforms, setPlatforms] = useState<Record<string, EnginePlatformState>>({});
  /** Live handles per platform — used to stop runs. */
  const handles = useRef<Record<string, RunHandle>>({});
  /** Monotonic id source for log entries we synthesize from native events. */
  const nextLogId = useRef(1);

  const patch = useCallback(
    (slug: string, partial: Partial<EnginePlatformState>) => {
      setPlatforms((prev) => ({
        ...prev,
        [slug]: { ...(prev[slug] ?? DEFAULT_STATE), ...partial },
      }));
    },
    [],
  );

  const appendLog = useCallback((slug: string, entry: RunLogEntry) => {
    setPlatforms((prev) => {
      const current = prev[slug] ?? DEFAULT_STATE;
      const log = current.log.length >= MAX_LOG_ENTRIES
        ? [...current.log.slice(-MAX_LOG_ENTRIES + 1), entry]
        : [...current.log, entry];
      return { ...prev, [slug]: { ...current, log } };
    });
  }, []);

  // ---- Native engine event wiring -----------------------------------------
  // Subscribe once at provider mount; every onEngineLog / onEngineState from
  // the Kotlin engine updates whichever platform it names. This is how the
  // UI stays in sync while the actual loop runs off the JS thread.
  useEffect(() => {
    if (!PrimeNative) return;
    const logSub = PrimeNative.addListener('onEngineLog', (e: EngineLogPayload) => {
      // Mirror to console so the Metro terminal shows live engine activity.
      const indent = '  '.repeat(e.depth);
      // eslint-disable-next-line no-console
      console.log(`[engine:${e.platform}] ${indent}${e.message}`);
      appendLog(e.platform, {
        id: nextLogId.current++,
        ts: e.timestamp,
        level: e.level,
        message: e.message,
        depth: e.depth,
      });
    });
    const stateSub = PrimeNative.addListener('onEngineState', (e: EngineStatePayload) => {
      const partial: Partial<EnginePlatformState> = { status: e.status };
      if (e.status === 'running') partial.mode = 'native';
      if (e.status === 'idle' || e.status === 'error') partial.mode = null;
      if (e.iteration !== undefined) partial.iterationCount = e.iteration;
      if (e.error !== undefined) partial.lastError = e.error;
      if (e.status === 'idle') partial.lastError = null;
      if (e.status === 'idle' || e.status === 'error') {
        // Native run ended — clear our handle so a re-start can fire.
        if (handles.current[e.platform]?.kind === 'native') {
          delete handles.current[e.platform];
        }
      }
      patch(e.platform, partial);
    });
    return () => {
      logSub.remove();
      stateSub.remove();
    };
  }, [appendLog, patch]);

  const stop = useCallback(
    (slug: string) => {
      const handle = handles.current[slug];
      if (handle?.kind === 'native') {
        PrimeNative?.stopEngine(slug).catch(() => {});
        // The onEngineState 'idle' event will clear the handle & status.
        return;
      }
      if (handle?.kind === 'dry') {
        handle.abort();
        delete handles.current[slug];
      }
      patch(slug, { status: 'idle', mode: null, startedAt: null });
    },
    [patch],
  );

  const pause = useCallback(
    (slug: string) => {
      // Pause is a native-engine feature; the loop idles between iterations.
      if (handles.current[slug]?.kind === 'native') {
        PrimeNative?.pauseEngine(slug).catch(() => {});
        // The onEngineState 'paused' event updates status.
      }
    },
    [],
  );

  const resume = useCallback(
    (slug: string) => {
      if (handles.current[slug]?.kind === 'native') {
        PrimeNative?.resumeEngine(slug).catch(() => {});
      }
    },
    [],
  );

  const start = useCallback(
    (slug: string, mode: EngineMode) => {
      if (handles.current[slug]) return;
      const platform = getPlatform(slug);
      if (!platform) return;
      // Merge the shared backend block into the task so the engine can reach
      // the order webhook etc. The config's `restaurant` is global ("laffe"),
      // so override it with the logged-in account's slug — that's what routes
      // each device's orders to its own account (and Foodics branch).
      const accountSlug = session?.restaurant?.slug;
      const backend = config.backend
        ? { ...config.backend, ...(accountSlug ? { restaurant: accountSlug } : {}) }
        : undefined;
      const taskConfig = backend ? { ...platform, backend } : platform;

      // Reset the per-platform state for a fresh run.
      patch(slug, {
        status: 'running',
        mode,
        startedAt: Date.now(),
        iterationCount: 0,
        log: [],
        lastError: null,
      });

      if (mode === 'native') {
        if (!PrimeNative) {
          patch(slug, {
            status: 'error',
            mode: null,
            lastError: 'الوحدة الأصلية غير متاحة — يلزم تشغيل نسخة التطوير.',
          });
          return;
        }
        handles.current[slug] = { kind: 'native' };
        // Fire-and-forget — onEngineLog/onEngineState drive UI updates.
        PrimeNative.startEngine(taskConfig).catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          patch(slug, { status: 'error', mode: null, lastError: message });
          delete handles.current[slug];
        });
        return;
      }

      // Dry mode: still run the JS interpreter against the dry executor.
      // Lets the user exercise flows in Expo Go and verify the schema.
      let aborted = false;
      const handle: DryHandle = { kind: 'dry', abort: () => { aborted = true; } };
      handles.current[slug] = handle;
      let iter = 0;
      void (async () => {
        try {
          await runLoop({
            config: taskConfig,
            executor: createDryRunExecutor(),
            onLog: (entry) => {
              if (aborted) return;
              // Mirror to console so dry runs are visible in Metro too.
              const indent = '  '.repeat(entry.depth);
              // eslint-disable-next-line no-console
              console.log(`[engine:${slug}] ${indent}${entry.message}`);
              appendLog(slug, entry);
              if (entry.level === 'success' && entry.message.startsWith('اكتمل التدفق')) {
                iter += 1;
                patch(slug, { iterationCount: iter });
              }
              if (entry.level === 'error') {
                patch(slug, { lastError: entry.message });
              }
            },
            shouldAbort: () => aborted,
          });
        } finally {
          if (!aborted) {
            delete handles.current[slug];
            patch(slug, { status: 'idle', mode: null, startedAt: null });
          }
        }
      })();
    },
    [appendLog, getPlatform, patch, config, session],
  );

  const restart = useCallback(
    (slug: string) => {
      const mode: EngineMode = platforms[slug]?.mode ?? 'native';
      stop(slug);
      // stop() is async on native — the handle only clears once the engine
      // reports idle, and start() bails while a handle is live. Give the cancel
      // a moment to settle, then start fresh.
      setTimeout(() => start(slug, mode), 1500);
    },
    [platforms, stop, start],
  );

  const stateOf = useCallback(
    (slug: string) => platforms[slug] ?? DEFAULT_STATE,
    [platforms],
  );

  const anyRunning = useMemo(
    () => Object.values(platforms).some((s) => s.status === 'running'),
    [platforms],
  );

  // Drive the foreground service from the high-level "any running?" state.
  // The service has one job: keep the app process alive in the background so
  // the Kotlin engine coroutine is not collected.
  useEffect(() => {
    if (!PrimeNative) return;
    if (anyRunning) {
      PrimeNative.startEngineService('محرّك الأتمتة يعمل').catch(() => {});
      return;
    }
    // Debounce the stop. Queued runs flip `anyRunning` false→true between each
    // run; stopping then immediately restarting the foreground service races
    // startForegroundService() against stopSelf() and crashes the app
    // ("did not then call Service.startForeground()"). Waiting a few seconds
    // before stopping lets the next queued run keep the service alive instead.
    const t = setTimeout(() => {
      PrimeNative?.stopEngineService().catch(() => {});
    }, 5000);
    return () => clearTimeout(t);
  }, [anyRunning]);

  // Abort all runs on unmount so a hot-reload doesn't leak loops.
  useEffect(() => {
    return () => {
      for (const handle of Object.values(handles.current)) {
        if (handle.kind === 'dry') handle.abort();
      }
      handles.current = {};
      PrimeNative?.stopAllEngines().catch(() => {});
    };
  }, []);

  // Config-driven autostart: on first load, start any task whose `control` is
  // "running" (native engine). Tasks default to manual control. This is how
  // the config decides what runs; the backend will set `control` later.
  const didAutostart = useRef(false);
  useEffect(() => {
    if (didAutostart.current) return;
    if (!PrimeNative) return; // native engine only
    if (!selectedApp) return; // wait until this device's app is chosen
    didAutostart.current = true;
    // Only autostart the tasks belonging to THIS device's chosen app.
    for (const p of config.platforms) {
      if (p.control === 'running' && p.targetPackage === selectedApp) {
        start(p.platform, 'native');
      }
    }
  }, [config, start, selectedApp]);

  const value = useMemo<EngineContextValue>(
    () => ({ platforms, anyRunning, start, stop, restart, pause, resume, stateOf }),
    [platforms, anyRunning, start, stop, restart, pause, resume, stateOf],
  );

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useEngine(): EngineContextValue {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useEngine must be used within an EngineProvider');
  return ctx;
}
