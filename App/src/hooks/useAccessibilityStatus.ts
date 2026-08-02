import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import PrimeNative from '../../modules/prime-native';

export type AccessibilityStatus = {
  /** True if the Prime accessibility service is enabled. */
  enabled: boolean;
  /** False when the native module is unavailable (e.g. running in Expo Go). */
  available: boolean;
  /** Re-check the current status. */
  refresh: () => void;
  /** Open the system Accessibility settings page. */
  openSettings: () => void;
};

/**
 * Tracks whether the Prime accessibility service is enabled.
 *
 * Re-checks on mount, whenever the app returns to the foreground (so coming
 * back from the settings screen updates the UI), and on the live
 * `onAccessibilityState` event the service emits when it connects.
 */
export function useAccessibilityStatus(): AccessibilityStatus {
  const available = PrimeNative != null;
  const [enabled, setEnabled] = useState(false);

  const refresh = useCallback(() => {
    if (!PrimeNative) return;
    PrimeNative.isAccessibilityEnabled()
      .then(setEnabled)
      .catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    if (!PrimeNative) return;
    refresh();

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    const eventSub = PrimeNative.addListener('onAccessibilityState', (e) => {
      setEnabled(e.running);
    });

    return () => {
      appStateSub.remove();
      eventSub.remove();
    };
  }, [refresh]);

  const openSettings = useCallback(() => {
    PrimeNative?.openAccessibilitySettings().catch(() => {});
  }, []);

  return { enabled, available, refresh, openSettings };
}
