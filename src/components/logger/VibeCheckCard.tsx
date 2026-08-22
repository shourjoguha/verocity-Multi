import { useState } from 'react';
import type { VibeCheck } from '@/lib/types';

const SCALE = [1, 2, 3, 4, 5];
const FIELDS: { key: keyof VibeCheck; label: string }[] = [
  { key: 'sleep', label: 'Sleep' },
  { key: 'energy', label: 'Energy' },
  { key: 'soreness', label: 'Soreness' },
];

// Quick pre-session readiness capture (sleep / energy / soreness, 1–5).
// Stored on doc.session.vibe; skippable.
export function VibeCheckCard({
  onSave,
  onSkip,
}: {
  onSave: (vibe: VibeCheck) => void;
  onSkip: () => void;
}) {
  const [vibe, setVibe] = useState<VibeCheck>({ sleep: 3, energy: 3, soreness: 3 });

  return (
    // Banded like the movement cards: a surface-filled card whose heading sits
    // in its own row above an inner hairline, rather than a label floating in
    // shared padding. `mb-8` and the save/skip contract are unchanged.
    <div className="lift mb-4 border border-border bg-surface">
      <div className="flex min-h-11 items-center justify-between gap-2 border-b border-border-soft px-4">
        <span className="t-label text-fg">Readiness</span>
        <span className="t-label text-faint">10 sec check-in</span>
      </div>
      <div className="flex flex-col gap-3 px-4 pt-4">
        {FIELDS.map(({ key, label }) => (
          <div
            key={key}
            role="radiogroup"
            aria-label={label}
            className="flex items-center justify-between gap-3"
          >
            <span className="text-sm text-subtle">{label}</span>
            <div className="flex gap-1">
              {SCALE.map((n) => (
                // The glyph stays h-9 w-9 (36px, the mockup's density); the
                // -my-2 pulls the min-h-11 tap target back so the row doesn't
                // grow to 44px tall — same technique as the +Movement row.
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={vibe[key] === n}
                  aria-label={`${label} ${n}`}
                  onClick={() => setVibe((v) => ({ ...v, [key]: n }))}
                  className="-my-2 flex h-11 w-11 items-center justify-center"
                >
                  <span
                    aria-hidden
                    className={`flex h-9 w-9 items-center justify-center border text-sm tabular-nums ${
                      vibe[key] === n ? 'border-fg bg-fg text-bg' : 'border-border text-muted hover:text-fg'
                    }`}
                  >
                    {n}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-3 p-4">
        <button
          type="button"
          onClick={() => onSave(vibe)}
          className="inline-flex min-h-11 flex-1 items-center justify-center bg-fg px-4 text-sm uppercase tracking-wider text-bg hover:bg-subtle"
        >
          Start session
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="inline-flex min-h-11 items-center justify-center border border-border px-4 text-sm uppercase tracking-wider text-fg hover:border-subtle"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
