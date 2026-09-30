import { useState } from 'react';
import { SORE_AREAS, type SoreAreaKey } from '@/app.config';
import type { VibeCheck } from '@/lib/types';

type Sore = NonNullable<VibeCheck['sore']>;
const KEYS = Object.keys(SORE_AREAS) as SoreAreaKey[];
const COARSE_KEYS = KEYS.filter((k) => SORE_AREAS[k].coarse);
const SPECIFIC_KEYS = KEYS.filter((k) => !SORE_AREAS[k].coarse);

// Where the soreness is: four coarse toggles, with the muscle regions one tap
// further in for when "Lower" is not enough to tell a squat day from a run.
// Multi-select, so these are toggle buttons with aria-pressed, not a radiogroup.
export function SoreAreaPicker({ value, onChange }: { value: Sore; onChange: (next: Sore) => void }) {
  // Opens already expanded when a specific region is set.
  const [specific, setSpecific] = useState(() => value.some((k) => !SORE_AREAS[k]?.coarse));
  const toggle = (k: Sore[number]) =>
    onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);

  // The glyph is h-8; the h-11 button with -my-1.5 keeps the 44px tap target
  // without growing the grid row.
  const chip = (k: Sore[number], label: string) => (
    <button
      key={k}
      type="button"
      aria-pressed={value.includes(k)}
      onClick={() => toggle(k)}
      className="-my-1.5 flex h-11 items-center"
    >
      <span
        className={`flex h-8 w-full items-center justify-center border text-xs uppercase tracking-wider ${
          value.includes(k) ? 'border-fg bg-fg text-bg' : 'border-border text-muted hover:text-fg'
        }`}
      >
        {label}
      </span>
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-subtle">Where</span>
        <button
          type="button"
          aria-pressed={specific}
          onClick={() => setSpecific((s) => !s)}
          className="-my-2 flex min-h-11 items-center t-label text-muted hover:text-fg"
        >
          {specific ? '− Muscles' : '+ Muscles'}
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1">{COARSE_KEYS.map((k) => chip(k, SORE_AREAS[k].label))}</div>
      {specific ? (
        <div className="grid grid-cols-4 gap-1">
          {SPECIFIC_KEYS.map((k) => chip(k, SORE_AREAS[k].label))}
        </div>
      ) : null}
    </div>
  );
}
