/**
 * A StepExecutor that simulates a device — no native code, no real apps.
 *
 * It adds realistic delays so a dry run feels live, and returns plausible
 * fake orders. This lets the interpreter be exercised entirely inside Expo Go,
 * before the Kotlin accessibility engine exists. Later, a NativeExecutor with
 * the same interface replaces it.
 */
import type { Selector } from './config.types';
import type { StepExecutor, SendPayload, ScreenSnapshot } from './interpreter';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const SAMPLE_CUSTOMERS = ['أحمد علي', 'سارة محمود', 'يوسف حسن', 'ليلى كريم', 'عمر فاروق'];

/** Builds a believable value for a result field based on its name. */
function fakeFieldValue(fieldName: string, index: number): string {
  const name = fieldName.toLowerCase();
  if (name.includes('number')) return `#10${index + 1}`;
  if (name.includes('customer') || name.includes('name')) {
    return SAMPLE_CUSTOMERS[index % SAMPLE_CUSTOMERS.length];
  }
  if (name.includes('total')) return `${(index + 1) * 7500} د.ع`;
  return `قيمة ${index + 1}`;
}

export function createDryRunExecutor(): StepExecutor {
  return {
    async launchApp(_selector: Selector) {
      await sleep(600);
      return true;
    },
    async waitForApp(_packageName: string, _timeoutMs: number) {
      await sleep(500);
      return true;
    },
    async waitFor(_selector: Selector, _timeoutMs: number) {
      await sleep(800);
      return true;
    },
    async watchFor(_selector: Selector, intervalMs: number, shouldAbort: () => boolean) {
      // Simulate "found after 1-2 ticks" — long enough to feel like real watching.
      const waited = intervalMs * (1 + Math.floor(Math.random() * 2));
      const deadline = Date.now() + waited;
      while (Date.now() < deadline) {
        if (shouldAbort()) return false;
        await sleep(Math.min(intervalMs, deadline - Date.now()));
      }
      return true;
    },
    async tap(_selector: Selector) {
      await sleep(400);
      return true;
    },
    async tapInRow(_anchor: Selector, _target: Selector) {
      await sleep(400);
      return true;
    },
    async tapAt(_x: number, _y: number) {
      await sleep(200);
      return true;
    },
    async longPress(_selector: Selector) {
      await sleep(700);
      return true;
    },
    async doubleTap(_selector: Selector) {
      await sleep(400);
      return true;
    },
    async swipe(_direction: 'up' | 'down' | 'left' | 'right', _selector: Selector | null) {
      await sleep(400);
      return true;
    },
    async setText(_selector: Selector, _text: string) {
      await sleep(300);
      return true;
    },
    async clearText(_selector: Selector) {
      await sleep(200);
      return true;
    },
    async exists(_selector: Selector) {
      await sleep(150);
      return true;
    },
    async home() {
      await sleep(200);
      return true;
    },
    async recents() {
      await sleep(200);
      return true;
    },
    async openNotifications() {
      await sleep(200);
      return true;
    },
    async scroll(_selector: Selector, _direction: 'up' | 'down') {
      await sleep(500);
    },
    async scrollUntil(_until, _container, _direction, _maxScrollPasses) {
      // Simulate one or two scrolls then "finding" it.
      await sleep(900);
      return true;
    },
    async readField(selector: Selector) {
      await sleep(300);
      return selector.value;
    },
    async readScreen(): Promise<ScreenSnapshot> {
      await sleep(500);
      const texts = ['طلب جديد', 'IQD 12,500', 'الزبون: أحمد', 'تفاصيل الطلب'];
      return {
        package: 'com.example.dryrun',
        texts,
        nodes: texts.map((text) => ({ text, clickable: false })),
      };
    },
    async back() {
      await sleep(200);
      return true;
    },
    async extractList(_listSelector, _itemSelector, fields, _maxScrollPasses) {
      await sleep(1200);
      const count = 2 + Math.floor(Math.random() * 3); // 2..4 fake orders
      const rows: Record<string, string>[] = [];
      for (let i = 0; i < count; i++) {
        const row: Record<string, string> = {};
        for (const fieldName of Object.keys(fields)) {
          row[fieldName] = fakeFieldValue(fieldName, i);
        }
        rows.push(row);
      }
      return rows;
    },
    async sendRequest(_endpoint: string, _payload: SendPayload) {
      await sleep(700);
      // Fake a happy backend response so `if res.confirm` works in dry runs.
      return { status: 'received', confirm: true, message: 'تمت الموافقة' };
    },
  };
}
