import { useEffect, useState } from 'react';
import {
  applyBackground,
  BACKGROUNDS,
  BACKGROUND_KEYS,
  BACKGROUND_STORAGE_KEY,
  isBackgroundKey,
  type BackgroundKey,
} from '@/lib/background';

export function BackgroundPicker() {
  const [value, setValue] = useState<BackgroundKey>('off');

  useEffect(() => {
    // Mirror the resolution order used by Base.astro's FOUC script:
    // explicit localStorage wins, otherwise read whatever data-bg ended up
    // as after device-aware defaulting.
    const raw = window.localStorage.getItem(BACKGROUND_STORAGE_KEY);
    if (isBackgroundKey(raw)) {
      setValue(raw);
      return;
    }
    const attr = document.documentElement.getAttribute('data-bg');
    if (isBackgroundKey(attr)) setValue(attr);
  }, []);

  function pick(key: BackgroundKey) {
    setValue(key);
    applyBackground(key);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {BACKGROUND_KEYS.map((k) => {
          const selected = value === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => pick(k)}
              aria-pressed={selected}
              className={`hill-btn min-h-11 border bg-surface px-3 t-control transition-colors ${
                selected ? 'border-fg text-fg' : 'border-border text-muted hover:border-fg hover:text-fg'
              }`}
            >
              {BACKGROUNDS[k].label}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[0.7rem] text-muted">{BACKGROUNDS[value].description}</p>
    </div>
  );
}
