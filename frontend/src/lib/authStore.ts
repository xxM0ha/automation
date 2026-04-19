/**
 * Minimal reactive auth store — no external dependencies.
 */
import { useSyncExternalStore } from 'react';
import { getAuth, type AuthUser } from './api';

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

export function useUser(): AuthUser | null {
  return useSyncExternalStore(
    (cb) => { _listeners.add(cb); return () => _listeners.delete(cb); },
    () => _user,
  );
}
