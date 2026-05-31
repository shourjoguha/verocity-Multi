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
    const raw = window.localStorage.getItem(BACKGROUND_STORAGE_KEY);
    setValue(isBackgroundKey(raw) ? raw : 'off');
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
              className={`min-h-11 border px-3 text-[0.7rem] uppercase tracking-wider transition-colors ${
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
