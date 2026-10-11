/**
 * JS side of the device error log.
 *
 * The log itself lives in Kotlin (see DeviceLog.kt): it keeps the engine's
 * recent lines, captures the screen, queues reports on disk and uploads them
 * to the backend's /api/device-logs/. This file only tells it where to upload
 * (the logged-in session) and feeds it the errors that happen in JS — FCM,
 * config fetch, an uncaught exception — which the native engine never sees.
 *
 * Every function here is safe to call without the native module (Expo Go, web)
 * and never throws: reporting an error must not cause another one.
 */
import PrimeNative from '../../modules/prime-native';
import { loadSession, type Session } from './auth';

/** Where a JS-side error came from; shown as the entry's kind on the dashboard. */
export type DeviceErrorKind = 'app' | 'crash';

/** Point the log at the logged-in account, or clear it on logout. */
export function configureDeviceLog(session: Session | null): void {
  try {
    PrimeNative?.configureDeviceLog(session?.baseUrl ?? null, session?.token ?? null).catch(() => {});
  } catch {
    // native module missing or an older build without the method
  }
}

/**
 * Configure from the session in secure storage. For the headless FCM handler,
 * which runs without the React tree that normally does this on login.
 */
export async function configureDeviceLogFromStoredSession(): Promise<void> {
  try {
    configureDeviceLog(await loadSession());
  } catch {
    // best-effort
  }
}

/** Record an error that happened in JS. `platform` is the task slug, if any. */
export function reportDeviceError(message: string, platform = '', kind: DeviceErrorKind = 'app'): void {
  try {
    PrimeNative?.reportDeviceError(platform, kind, message).catch(() => {});
  } catch {
    // native module missing or an older build without the method
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** Convenience for catch blocks: "<what failed> · <why>". */
export function reportCaught(what: string, error: unknown, platform = ''): void {
  reportDeviceError(`${what} · ${describe(error)}`, platform);
}

let installed = false;

/** Report uncaught JS exceptions, then hand them to React Native as before. */
export function installGlobalErrorReporter(): void {
  if (installed) return;
  installed = true;
  const errorUtils = (globalThis as any).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return;
  const previous = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    const stack = error instanceof Error && error.stack ? `\n${error.stack.slice(0, 1200)}` : '';
    reportDeviceError(`${isFatal ? 'خطأ قاتل في التطبيق' : 'خطأ في التطبيق'} · ${describe(error)}${stack}`, '', 'crash');
    previous?.(error, isFatal);
  });
}
