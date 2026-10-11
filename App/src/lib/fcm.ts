/**
 * FCM glue: register this device's push token with the backend, and turn an
 * incoming `menuSync` data push into a native engine run.
 *
 * The actual delivery is handled by @react-native-firebase/messaging (a native
 * service that wakes even when the app is backgrounded/quit). This module is
 * the small bridge between a received push and our Kotlin engine.
 */
import messaging from '@react-native-firebase/messaging';
import PrimeNative, { type EngineStatePayload } from '../../modules/prime-native';
import { loadCachedConfig } from '../automation/configApi';
import { loadSession, type Session } from './auth';
import { getSelectedApp } from './deviceApp';
import { configureDeviceLogFromStoredSession, reportCaught, reportDeviceError } from './deviceLog';

type MenuItemPush = { name: string; available: boolean };

/** Data payload the backend sends (all values are strings, per FCM). */
export type MenuSyncPush = {
  type?: string;
  platform?: string;
  /** JSON-encoded array of { name, available }. */
  items?: string;
};

/** Request notification permission (Android 13+) and read the FCM token. */
export async function getFcmToken(): Promise<string | null> {
  try {
    await messaging().requestPermission();
    const token = await messaging().getToken();
    // eslint-disable-next-line no-console
    console.log('[fcm] token:', token ? `${token.slice(0, 18)}…` : 'NULL');
    return token;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('[fcm] getToken error:', String(e));
    reportCaught('تعذّر الحصول على رمز الإشعارات (FCM)', e);
    return null;
  }
}

/** Register this device's FCM token under the logged-in restaurant. */
export async function registerDevice(session: Session): Promise<boolean> {
  const token = await getFcmToken();
  if (!token) return false;
  try {
    const base = session.baseUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/api/devices/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${session.token}`,
      },
      body: JSON.stringify({ fcmToken: token }),
    });
    // eslint-disable-next-line no-console
    console.log('[fcm] register status:', res.status);
    if (!res.ok) reportDeviceError(`فشل تسجيل الجهاز للإشعارات · HTTP ${res.status}`);
    return res.ok;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('[fcm] register error:', String(e));
    reportCaught('تعذّر تسجيل الجهاز للإشعارات', e);
    return false;
  }
}

/**
 * Build a one-shot menu-sync task config: the platform's `<platform>_menu`
 * task with the pushed item list injected as `vars.pushItems` (which the flow's
 * forEach iterates).
 *
 * Sources the task from the **fetched** config (cached in secure-store) so the
 * menu automation is server-driven. Returns null if no server config has been
 * cached yet (the app ships no bundled config).
 */
async function buildMenuTask(
  platform: string,
  items: unknown,
): Promise<Record<string, unknown> | null> {
  const cfg = (await loadCachedConfig()) as any;
  if (!cfg) return null; // no server config cached yet — nothing to run
  const task = cfg.platforms.find((p: any) => p.platform === `${platform}_menu`);
  if (!task) return null;
  // The config's `restaurant` is global ("laffe"); override with the logged-in
  // account's slug so the menu sync targets this device's own account.
  const session = await loadSession();
  const accountSlug = session?.restaurant?.slug;
  const backend = { ...cfg.backend, ...(accountSlug ? { restaurant: accountSlug } : {}) };
  return { ...task, backend, vars: { pushItems: items } };
}

// ─── Menu-sync queue ──────────────────────────────────────────────────────────
// Each toggle in the panel is a separate push. The native engine cancels a
// running job when a new one starts for the same slug, so firing them straight
// at startEngine makes rapid toggles cancel each other (the freeze). Instead we
// queue: pushes that arrive while a run is in flight are accumulated per
// platform and batched into the next run once the current one reports a terminal
// state. So a menu run always finishes before the next begins.

const pendingItems = new Map<string, MenuItemPush[]>();
let draining = false;

/** De-dupe by item name, keeping the latest availability for each. */
function dedupeByName(items: MenuItemPush[]): MenuItemPush[] {
  const byName = new Map<string, MenuItemPush>();
  for (const it of items) byName.set(it.name, it);
  return [...byName.values()];
}

/** Start one engine run and resolve only when it reports idle/error. */
function runTaskToCompletion(task: Record<string, unknown>): Promise<void> {
  return new Promise<void>((resolve) => {
    const slug = task.platform as string;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub.remove();
      resolve();
    };
    const sub = PrimeNative!.addListener('onEngineState', (s: EngineStatePayload) => {
      if (s.platform === slug && (s.status === 'idle' || s.status === 'error')) finish();
    });
    // Safety net: never wedge the queue if no terminal state ever arrives.
    // Starting the next run cancels this slug's stuck coroutine natively.
    const timer = setTimeout(() => {
      reportDeviceError('مزامنة القائمة لم تنتهِ خلال 90 ثانية', slug);
      finish();
    }, 90000);
    PrimeNative!.startEngine(task).catch((e) => {
      reportCaught('تعذّر بدء مزامنة القائمة', e, slug);
      finish();
    });
  });
}

/** Process queued platforms one at a time until the queue is empty. */
async function drainMenuQueue(): Promise<void> {
  if (draining) return; // a drain loop is already running; it will see our items
  draining = true;
  try {
    while (pendingItems.size > 0) {
      const platform = pendingItems.keys().next().value as string;
      const items = dedupeByName(pendingItems.get(platform) ?? []);
      pendingItems.delete(platform);
      const task = await buildMenuTask(platform, items);
      if (!task || !PrimeNative) continue;
      // Only act if this device runs this app. A Toters push on a Talabat
      // device is ignored.
      const selected = await getSelectedApp();
      const target = task.targetPackage as string | undefined;
      if (selected && target && target !== selected) continue;
      await runTaskToCompletion(task);
    }
  } finally {
    draining = false;
  }
}

/** Handle a received menuSync push by queuing the items for the menu task. */
export async function handleMenuSyncPush(data: MenuSyncPush | undefined): Promise<void> {
  if (!data || data.type !== 'menuSync' || !data.platform) return;
  // A background push can arrive with no React tree mounted, so make sure the
  // error log knows the account before this run can fail.
  await configureDeviceLogFromStoredSession();
  let items: MenuItemPush[] = [];
  try {
    const parsed = JSON.parse(data.items || '[]');
    if (Array.isArray(parsed)) items = parsed as MenuItemPush[];
  } catch (e) {
    reportCaught('إشعار مزامنة القائمة غير صالح', e, `${data.platform}_menu`);
    items = [];
  }
  // Surface exactly what the backend pushed (the in-app names the flow will
  // search for) so a name mismatch with the merchant app is easy to spot.
  // eslint-disable-next-line no-console
  console.log('[fcm] menuSync platform=', data.platform, 'items=', JSON.stringify(items));
  if (items.length === 0) return;

  const cur = pendingItems.get(data.platform) ?? [];
  cur.push(...items);
  pendingItems.set(data.platform, cur);

  // Await the drain so background/headless deliveries stay alive while their
  // item runs; foreground callers just resolve once the queue is empty.
  await drainMenuQueue();
}
