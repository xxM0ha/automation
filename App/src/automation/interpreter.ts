/**
 * The step interpreter — the engine that runs a platform's `flow`.
 *
 * It is pure orchestration: it walks the steps, keeps a variable scope,
 * evaluates `if` conditions, and delegates every device-touching action to
 * a `StepExecutor`. Two executors exist — the dry-run simulator (for testing
 * inside Expo Go) and the native executor backed by Kotlin.
 *
 * `runFlow` runs a flow exactly once. `runLoop` keeps re-running it until
 * the caller aborts; that is what the EngineController uses for continuous
 * platforms — `runMode: "continuous"` flows that "never die".
 */
import type { PlatformConfig, Selector, Step, Condition } from './config.types';

export type ScopeValue = unknown;

/** A flat-ish bag of variables collected during a run. */
export type Scope = Record<string, ScopeValue>;

/** Data handed to a sendRequest step. */
export type SendPayload = {
  orders: Record<string, string>[];
  vars: Scope;
  /** The variable named in `body` if the step set one, else undefined. */
  body?: ScopeValue;
};

/** Result of one sendRequest — typically the parsed JSON response. */
export type SendResponse = unknown;

/** A single visible node captured by readScreen. */
export type ScreenNode = {
  text?: string;
  contentDesc?: string;
  viewId?: string;
  clickable?: boolean;
};

export type ScreenSnapshot = {
  package?: string;
  texts: string[];
  nodes: ScreenNode[];
};

/**
 * The device-touching primitives the interpreter delegates to.
 * Swapping this implementation is how the same flow runs in dry-run today
 * and against a real device (via Kotlin) later.
 */
export interface StepExecutor {
  launchApp(selector: Selector): Promise<boolean>;
  /** Resolves true if the named package became the foreground in time. */
  waitForApp(packageName: string, timeoutMs: number): Promise<boolean>;
  /** Resolves true if the element appeared before the timeout. */
  waitFor(selector: Selector, timeoutMs: number): Promise<boolean>;
  /** Long-poll until the selector matches; resolves when found. */
  watchFor(selector: Selector, intervalMs: number, shouldAbort: () => boolean): Promise<boolean>;
  /** Resolves true if an element was found and tapped. */
  tap(selector: Selector): Promise<boolean>;
  /** Tap a target in the same row as an anchor (e.g. the 3-dots beside an item). */
  tapInRow(anchor: Selector, target: Selector): Promise<boolean>;
  /** Tap absolute screen coordinates. */
  tapAt(x: number, y: number): Promise<boolean>;
  /** Long-press an element. */
  longPress(selector: Selector): Promise<boolean>;
  /** Double-tap an element. */
  doubleTap(selector: Selector): Promise<boolean>;
  /** Swipe across the screen, optionally from an element's center. */
  swipe(direction: 'up' | 'down' | 'left' | 'right', selector: Selector | null): Promise<boolean>;
  /** Type text into an input element. */
  setText(selector: Selector, text: string): Promise<boolean>;
  /** Clear an input element's text. */
  clearText(selector: Selector): Promise<boolean>;
  /** True if the element exists on screen right now (no waiting). */
  exists(selector: Selector): Promise<boolean>;
  /** System buttons. */
  home(): Promise<boolean>;
  recents(): Promise<boolean>;
  openNotifications(): Promise<boolean>;
  scroll(selector: Selector, direction: 'up' | 'down'): Promise<void>;
  /**
   * Scroll (the container, or the first scrollable when null) until `until`
   * appears, up to `maxScrollPasses`. Resolves true if found.
   */
  scrollUntil(
    until: Selector,
    container: Selector | null,
    direction: 'up' | 'down',
    maxScrollPasses: number,
  ): Promise<boolean>;
  /** Resolves the element's text, or null if it was not found. */
  readField(selector: Selector): Promise<string | null>;
  /** Snapshot every visible text/content-desc on the current screen. */
  readScreen(): Promise<ScreenSnapshot>;
  /** Press the system back button. */
  back(): Promise<boolean>;
  /** Scrolls the list and reads `fields` off every row. */
  extractList(
    listSelector: Selector,
    itemSelector: Selector,
    fields: Record<string, Selector>,
    maxScrollPasses: number,
  ): Promise<Record<string, string>[]>;
  /** POST to a logical endpoint and resolve to the response (or null). */
  sendRequest(endpoint: string, payload: SendPayload): Promise<SendResponse>;
}

export type RunLogLevel = 'info' | 'step' | 'success' | 'error';

/** One line in the run log shown to the user. */
export type RunLogEntry = {
  id: number;
  ts: number;
  level: RunLogLevel;
  message: string;
  /** Indentation depth for nested if-branches. */
  depth: number;
};

export type RunResult = {
  ok: boolean;
  orders: Record<string, string>[];
  durationMs: number;
  error?: string;
};

export type RunOptions = {
  config: PlatformConfig;
  executor: StepExecutor;
  onLog: (entry: RunLogEntry) => void;
  /** Checked between steps; return true to stop the run early. */
  shouldAbort?: () => boolean;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Thrown to unwind the run when the caller aborts. */
class AbortRun extends Error {}
/** Thrown when a step cannot complete (missing selector, element not found). */
class StepFailure extends Error {}

/** Read `obj.a.b.c` style paths. Returns undefined if any segment is missing. */
function readPath(root: Scope, path: string): ScopeValue {
  const parts = path.split('.');
  let cursor: ScopeValue = root[parts[0]];
  for (let i = 1; i < parts.length; i++) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, ScopeValue>)[parts[i]];
  }
  return cursor;
}

function isEmptyish(value: ScopeValue): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function evalCondition(cond: Condition, scope: Scope): boolean {
  const value = readPath(scope, cond.var);
  switch (cond.op) {
    case 'isEmpty':
      return isEmptyish(value);
    case 'notEmpty':
      return !isEmptyish(value);
    case 'equals':
      return value === cond.value;
    case 'notEquals':
      return value !== cond.value;
  }
}

function filterFields(order: Record<string, string>, keep: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keep) {
    if (key in order) out[key] = order[key];
  }
  return out;
}

/** Replace {{path}} tokens in a string with stringified scope values. */
function interpolate(template: string, scope: Scope): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path: string) => {
    const value = readPath(scope, path);
    return value == null ? '' : String(value);
  });
}

/** Trim a string to `max` characters, appending an ellipsis when cut. */
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function safeStringify(value: unknown): string {
  try { return JSON.stringify(value); } catch { return String(value); }
}

/** Walks a platform's `flow` exactly once. */
export async function runFlow(opts: RunOptions): Promise<RunResult> {
  const { config, executor, onLog, shouldAbort } = opts;
  const started = Date.now();

  let logId = Math.floor(Math.random() * 1_000_000);
  const log = (level: RunLogLevel, message: string, depth = 0) =>
    onLog({ id: logId++, ts: Date.now(), level, message, depth });

  // Variable scope, seeded with the platform parameters so `if` conditions
  // can test them. `readField` / `readScreen` / `sendRequest` add more
  // variables as the flow runs.
  const scope: Scope = {
    scanIntervalSec: config.parameters.scanIntervalSec,
    autoConfirm: config.parameters.autoConfirm,
  };
  const orders: Record<string, string>[] = [];

  const resolveSelector = (key: string): Selector => {
    const selector = config.selectors[key];
    if (!selector) throw new StepFailure(`المُحدِّد غير موجود: ${key}`);
    // Interpolate {{loopVar}} tokens against the live scope (for forEach), then
    // auto-scope to the platform package (package selectors are exempt — they
    // identify apps, they don't search inside one).
    const value = selector.value.includes('{{')
      ? interpolate(selector.value, scope)
      : selector.value;
    const packageScope =
      config.targetPackage &&
      selector.packageScope === undefined &&
      selector.strategy !== 'package'
        ? config.targetPackage
        : selector.packageScope;
    return { ...selector, value, packageScope };
  };

  const runStep = async (step: Step, depth: number): Promise<void> => {
    if (shouldAbort?.()) throw new AbortRun();

    switch (step.type) {
      case 'launchApp': {
        const selector = resolveSelector(step.selector);
        log('step', `تشغيل التطبيق · ${selector.value}`, depth);
        const launched = await executor.launchApp(selector);
        if (!launched) {
          throw new StepFailure(
            `تعذّر تشغيل التطبيق: ${selector.value} — تحقّق من اسم الحزمة وأنّ التطبيق مُثبَّت.`,
          );
        }
        break;
      }
      case 'waitFor': {
        const selector = resolveSelector(step.selector);
        const scope = selector.packageScope ? ` (في ${selector.packageScope})` : '';
        log('step', `انتظار ظهور · ${step.selector}${scope}`, depth);
        const found = await executor.waitFor(selector, step.timeoutMs);
        if (!found) throw new StepFailure(`لم يظهر العنصر: ${step.selector}`);
        break;
      }
      case 'waitForApp': {
        const selector = resolveSelector(step.selector);
        log('step', `انتظار التطبيق · ${selector.value}`, depth);
        const arrived = await executor.waitForApp(selector.value, step.timeoutMs);
        if (!arrived) {
          throw new StepFailure(
            `لم يصبح التطبيق في المقدّمة: ${selector.value}`,
          );
        }
        break;
      }
      case 'watchFor': {
        const selector = resolveSelector(step.selector);
        const scope = selector.packageScope ? ` (في ${selector.packageScope})` : '';
        log('step', `مراقبة الشاشة لـ · ${step.selector}${scope}`, depth);
        // Heartbeat: watchFor can poll forever. Emit a log line every 5s so
        // the user can see it is still alive — silence is indistinguishable
        // from a hang.
        let elapsed = 0;
        const heartbeat = setInterval(() => {
          elapsed += 5;
          log('info', `لا يزال يراقب · ${elapsed}ث`, depth);
        }, 5000);
        try {
          const found = await executor.watchFor(
            selector,
            step.intervalMs ?? 500,
            shouldAbort ?? (() => false),
          );
          if (!found) throw new AbortRun();
          log('success', `ظهر · ${step.selector}`, depth);
        } finally {
          clearInterval(heartbeat);
        }
        break;
      }
      case 'wait': {
        log('step', `تأخير · ${step.durationMs} ملّي`, depth);
        await sleep(step.durationMs);
        break;
      }
      case 'tap': {
        const selector = resolveSelector(step.selector);
        log('step', `نقر · ${step.selector}`, depth);
        const tapped = await executor.tap(selector);
        if (!tapped) log('info', `تعذّر العثور على ${step.selector} للنقر`, depth);
        break;
      }
      case 'tapInRow': {
        const anchor = resolveSelector(step.anchor);
        const target = resolveSelector(step.target);
        log('step', `نقر في صف · ${step.anchor} ← ${step.target}`, depth);
        const tapped = await executor.tapInRow(anchor, target);
        if (!tapped) log('info', `تعذّر إيجاد صف · ${step.anchor}`, depth);
        break;
      }
      case 'tapAt': {
        log('step', `نقر عند · ${step.x},${step.y}`, depth);
        await executor.tapAt(step.x, step.y);
        break;
      }
      case 'longPress': {
        const selector = resolveSelector(step.selector);
        log('step', `ضغط مطوّل · ${step.selector}`, depth);
        await executor.longPress(selector);
        break;
      }
      case 'doubleTap': {
        const selector = resolveSelector(step.selector);
        log('step', `نقر مزدوج · ${step.selector}`, depth);
        await executor.doubleTap(selector);
        break;
      }
      case 'swipe': {
        const selector = step.selector ? resolveSelector(step.selector) : null;
        log('step', `سحب · ${step.direction}`, depth);
        await executor.swipe(step.direction, selector);
        break;
      }
      case 'setText': {
        const selector = resolveSelector(step.selector);
        const text = step.text.includes('{{') ? interpolate(step.text, scope) : step.text;
        log('step', `إدخال نص · ${step.selector}`, depth);
        await executor.setText(selector, text);
        break;
      }
      case 'clearText': {
        const selector = resolveSelector(step.selector);
        log('step', `مسح النص · ${step.selector}`, depth);
        await executor.clearText(selector);
        break;
      }
      case 'exists': {
        const selector = resolveSelector(step.selector);
        const found = await executor.exists(selector);
        scope[step.saveAs] = found;
        log('step', `موجود؟ · ${step.selector} = ${found}`, depth);
        break;
      }
      case 'home': {
        log('step', 'زر الرئيسية', depth);
        await executor.home();
        break;
      }
      case 'recents': {
        log('step', 'قائمة التطبيقات', depth);
        await executor.recents();
        break;
      }
      case 'openNotifications': {
        log('step', 'فتح الإشعارات', depth);
        await executor.openNotifications();
        break;
      }
      case 'forEach': {
        const list = readPath(scope, step.items);
        const arr = Array.isArray(list) ? list : [];
        log('step', `تكرار · ${step.items} (${arr.length})`, depth);
        const prev = scope[step.as];
        const had = step.as in scope;
        try {
          for (let i = 0; i < arr.length; i++) {
            if (shouldAbort?.()) throw new AbortRun();
            scope[step.as] = arr[i];
            log('info', `عنصر ${i + 1}/${arr.length}`, depth);
            for (const child of step.do) await runStep(child, depth + 1);
          }
        } finally {
          if (had) scope[step.as] = prev;
          else delete scope[step.as];
        }
        break;
      }
      case 'scroll': {
        const selector = resolveSelector(step.selector);
        log('step', `تمرير · ${step.direction === 'down' ? 'لأسفل' : 'لأعلى'}`, depth);
        await executor.scroll(selector, step.direction);
        break;
      }
      case 'scrollUntil': {
        const until = resolveSelector(step.until);
        const container = step.selector ? resolveSelector(step.selector) : null;
        log('step', `تمرير حتى يظهر · ${step.until}`, depth);
        const found = await executor.scrollUntil(
          until,
          container,
          step.direction,
          step.maxScrollPasses,
        );
        if (!found) throw new StepFailure(`لم يظهر العنصر بعد التمرير: ${step.until}`);
        log('success', `ظهر بعد التمرير · ${step.until}`, depth);
        break;
      }
      case 'readField': {
        const selector = resolveSelector(step.selector);
        const text = await executor.readField(selector);
        scope[step.saveAs] = text ?? '';
        log('step', `قراءة · ${step.saveAs} = "${text ?? ''}"`, depth);
        break;
      }
      case 'readScreen': {
        log('step', `قراءة الشاشة الكاملة → ${step.saveAs}`, depth);
        const snapshot = await executor.readScreen();
        scope[step.saveAs] = snapshot;
        log('success', `${snapshot.nodes.length} عنصر · ${snapshot.texts.length} نص`, depth);
        if (snapshot.texts.length > 0) {
          log('info', `النصوص: ${truncate(snapshot.texts.join(' · '), 400)}`, depth);
        }
        break;
      }
      case 'readScreenScrolling': {
        // Dry-run approximation — the real (native) step scrolls and accumulates;
        // here a single readScreen is enough to preview the flow in dev.
        log('step', `قراءة الشاشة مع التمرير → ${step.saveAs}`, depth);
        const snapshot = await executor.readScreen();
        scope[step.saveAs] = snapshot;
        log('success', `${snapshot.nodes.length} عنصر · ${snapshot.texts.length} نص`, depth);
        break;
      }
      case 'back': {
        log('step', 'زر الرجوع', depth);
        await executor.back();
        break;
      }
      case 'extractList': {
        const listSelector = resolveSelector(step.listSelector);
        const itemSelector = resolveSelector(step.itemSelector);
        const fields: Record<string, Selector> = {};
        for (const [name, key] of Object.entries(step.fields)) {
          fields[name] = resolveSelector(key);
        }
        log('step', `استخراج قائمة · ${step.itemSelector}`, depth);
        const rows = await executor.extractList(
          listSelector,
          itemSelector,
          fields,
          step.maxScrollPasses,
        );
        orders.push(...rows);
        log('success', `استُخرج ${rows.length} عنصر`, depth);
        break;
      }
      case 'if': {
        const passed = evalCondition(step.condition, scope);
        log('step', `شرط · ${step.condition.var} ← ${passed ? 'تحقّق' : 'لم يتحقّق'}`, depth);
        const branch = passed ? step.then : step.else ?? [];
        for (const child of branch) await runStep(child, depth + 1);
        break;
      }
      case 'sendRequest': {
        const body = step.body ? scope[step.body] : undefined;
        const orderPayload = step.fields
          ? orders.map((o) => filterFields(o, step.fields!))
          : orders;
        log(
          'step',
          `إرسال طلب · ${step.endpoint}${step.saveAs ? ` → ${step.saveAs}` : ''}`,
          depth,
        );
        const outgoing = body !== undefined ? body : { orders: orderPayload, vars: scope };
        log('info', `البيانات: ${truncate(safeStringify(outgoing), 300)}`, depth);
        const response = await executor.sendRequest(step.endpoint, {
          orders: orderPayload,
          vars: scope,
          body,
        });
        if (step.saveAs) scope[step.saveAs] = response;
        log('info', `الردّ: ${truncate(safeStringify(response), 200)}`, depth);
        break;
      }
    }
  };

  log('info', `بدء تدفق "${config.label}" · ${config.flow.length} خطوة`);

  try {
    for (const step of config.flow) {
      await runStep(step, 0);
    }
    const durationMs = Date.now() - started;
    log('success', `اكتمل التدفق · ${orders.length} طلب · ${durationMs} ملّي`);
    return { ok: true, orders, durationMs };
  } catch (err) {
    const durationMs = Date.now() - started;
    if (err instanceof AbortRun) {
      log('error', 'أُلغي التدفق');
      return { ok: false, orders, durationMs, error: 'aborted' };
    }
    const message = err instanceof Error ? err.message : String(err);
    log('error', `فشل التدفق · ${message}`);
    return { ok: false, orders, durationMs, error: message };
  }
}

/**
 * Keep running a flow until aborted. This is the "never die" loop:
 *
 *   - If a single iteration fails, log it, wait `retryDelayMs`, and retry.
 *   - If the flow succeeds and `runMode` is `continuous`, immediately start
 *     the next iteration.
 *   - Aborts stop the loop cleanly.
 */
export async function runLoop(opts: RunOptions & { retryDelayMs?: number }): Promise<void> {
  const retryDelayMs = opts.retryDelayMs ?? 2000;
  const intervalMs = (opts.config.parameters.scanIntervalSec ?? 1) * 1000;
  while (!opts.shouldAbort?.()) {
    const result = await runFlow(opts);
    if (opts.shouldAbort?.()) return;
    if (opts.config.runMode !== 'continuous') return;
    await sleep(result.ok ? intervalMs : retryDelayMs);
  }
}
