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
    <div className="mb-8 border border-border p-4">
      <div className="mb-4 t-eyebrow text-muted">Vibe check</div>
      <div className="flex flex-col gap-4">
        {FIELDS.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between gap-3">
            <span className="text-sm text-subtle">{label}</span>
            <div className="flex gap-1">
              {SCALE.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setVibe((v) => ({ ...v, [key]: n }))}
                  className={`flex h-9 w-9 items-center justify-center border text-sm tabular-nums ${
                    vibe[key] === n ? 'border-fg bg-fg text-bg' : 'border-border text-muted hover:text-fg'
                  }`}
                  aria-label={`${label} ${n}`}
                  aria-pressed={vibe[key] === n}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-3">
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
