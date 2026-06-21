// Single source of truth for the light/dark theme. Mirrors lib/background.ts:
// a localStorage preference + an <html data-theme> attribute + a CustomEvent so
// the live attribute and any React island stay in sync without a reload.
//
// Preference is one of 'light' | 'dark' | 'system'; 'system' follows the OS via
// prefers-color-scheme. The RESOLVED value ('light' | 'dark') is what lands on
// data-theme and drives the CSS token override in global.css. The pre-paint
// inline script in Base.astro applies the same resolution before first paint
// (no FOUC) and keeps 'system' live when the OS flips.
import { useEffect, useState } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'verocity:theme';
export const THEME_EVENT = 'verocity:theme-change';
export const THEME_PREFS: ThemePref[] = ['light', 'dark', 'system'];

// Mirrors the meta[name=theme-color] swap done in the pre-paint script; keep in
// sync with the dark --color-bg in global.css.
export const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#f2f2f2',
  dark: '#0d0d0d',
};

export function isThemePref(value: string | null | undefined): value is ThemePref {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  return pref === 'system' ? systemTheme() : pref;
}

export function getStoredPref(): ThemePref {
  if (typeof window === 'undefined') return 'system';
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePref(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref: ThemePref): void {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(pref);
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[resolved]);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* localStorage blocked — runtime change still applies via attribute. */
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { pref, resolved } }));
}

// Reactive resolved theme for React islands (e.g. the WebGL scenes that can't
// read CSS vars). Reads the live data-theme attribute and re-reads on every
// theme change — both manual (applyTheme) and system flips (the pre-paint
// script re-dispatches THEME_EVENT when pref is 'system').
export function useResolvedTheme(): ResolvedTheme {
  // Initialize from the live attribute (set pre-paint by Base.astro) so the
  // WebGL scenes don't render one frame of the wrong theme before the effect.
  const [theme, setTheme] = useState<ResolvedTheme>(() =>
    typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'light',
  );
  useEffect(() => {
    const read = () =>
      setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
    read();
    window.addEventListener(THEME_EVENT, read);
    return () => window.removeEventListener(THEME_EVENT, read);
  }, []);
  return theme;
}
