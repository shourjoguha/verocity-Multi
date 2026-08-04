import { useState } from 'react';
import { Button } from '@/components/ui/primitives';

// Rank + weight the user's training goals. No wiring: nothing reads this state
// and it does not persist across reloads — the intent is UI shape, not a
// stored preference. If a downstream ever wants this, this is the seam.

interface Goal {
  id: string;
  label: string;
  weight: number;
}

const DEFAULTS: Goal[] = [
  { id: 'strength', label: 'Strength', weight: 70 },
  { id: 'hypertrophy', label: 'Hypertrophy', weight: 50 },
  { id: 'endurance', label: 'Endurance', weight: 40 },
  { id: 'mobility', label: 'Mobility', weight: 30 },
  { id: 'skill', label: 'Skill work', weight: 20 },
];

const rowBtn =
  'inline-flex h-8 w-8 items-center justify-center text-muted transition-colors hover:text-fg disabled:opacity-30 disabled:hover:text-muted';

export function GoalsEditor() {
  const [goals, setGoals] = useState<Goal[]>(DEFAULTS);
  const [draft, setDraft] = useState('');

  function move(id: string, delta: -1 | 1) {
    setGoals((gs) => {
      const i = gs.findIndex((g) => g.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= gs.length) return gs;
      const next = gs.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function setWeight(id: string, weight: number) {
    setGoals((gs) => gs.map((g) => (g.id === id ? { ...g, weight } : g)));
  }

  function remove(id: string) {
    setGoals((gs) => gs.filter((g) => g.id !== id));
  }

  function add() {
    const label = draft.trim();
    if (!label) return;
    setGoals((gs) => [...gs, { id: crypto.randomUUID(), label, weight: 40 }]);
    setDraft('');
  }

  return (
    <div className="flex flex-col gap-4">
      {goals.length === 0 ? (
        <p className="text-[0.7rem] text-muted">No goals — add one below.</p>
      ) : (
        <ol className="flex flex-col gap-px bg-border">
          {goals.map((g, i) => (
            <li
              key={g.id}
              className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-3 bg-surface px-3 py-2"
            >
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => move(g.id, -1)}
                  disabled={i === 0}
                  className={rowBtn}
                  aria-label={`Move ${g.label} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(g.id, 1)}
                  disabled={i === goals.length - 1}
                  className={rowBtn}
                  aria-label={`Move ${g.label} down`}
                >
                  ↓
                </button>
              </div>
              <span className="t-eyebrow w-6 tabular-nums text-muted">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm text-fg">{g.label}</div>
                <div className="mt-1 flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={g.weight}
                    onChange={(e) => setWeight(g.id, Number(e.target.value))}
                    aria-label={`${g.label} weight`}
                    className="h-1 flex-1 accent-fg"
                  />
                  <span className="t-label w-8 shrink-0 text-right tabular-nums text-muted">
                    {g.weight}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(g.id)}
                className={rowBtn}
                aria-label={`Remove ${g.label}`}
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add a goal…"
          aria-label="New goal"
          className="min-h-11 flex-1 border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-fg"
        />
        <Button variant="ghost" onClick={add} disabled={draft.trim() === ''}>
          Add
        </Button>
      </div>
    </div>
  );
}
