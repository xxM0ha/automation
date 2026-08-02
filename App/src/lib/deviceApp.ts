/**
 * Per-device app selection.
 *
 * A device runs ONE delivery app (Toters / Talabat / …), not all of them. The
 * choice is the app's Android package (`targetPackage`), since a delivery app's
 * tasks (e.g. orders + menu) all share that package. Persisted on the device.
 */
import * as SecureStore from 'expo-secure-store';
import type { AutomationConfig, PlatformConfig } from '../automation/config.types';

const KEY = 'prime.selectedApp';

/** One selectable delivery app, grouping all tasks that target the same package. */
export type DeviceApp = {
  /** The Android package — the stable id for the selection. */
  id: string;
  /** Friendly name shown in the picker. */
  label: string;
  /** The task slugs (config platform ids) that run for this app. */
  taskSlugs: string[];
};

/** Group the config's tasks into distinct delivery apps by targetPackage. */
export function listApps(config: AutomationConfig): DeviceApp[] {
  const groups = new Map<string, PlatformConfig[]>();
  for (const p of config.platforms) {
    if (!p.targetPackage) continue;
    const arr = groups.get(p.targetPackage) ?? [];
    arr.push(p);
    groups.set(p.targetPackage, arr);
  }
  const apps: DeviceApp[] = [];
  for (const [pkg, tasks] of groups) {
    // Prefer the "base" task's label (slug without an underscore suffix).
    const base = tasks.find((t) => !t.platform.includes('_')) ?? tasks[0];
    apps.push({
      id: pkg,
      label: base.label,
      taskSlugs: tasks.map((t) => t.platform),
    });
  }
  return apps;
}

export async function getSelectedApp(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function setSelectedApp(targetPackage: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, targetPackage);
  } catch {
    // ignore — selection just won't persist
  }
}
