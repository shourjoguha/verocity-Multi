import { useState } from 'react';
import { FITNESS_ASPECTS, ASPECT_SCALE, type AspectKey } from '@/app.config';
import type { AspectScores, FitnessAssessment } from '@/lib/types';
import { createAssessment } from '@/lib/queries';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/lib/toast';

// Fitness check-in: rate each aspect 1–10. Hybrid — auto axes seed from the
// computed suggestion (falling back to the last assessment, else the midpoint),
// and every axis is adjustable before saving a dated snapshot.
const MID = Math.round((ASPECT_SCALE.min + ASPECT_SCALE.max) / 2);

export function FitnessCheckIn({
  open,
  onClose,
  previous,
  suggestions,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  previous: AspectScores;
  suggestions: AspectScores;
  onSaved: (a: FitnessAssessment) => void;
}) {
  const seed = (k: AspectKey) => suggestions[k] ?? previous[k] ?? MID;
  const [scores, setScores] = useState<Record<AspectKey, number>>(
    () => Object.fromEntries(FITNESS_ASPECTS.map((a) => [a.key, seed(a.key)])) as Record<AspectKey, number>,
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const created = await createAssessment(scores as AspectScores);
    setSaving(false);
    if (!created) {
      toast('Could not save check-in', 'error');
      return;
    }
    onSaved(created);
    toast('Fitness check-in saved', 'success');
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Fitness check-in">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="mb-5 text-xs text-subtle">
          Rate where you are today, 1–10. Auto-suggested axes are seeded from your recent
          training — adjust anything that doesn't feel right.
        </p>
        <div className="flex flex-col gap-5">
          {FITNESS_ASPECTS.map((a) => (
            <div key={a.key}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="text-sm text-fg">{a.label}</span>
                <span className="flex items-baseline gap-2">
                  {suggestions[a.key as AspectKey] != null ? (
                    <span className="text-[0.6rem] uppercase tracking-wider text-muted">
                      suggested {suggestions[a.key as AspectKey]}
                    </span>
                  ) : null}
                  <span className="font-display text-lg tabular-nums tracking-tight text-fg">
                    {scores[a.key]}
                  </span>
                </span>
              </div>
              <input
                type="range"
                min={ASPECT_SCALE.min}
                max={ASPECT_SCALE.max}
                step={1}
                value={scores[a.key]}
                onChange={(e) =>
                  setScores((s) => ({ ...s, [a.key]: Number(e.target.value) }))
                }
                aria-label={a.label}
                className="w-full"
                style={{ accentColor: 'var(--color-fg)' }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-border p-4">
        <button
          type="button"
          onClick={onClose}
          className="hill-btn inline-flex min-h-11 items-center border border-border bg-surface px-4 text-sm uppercase tracking-wider text-fg transition-colors hover:border-fg"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="hill-btn ml-auto inline-flex min-h-11 items-center bg-fg px-5 text-sm uppercase tracking-wider text-bg transition-colors hover:bg-fg/85 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save check-in'}
        </button>
      </div>
    </Modal>
  );
}
