/** Theme cycle dark → light → system, persisted; pre-paint script in index.html. */
import { useCallback, useEffect, useState } from 'react';

export const THEME_ORDER = ['dark', 'light', 'system'] as const;
export type ThemePref = (typeof THEME_ORDER)[number];

function themePref(): ThemePref {
  const v = localStorage.getItem('nookTheme');
  return v === 'light' || v === 'system' ? v : 'dark';
}

function resolveTheme(pref: ThemePref): 'dark' | 'light' {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(themePref);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolveTheme(pref));
  }, [pref]);

  // React to OS scheme changes while in "system".
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      if (themePref() === 'system')
        document.documentElement.setAttribute('data-theme', resolveTheme('system'));
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const cycle = useCallback(() => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(themePref()) + 1) % THEME_ORDER.length];
    localStorage.setItem('nookTheme', next);
    setPref(next);
    return next;
  }, []);

  return { pref, cycle };
}
