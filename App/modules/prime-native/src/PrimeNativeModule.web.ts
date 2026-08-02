import { registerWebModule, NativeModule } from 'expo';

import type {
  PrimeNativeModuleEvents,
  NativeSelector,
  ExtractListParams,
  ScrollUntilParams,
  TapInRowParams,
  SwipeParams,
  NativeScreenSnapshot,
} from './PrimeNative.types';

const unsupported = (method: string): never => {
  throw new Error(`PrimeNative.${method}() is not supported on web.`);
};

// Web is not a supported target. Device methods throw so misuse is loud; the
// accessibility status check simply reports "not enabled".
class PrimeNativeModule extends NativeModule<PrimeNativeModuleEvents> {
  async ping(): Promise<string> { return unsupported('ping'); }
  async startDemoTicker(): Promise<void> { unsupported('startDemoTicker'); }
  async stopDemoTicker(): Promise<void> { unsupported('stopDemoTicker'); }
  async isAccessibilityEnabled(): Promise<boolean> { return false; }
  async openAccessibilitySettings(): Promise<void> { unsupported('openAccessibilitySettings'); }
  async launchApp(_selector: NativeSelector): Promise<boolean> { return unsupported('launchApp'); }
  async waitForApp(_packageName: string, _timeoutMs: number): Promise<boolean> {
    return unsupported('waitForApp');
  }
  async waitForElement(_selector: NativeSelector, _timeoutMs: number): Promise<boolean> {
    return unsupported('waitForElement');
  }
  async tapElement(_selector: NativeSelector): Promise<boolean> { return unsupported('tapElement'); }
  async scrollElement(_selector: NativeSelector, _direction: 'up' | 'down'): Promise<boolean> {
    return unsupported('scrollElement');
  }
  async scrollUntil(_params: ScrollUntilParams): Promise<boolean> {
    return unsupported('scrollUntil');
  }
  async tapInRow(_params: TapInRowParams): Promise<boolean> {
    return unsupported('tapInRow');
  }
  async tapAt(_x: number, _y: number): Promise<boolean> {
    return unsupported('tapAt');
  }
  async longPress(_selector: NativeSelector): Promise<boolean> {
    return unsupported('longPress');
  }
  async doubleTap(_selector: NativeSelector): Promise<boolean> {
    return unsupported('doubleTap');
  }
  async swipe(_params: SwipeParams): Promise<boolean> {
    return unsupported('swipe');
  }
  async setText(_selector: NativeSelector, _text: string): Promise<boolean> {
    return unsupported('setText');
  }
  async clearText(_selector: NativeSelector): Promise<boolean> {
    return unsupported('clearText');
  }
  async exists(_selector: NativeSelector): Promise<boolean> {
    return unsupported('exists');
  }
  async pressHome(): Promise<boolean> {
    return unsupported('pressHome');
  }
  async pressRecents(): Promise<boolean> {
    return unsupported('pressRecents');
  }
  async openNotifications(): Promise<boolean> {
    return unsupported('openNotifications');
  }
  async readElementText(_selector: NativeSelector): Promise<string | null> {
    return unsupported('readElementText');
  }
  async readScreen(): Promise<NativeScreenSnapshot> { return unsupported('readScreen'); }
  async dumpForegroundAfter(_delayMs: number): Promise<NativeScreenSnapshot> {
    return unsupported('dumpForegroundAfter');
  }
  async pressBack(): Promise<boolean> { return unsupported('pressBack'); }
  async extractList(_params: ExtractListParams): Promise<Record<string, string>[]> {
    return unsupported('extractList');
  }
  async startEngine(_platformConfig: unknown): Promise<void> { unsupported('startEngine'); }
  async stopEngine(_platform: string): Promise<void> { unsupported('stopEngine'); }
  async stopAllEngines(): Promise<void> { unsupported('stopAllEngines'); }
  async pauseEngine(_platform: string): Promise<void> { unsupported('pauseEngine'); }
  async resumeEngine(_platform: string): Promise<void> { unsupported('resumeEngine'); }
  async startEngineService(_label: string): Promise<void> { unsupported('startEngineService'); }
  async stopEngineService(): Promise<void> { unsupported('stopEngineService'); }
}

export default registerWebModule(PrimeNativeModule, 'PrimeNativeModule');
