import { useEffect, useState, type CSSProperties } from 'react';
import {
  applyBackground,
  BACKGROUNDS,
  BACKGROUND_KEYS,
  getStoredBackground,
  isBackgroundKey,
  type BackgroundKey,
} from '@/lib/background';
import { InfoPopover } from '@/components/ui/InfoPopover';

// A miniature of each preset, painted from tokens only (`--color-faint` ink on
// `--color-bg` paper) so it follows the theme like the real backdrop does. The
// real presets live in global.css and use literal alphas an SVG data URI can
// read; these are previews, not copies, and only need to be told apart.
const INK = 'var(--color-faint)';
const PREVIEW: Record<BackgroundKey, CSSProperties> = {
  off: {},
  grain: {
    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 7px, ${INK} 7px 8px)`,
  },
  dots: {
    backgroundImage: `radial-gradient(${INK} 1px, transparent 1.5px)`,
    backgroundSize: '7px 7px',
    backgroundPosition: '3px 3px',
  },
  hairlines: {
    backgroundImage: `linear-gradient(${INK} 1px, transparent 1px), linear-gradient(90deg, ${INK} 1px, transparent 1px)`,
    backgroundSize: '11px 11px',
  },
  topography: {
    backgroundImage: `repeating-radial-gradient(circle at 50% 50%, transparent 0 5px, ${INK} 5px 6px)`,
  },
  aurora: {
    backgroundImage: `linear-gradient(160deg, var(--color-elevated) 20%, ${INK} 100%)`,
  },
};

// You → Appearance → Backdrop: a label row naming the current preset, then one
// 44px swatch per preset. The swatch is the button (aria-pressed, labelled by
// the preset name); selected gets an ink outline. No `hill-btn` — its pressed
// fill would paint over the preview.
export function BackgroundPicker() {
  const [value, setValue] = useState<BackgroundKey>('off');

  useEffect(() => {
    // Mirror the resolution order used by Base.astro's FOUC script:
    // explicit localStorage wins, otherwise read whatever data-bg ended up
    // as after device-aware defaulting.
    // getStoredBackground, not a bare localStorage read: the read throws where
    // site data is blocked, and this effect runs inside /app/you's island.
    const stored = getStoredBackground();
    if (stored) {
      setValue(stored);
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
    <div className="flex flex-col gap-2">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2">
          <span className="t-label text-muted">Backdrop</span>
          <InfoPopover>
            The texture behind the app. Depth is device-gated — touch and reduced-motion devices
            default to a flatter preset.
          </InfoPopover>
        </span>
        <span className="text-sm text-fg">{BACKGROUNDS[value].label}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {BACKGROUND_KEYS.map((k) => {
          const selected = value === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => pick(k)}
              aria-pressed={selected}
              aria-label={BACKGROUNDS[k].label}
              title={BACKGROUNDS[k].label}
              className={`h-11 w-11 shrink-0 rounded-control border-2 p-0.5 transition-colors ${
                selected ? 'border-fg' : 'border-transparent hover:border-border'
              }`}
            >
              <span
                aria-hidden="true"
                className="block h-full w-full rounded-chip bg-bg"
                style={PREVIEW[k]}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
