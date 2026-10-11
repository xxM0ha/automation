/**
 * Fetching + caching for the server-driven automation config.
 *
 * The app ships no bundled config — when a session exists we fetch the latest
 * document from the backend's /api/app-config/ endpoint and cache the last good
 * one in secure storage so a relaunch can start from the server's config before
 * the network call returns.
 * Only the loader lives here; the schema (config.types.ts) stays the source of
 * truth for the shape.
 */
import * as SecureStore from 'expo-secure-store';
import type { Session } from '../lib/auth';
import type { AutomationConfig } from './config.types';
import { reportCaught, reportDeviceError } from '../lib/deviceLog';

/** Secure-store key for the last good remote config document. */
const CONFIG_KEY = 'prime.config';

/**
 * Loosely validate that an unknown value is shaped like an AutomationConfig:
 * an object with a numeric `schemaVersion` and a `platforms` array. We trust
 * the backend for the rest; this just guards against obviously bad payloads.
 */
function isAutomationConfig(value: unknown): value is AutomationConfig {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Record<string, unknown>;
  return (
    typeof doc.schemaVersion === 'number' && Array.isArray(doc.platforms)
  );
}

/**
 * Fetch the active config from the backend for the given session.
 * Returns the parsed config on success, or null on any failure (network
 * error, non-2xx, unparseable JSON, or wrong shape) so callers can fall back.
 */
export async function fetchRemoteConfig(
  session: Session,
): Promise<AutomationConfig | null> {
  let res: Response;
  try {
    res = await fetch(`${session.baseUrl}/api/app-config/`, {
      headers: {
        Authorization: `Token ${session.token}`,
        Accept: 'application/json',
      },
    });
  } catch (e) {
    reportCaught('تعذّر جلب إعدادات الأتمتة من الخادم', e);
    return null;
  }

  if (!res.ok) {
    reportDeviceError(`فشل جلب إعدادات الأتمتة · HTTP ${res.status}`);
    return null;
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (e) {
    reportCaught('إعدادات الأتمتة ليست JSON صالحاً', e);
    return null;
  }

  if (!isAutomationConfig(data)) {
    reportDeviceError('إعدادات الأتمتة من الخادم بصيغة غير متوقعة');
    return null;
  }
  return data;
}

/** Read the last good remote config from secure storage, or null. */
export async function loadCachedConfig(): Promise<AutomationConfig | null> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(CONFIG_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    return isAutomationConfig(data) ? data : null;
  } catch {
    return null;
  }
}

/** Persist a known-good remote config so a relaunch can start from it. */
export async function saveCachedConfig(config: AutomationConfig): Promise<void> {
  try {
    await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Caching is best-effort; ignore storage failures.
  }
}
