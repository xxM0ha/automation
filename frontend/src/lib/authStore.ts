/**
 * Minimal reactive auth store — no external dependencies.
 */
import { useSyncExternalStore } from 'react';
import { getAuth, setActiveBranch, type AuthUser } from './api';

let _user: AuthUser | null = getAuth();
const _listeners = new Set<() => void>();

function _notify() {
  _listeners.forEach((fn) => fn());
}

export function setUser(u: AuthUser | null) {
  _user = u;
  _notify();
}

let _logoutHandler: (() => void) | null = null;

export function registerLogout(fn: () => void) {
  _logoutHandler = fn;
}

export function logout() {
  _logoutHandler?.();
}

/** Switch the active branch (owner). Reloads so every page refetches scoped
    to the new branch via the X-Branch header. */
export function switchBranch(slug: string) {
  setActiveBranch(slug);
  window.location.reload();
}

export function useUser(): AuthUser | null {
  return useSyncExternalStore(
    (cb) => { _listeners.add(cb); return () => _listeners.delete(cb); },
    () => _user,
  );
}
