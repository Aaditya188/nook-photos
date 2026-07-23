/** Theme: dark / light / system, persisted; shared across all consumers. */
import { useCallback, useEffect, useSyncExternalStore } from 'react';

export const THEME_ORDER = ['dark', 'light', 'system'] as const;
export type ThemePref = (typeof THEME_ORDER)[number];

function readPref(): ThemePref {
  const v = localStorage.getItem('nookTheme');
  return v === 'light' || v === 'system' ? v : 'dark';
}

function resolveTheme(pref: ThemePref): 'dark' | 'light' {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

// Module-level store so the sidebar radios and topbar toggle stay in sync.
const listeners = new Set<() => void>();
function apply() {
  document.documentElement.setAttribute('data-theme', resolveTheme(readPref()));
}
export function setThemePref(pref: ThemePref) {
  localStorage.setItem('nookTheme', pref);
  apply();
  listeners.forEach((l) => l());
}
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (readPref() === 'system') apply();
  });
}

export function useTheme() {
  const pref = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readPref,
  );

  useEffect(() => {
    apply();
  }, [pref]);

  const set = useCallback((next: ThemePref) => setThemePref(next), []);
  const cycle = useCallback(() => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(readPref()) + 1) % THEME_ORDER.length];
    setThemePref(next);
    return next;
  }, []);

  return { pref, set, cycle };
}
