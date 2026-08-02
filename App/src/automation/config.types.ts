/**
 * Schema for the server-driven automation config — the contract that defines
 * what the app does, without baking it into code.
 *
 * This shape is fetched from the backend's /app-config/ endpoint and cached in
 * secure storage. The app ships no bundled config — the backend is the only
 * source of truth.
 */

/** The newest schema version this build of the app knows how to run. */
export const SUPPORTED_SCHEMA_VERSION = 2;

// ---------------------------------------------------------------------------
// Selectors — how to find an element on screen
// ---------------------------------------------------------------------------

/** How to locate an element inside a target app's accessibility tree. */
export type SelectorStrategy =
  | 'package' // match an app by its Android package name
  | 'viewId' // match by resource id (e.g. "rv_orders")
  | 'text' // match by visible text
  | 'contentDesc'; // match by accessibility content-description

/** How a text/contentDesc selector's value is compared. */
export type MatchMode = 'exact' | 'contains' | 'regex';

/** One rule for finding a single thing on screen. */
export type Selector = {
  strategy: SelectorStrategy;
  value: string;
  /** Comparison mode for text/contentDesc strategies. Defaults to 'exact'. */
  match?: MatchMode;
  /**
   * When set, the match only succeeds if the foreground app's package name
   * equals this value. Auto-filled by the interpreter from a platform's
   * `targetPackage` for selectors that don't override it.
   */
  packageScope?: string;
};

// ---------------------------------------------------------------------------
// Flow steps — the ordered "do this, do that" the interpreter runs
// ---------------------------------------------------------------------------

/** Names of every step type the interpreter can run. */
export type StepType =
  | 'launchApp'
  | 'waitForApp'
  | 'waitFor'
  | 'watchFor'
  | 'wait'
  | 'tap'
  | 'tapInRow'
  | 'tapAt'
  | 'longPress'
  | 'doubleTap'
  | 'scroll'
  | 'scrollUntil'
  | 'swipe'
  | 'setText'
  | 'clearText'
  | 'exists'
  | 'readField'
  | 'readScreen'
  | 'readScreenScrolling'
  | 'extractList'
  | 'back'
  | 'home'
  | 'recents'
  | 'openNotifications'
  | 'forEach'
  | 'if'
  | 'sendRequest';

/** Open the target app. `selector` must point at a 'package' selector. */
export type LaunchAppStep = {
  type: 'launchApp';
  selector: string;
};

/**
 * Pause until the foreground app matches a 'package' selector, or give up
 * after `timeoutMs`. This is what gates the flow until the target app is
 * actually on screen — so subsequent steps don't accidentally act on the
 * launcher or our own app.
 */
export type WaitForAppStep = {
  type: 'waitForApp';
  selector: string;
  timeoutMs: number;
};

/** Pause until an element appears, or give up after `timeoutMs`. */
export type WaitForStep = {
  type: 'waitFor';
  selector: string;
  timeoutMs: number;
};

/**
 * Keep checking the whole screen forever until the selector matches.
 * Unlike `waitFor`, this never times out — it is the engine's trigger watcher.
 */
export type WatchForStep = {
  type: 'watchFor';
  selector: string;
  /** Milliseconds between checks (default 500). */
  intervalMs?: number;
};

/** Pause for a fixed duration. */
export type WaitStep = {
  type: 'wait';
  durationMs: number;
};

/** Tap the element matched by `selector`. */
export type TapStep = {
  type: 'tap';
  selector: string;
};

/**
 * Tap a target that lives in the same row as an anchor — e.g. the 3-dots
 * button beside a named menu item. Finds the `anchor`, walks up to the row
 * that contains it, then taps the `target` inside that same row. This is how
 * you act on "the button belonging to *this* item" when many identical
 * buttons exist on screen.
 */
export type TapInRowStep = {
  type: 'tapInRow';
  /** Selector key for the row's anchor (e.g. the item name). */
  anchor: string;
  /** Selector key for the thing to tap within that row (e.g. the 3-dots). */
  target: string;
};

/** Tap at absolute screen coordinates. A fallback when no selector fits. */
export type TapAtStep = {
  type: 'tapAt';
  x: number;
  y: number;
};

/** Long-press the element matched by `selector`. */
export type LongPressStep = {
  type: 'longPress';
  selector: string;
};

/** Double-tap the element matched by `selector`. */
export type DoubleTapStep = {
  type: 'doubleTap';
  selector: string;
};

/** Scroll a scrollable container up or down. */
export type ScrollStep = {
  type: 'scroll';
  selector: string;
  direction: 'up' | 'down';
};

/**
 * Scroll repeatedly until the `until` selector appears on screen, or give up
 * after `maxScrollPasses`. Use it to bring a below-the-fold element (e.g. the
 * order total / confirm button) into view, and as a reliable signal that a
 * detail screen has finished loading.
 *
 * `selector` (optional) names the scroll container; when omitted, the engine
 * scrolls the first scrollable view it finds.
 */
export type ScrollUntilStep = {
  type: 'scrollUntil';
  /** Selector key that, once found, stops the scrolling. */
  until: string;
  /** Optional scroll-container selector key. */
  selector?: string;
  direction: 'up' | 'down';
  maxScrollPasses: number;
};

/**
 * Swipe a gesture across the screen, optionally anchored to an element.
 * When `selector` is given, the swipe starts from that element's center;
 * otherwise it swipes across the screen center.
 */
export type SwipeStep = {
  type: 'swipe';
  direction: 'up' | 'down' | 'left' | 'right';
  selector?: string;
};

/** Type text into the element matched by `selector` (an input field). */
export type SetTextStep = {
  type: 'setText';
  selector: string;
  /** Text to enter. Supports {{variable}} interpolation. */
  text: string;
};

/** Clear the text of the input matched by `selector`. */
export type ClearTextStep = {
  type: 'clearText';
  selector: string;
};

/**
 * Check whether an element exists right now and store the boolean result in
 * `saveAs`, without waiting. Use it to branch with a following `if` step.
 */
export type ExistsStep = {
  type: 'exists';
  selector: string;
  saveAs: string;
};

/** Read one element's text into a variable named `saveAs`. */
export type ReadFieldStep = {
  type: 'readField';
  selector: string;
  saveAs: string;
};

/**
 * Snapshot every visible text/content-desc on the current screen.
 * Result is a structured object saved to `saveAs`.
 */
export type ReadScreenStep = {
  type: 'readScreen';
  saveAs: string;
};

/**
 * Like readScreen, but scrolls the screen from the top down and accumulates
 * every viewport's text — so long detail screens (orders that don't fit on one
 * screen) are captured whole. Stops at the `until` selector, at the bottom, or
 * after `maxScrollPasses`.
 */
export type ReadScreenScrollingStep = {
  type: 'readScreenScrolling';
  saveAs: string;
  /** Selector key whose appearance stops scrolling (e.g. the order total). */
  until?: string;
  /** Max scroll gestures before stopping. */
  maxScrollPasses?: number;
};

/** Scroll through a list and read `fields` off every row. */
export type ExtractListStep = {
  type: 'extractList';
  /** The scrollable list container. */
  listSelector: string;
  /** Each row inside the list. */
  itemSelector: string;
  /** Result field name -> selector key read from within each row. */
  fields: Record<string, string>;
  /** Max scroll gestures before the engine stops paging. */
  maxScrollPasses: number;
};

/** Press the system back button. */
export type BackStep = {
  type: 'back';
};

/** Press the system home button. */
export type HomeStep = {
  type: 'home';
};

/** Open the system recents / overview. */
export type RecentsStep = {
  type: 'recents';
};

/** Open the notification shade. */
export type OpenNotificationsStep = {
  type: 'openNotifications';
};

/**
 * Loop over a list, running `do` steps once per element.
 *
 * `items` is a dotted-path to an array variable in scope (e.g. a list the
 * backend returned: "menu.items"). Each element is bound to a variable named
 * by `as` (e.g. "item"), readable inside `do` steps and in selector
 * interpolation as {{item}} / {{item.name}}.
 */
export type ForEachStep = {
  type: 'forEach';
  /** Dotted path to the array variable to iterate. */
  items: string;
  /** Name to bind each element to within the loop body. */
  as: string;
  /** Steps run for each element. */
  do: Step[];
};

/** A boolean test against a variable or parameter in scope. */
export type Condition = {
  /**
   * Variable to test. Supports dotted paths into objects:
   * `autoConfirm` reads the platform parameter; `res.approved` reads a
   * field of a response saved by a sendRequest step.
   */
  var: string;
  op: 'isEmpty' | 'notEmpty' | 'equals' | 'notEquals';
  /** Compared value for equals/notEquals. */
  value?: string | number | boolean;
};

/** Run `then` steps when the condition holds, otherwise `else`. */
export type IfStep = {
  type: 'if';
  condition: Condition;
  then: Step[];
  else?: Step[];
};

/**
 * POST to a backend endpoint and (optionally) await the response.
 *
 *   - `body`: name of a variable to send as the JSON body. If omitted,
 *     the whole scope is sent.
 *   - `saveAs`: where to put the parsed JSON response. Subsequent `if`
 *     steps can test `saveAs.field` via dotted-path conditions.
 */
export type SendRequestStep = {
  type: 'sendRequest';
  /** Logical endpoint name, resolved by the app. */
  endpoint: string;
  body?: string;
  saveAs?: string;
  /** Variable names to include when body is unset; defaults to all scope. */
  fields?: string[];
};

/** One instruction in a platform's automation flow. */
export type Step =
  | LaunchAppStep
  | WaitForAppStep
  | WaitForStep
  | WatchForStep
  | WaitStep
  | TapStep
  | TapInRowStep
  | TapAtStep
  | LongPressStep
  | DoubleTapStep
  | ScrollStep
  | ScrollUntilStep
  | SwipeStep
  | SetTextStep
  | ClearTextStep
  | ExistsStep
  | ReadFieldStep
  | ReadScreenStep
  | ReadScreenScrollingStep
  | ExtractListStep
  | BackStep
  | HomeStep
  | RecentsStep
  | OpenNotificationsStep
  | ForEachStep
  | IfStep
  | SendRequestStep;

// ---------------------------------------------------------------------------
// Platform & document
// ---------------------------------------------------------------------------

/** How the interpreter handles the flow finishing. */
export type RunMode =
  | 'once' // run the flow one time and stop
  | 'continuous'; // loop the flow forever until stopped

/**
 * Desired run-state of a task, set from config (and later pushed by the
 * backend). The engine reconciles each task to this state.
 *   - running: execute normally
 *   - paused:  keep the task alive but suspend its loop between iterations
 *   - stopped: do not run
 */
export type TaskControl = 'running' | 'paused' | 'stopped';

/** Global tuning knobs for one platform's automation. */
export type PlatformParameters = {
  /** Seconds to wait between full runs of the flow in `continuous` mode. */
  scanIntervalSec: number;
  /** Confirm incoming orders automatically (read by `if` conditions). */
  autoConfirm: boolean;
};

/** The full automation config for a single delivery platform. */
export type PlatformConfig = {
  /** Slug — matches the platform ids used elsewhere in the app. */
  platform: string;
  /** Human-readable name shown in the UI. */
  label: string;
  /** Whether the automation runs for this platform. */
  enabled: boolean;
  /** Run the flow once, or loop it forever. Defaults to 'once'. */
  runMode?: RunMode;
  /**
   * Priority for the shared screen. When two tasks both need to *act* on the
   * screen, the higher priority goes first; the lower one finishes its current
   * order, releases, and waits. Watching/reading never contends. Default 0.
   */
  priority?: number;
  /** Desired run-state. Default 'stopped' (start it from the UI/config). */
  control?: TaskControl;
  /**
   * Android package name of the app this platform automates. When set, every
   * selector that does not override `packageScope` is restricted to matches
   * inside this app — the engine ignores everything in launchers, our own
   * app, the system UI, etc.
   */
  targetPackage?: string;
  parameters: PlatformParameters;
  /** Logical element name -> how to find it on screen. */
  selectors: Record<string, Selector>;
  /** The ordered steps the interpreter executes. */
  flow: Step[];
};

/** Backend connection settings shared by all tasks. */
export type BackendConfig = {
  /** Base URL of the Tayf backend, e.g. "https://api.3alijny.com". */
  baseUrl: string;
  /** This device's restaurant slug, sent with order webhooks. */
  restaurant: string;
};

/** The complete config document the app loads on launch. */
export type AutomationConfig = {
  /** Version of this schema; checked against SUPPORTED_SCHEMA_VERSION. */
  schemaVersion: number;
  /** ISO timestamp of the last edit (set by the server). */
  updatedAt: string;
  /** Backend the engine talks to (order webhook, etc.). */
  backend?: BackendConfig;
  platforms: PlatformConfig[];
};
