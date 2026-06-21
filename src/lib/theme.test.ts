import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStoredPref, isThemePref, resolveTheme, THEME_STORAGE_KEY } from '@/lib/theme';

// Vitest runs in the node env (no DOM), so stub a minimal `window` with the two
// surfaces the pure logic reads: matchMedia (for 'system') and localStorage.
const store = new Map<string, string>();
function stubWindow(systemDark: boolean) {
  store.clear();
  vi.stubGlobal('window', {
    matchMedia: (q: string) => ({ matches: q.includes('dark') ? systemDark : false }),
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('theme', () => {
  it('isThemePref guards the three valid prefs', () => {
    expect(isThemePref('light')).toBe(true);
    expect(isThemePref('dark')).toBe(true);
    expect(isThemePref('system')).toBe(true);
    expect(isThemePref('blue')).toBe(false);
    expect(isThemePref(null)).toBe(false);
  });

  it('resolveTheme: explicit wins, system follows prefers-color-scheme', () => {
    stubWindow(true);
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('system')).toBe('dark');
    stubWindow(false);
    expect(resolveTheme('system')).toBe('light');
  });

  it('getStoredPref defaults to system for missing/invalid values', () => {
    stubWindow(false);
    expect(getStoredPref()).toBe('system');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'nonsense');
    expect(getStoredPref()).toBe('system');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(getStoredPref()).toBe('dark');
  });
});
