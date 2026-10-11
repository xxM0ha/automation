import { NativeModule, requireOptionalNativeModule } from 'expo';

import type {
  PrimeNativeModuleEvents,
  NativeSelector,
  ExtractListParams,
  ScrollUntilParams,
  TapInRowParams,
  SwipeParams,
  NativeScreenSnapshot,
} from './PrimeNative.types';

declare class PrimeNativeModule extends NativeModule<PrimeNativeModuleEvents> {
  ping(): Promise<string>;
  startDemoTicker(): Promise<void>;
  stopDemoTicker(): Promise<void>;

  /** Whether the Prime accessibility service is enabled in system settings. */
  isAccessibilityEnabled(): Promise<boolean>;
  /** Opens the system Accessibility settings page. */
  openAccessibilitySettings(): Promise<void>;

  /** Engine primitives — used by the dry-run executor and diagnostics. */
  launchApp(selector: NativeSelector): Promise<boolean>;
  waitForApp(packageName: string, timeoutMs: number): Promise<boolean>;
  waitForElement(selector: NativeSelector, timeoutMs: number): Promise<boolean>;
  tapElement(selector: NativeSelector): Promise<boolean>;
  scrollElement(selector: NativeSelector, direction: 'up' | 'down'): Promise<boolean>;
  scrollUntil(params: ScrollUntilParams): Promise<boolean>;
  tapInRow(params: TapInRowParams): Promise<boolean>;
  tapAt(x: number, y: number): Promise<boolean>;
  longPress(selector: NativeSelector): Promise<boolean>;
  doubleTap(selector: NativeSelector): Promise<boolean>;
  swipe(params: SwipeParams): Promise<boolean>;
  setText(selector: NativeSelector, text: string): Promise<boolean>;
  clearText(selector: NativeSelector): Promise<boolean>;
  exists(selector: NativeSelector): Promise<boolean>;
  pressHome(): Promise<boolean>;
  pressRecents(): Promise<boolean>;
  openNotifications(): Promise<boolean>;
  readElementText(selector: NativeSelector): Promise<string | null>;
  readScreen(): Promise<NativeScreenSnapshot>;
  /** Wait delayMs (native, survives backgrounding) then snapshot the foreground. */
  dumpForegroundAfter(delayMs: number): Promise<NativeScreenSnapshot>;
  pressBack(): Promise<boolean>;
  extractList(params: ExtractListParams): Promise<Record<string, string>[]>;

  /**
   * Native engine — kicks off a per-platform Kotlin coroutine that runs the
   * full flow loop on the Android side. Survives Prime being backgrounded.
   * Subscribe to onEngineLog + onEngineState for live updates.
   */
  startEngine(platformConfig: unknown): Promise<void>;
  stopEngine(platform: string): Promise<void>;
  stopAllEngines(): Promise<void>;
  pauseEngine(platform: string): Promise<void>;
  resumeEngine(platform: string): Promise<void>;

  /**
   * Device error log. `configureDeviceLog` sets where errors are uploaded
   * (nulls clear it on logout); `reportDeviceError` records one from JS.
   */
  configureDeviceLog(baseUrl: string | null, token: string | null): Promise<void>;
  reportDeviceError(platform: string, kind: string, message: string): Promise<void>;

  /** Start/stop the foreground service that keeps the engine alive. */
  startEngineService(label: string): Promise<void>;
  stopEngineService(): Promise<void>;
}

// `requireOptionalNativeModule` returns null instead of throwing when the
// native code is not present (e.g. running inside Expo Go). The real Kotlin
// module is only compiled into an EAS development build.
export default requireOptionalNativeModule<PrimeNativeModule>('PrimeNative');
