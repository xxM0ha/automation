/**
 * A StepExecutor backed by the Kotlin accessibility module — runs a flow
 * against real apps on the device.
 *
 * It is the production counterpart of the dry-run executor: same interface,
 * so `runFlow` is unchanged. Requires an EAS development build (the native
 * module is not present in Expo Go).
 */
import PrimeNative from '../../modules/prime-native';
import type { Selector } from './config.types';
import type { StepExecutor, SendPayload, ScreenSnapshot } from './interpreter';

/** Thrown when a flow is run but the native accessibility module is missing. */
export class NativeUnavailableError extends Error {
  constructor() {
    super('الوحدة الأصلية غير متاحة — يلزم تشغيل نسخة التطوير (dev build).');
    this.name = 'NativeUnavailableError';
  }
}

/** Map logical endpoint names from the config to real URLs. */
const ENDPOINT_URLS: Record<string, string> = {
  // Placeholder — the Tayf backend ingest URL will replace this once the
  // backend phase lands. The flow still runs in dry mode meanwhile.
  'tayf.orders.create': 'https://example.invalid/orders',
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createNativeExecutor(): StepExecutor {
  const native = PrimeNative;
  if (!native) throw new NativeUnavailableError();

  return {
    launchApp(selector: Selector) {
      return native.launchApp(selector);
    },
    waitForApp(packageName: string, timeoutMs: number) {
      return native.waitForApp(packageName, timeoutMs);
    },
    waitFor(selector: Selector, timeoutMs: number) {
      return native.waitForElement(selector, timeoutMs);
    },
    async watchFor(selector: Selector, intervalMs: number, shouldAbort: () => boolean) {
      // The interpreter handles cancellation cooperatively, so we poll the
      // single-shot waitFor in short windows rather than blocking forever.
      while (!shouldAbort()) {
        const found = await native.waitForElement(selector, intervalMs);
        if (found) return true;
        await sleep(50);
      }
      return false;
    },
    tap(selector: Selector) {
      return native.tapElement(selector);
    },
    tapInRow(anchor: Selector, target: Selector) {
      return native.tapInRow({ anchor, target });
    },
    tapAt(x: number, y: number) {
      return native.tapAt(x, y);
    },
    longPress(selector: Selector) {
      return native.longPress(selector);
    },
    doubleTap(selector: Selector) {
      return native.doubleTap(selector);
    },
    swipe(direction: 'up' | 'down' | 'left' | 'right', selector: Selector | null) {
      return native.swipe({ direction, selector: selector ?? undefined });
    },
    setText(selector: Selector, text: string) {
      return native.setText(selector, text);
    },
    clearText(selector: Selector) {
      return native.clearText(selector);
    },
    exists(selector: Selector) {
      return native.exists(selector);
    },
    home() {
      return native.pressHome();
    },
    recents() {
      return native.pressRecents();
    },
    openNotifications() {
      return native.openNotifications();
    },
    async scroll(selector: Selector, direction: 'up' | 'down') {
      await native.scrollElement(selector, direction);
    },
    scrollUntil(until, container, direction, maxScrollPasses) {
      return native.scrollUntil({
        until,
        container: container ?? undefined,
        direction,
        maxScrollPasses,
      });
    },
    readField(selector: Selector) {
      return native.readElementText(selector);
    },
    async readScreen(): Promise<ScreenSnapshot> {
      const snap = await native.readScreen();
      return {
        package: snap.package ?? undefined,
        texts: snap.texts,
        nodes: snap.nodes,
      };
    },
    back() {
      return native.pressBack();
    },
    extractList(listSelector, itemSelector, fields, maxScrollPasses) {
      return native.extractList({
        list: listSelector,
        item: itemSelector,
        fields,
        maxScrollPasses,
      });
    },
    async sendRequest(endpoint: string, payload: SendPayload) {
      const url = ENDPOINT_URLS[endpoint];
      if (!url) {
        // No URL mapped yet — return a successful no-op so flows can still
        // be exercised end-to-end before the backend exists.
        return { approved: true, message: 'no-op (no endpoint mapped)' };
      }
      // Send `body` when set, otherwise the full payload of orders+vars.
      const requestBody = payload.body !== undefined ? payload.body : {
        orders: payload.orders,
        vars: payload.vars,
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      try {
        return await res.json();
      } catch {
        return { ok: res.ok, status: res.status };
      }
    },
  };
}
