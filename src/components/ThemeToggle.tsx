import { useEffect, useState } from 'react';
import { applyTheme, getStoredPref, THEME_PREFS, type ThemePref } from '@/lib/theme';

const LABEL: Record<ThemePref, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

const HINT: Record<ThemePref, string> = {
  light: 'Always light.',
  dark: 'Always dark.',
  system: 'Follows your device setting.',
};

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>('system');

  useEffect(() => {
    setPref(getStoredPref());
  }, []);

  function pick(p: ThemePref) {
    setPref(p);
    applyTheme(p);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {THEME_PREFS.map((p) => {
          const selected = pref === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => pick(p)}
              aria-pressed={selected}
              className={`hill-btn min-h-11 border bg-surface px-3 text-[0.7rem] uppercase tracking-wider transition-colors ${
                selected ? 'border-fg text-fg' : 'border-border text-muted hover:border-fg hover:text-fg'
              }`}
            >
              {LABEL[p]}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[0.7rem] text-muted">{HINT[pref]}</p>
    </div>
  );
}
