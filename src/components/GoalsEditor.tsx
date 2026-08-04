import { useEffect, useState } from 'react';
import { GOAL_DEFAULTS, GOALS, GOAL_WEIGHT, STATS_LIMITS, type GoalKey } from '@/app.config';
import { getUserStats, upsertUserStats } from '@/lib/queries';
import type { Goal } from '@/lib/types';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/primitives';

// Rank + weight the user's training goals, stored on `user_stats.goals`
// (migration 0030). LIST ORDER IS THE RANK — the array is saved in the order
// shown, so the ↑/↓ buttons are data and not decoration.
//
// The consumer is buildPlanAiPrompt (src/lib/planTemplate.ts): every goal here
// is rendered into the prompt's ATHLETE PROFILE block and matched against the
// rules in docs/PLAN_RUBRIC.md, which is what decides the plan's rep ranges and
// section emphasis. `label` is what travels, not `id` — free-text goals get a
// uuid id that matches nothing in GOALS.
//
// Saves only the `goals` column: UserStatsPanel owns the rest of the row and
// the two must not overwrite each other (see UserStatsInput in lib/queries.ts).

const DEFAULTS: Goal[] = GOAL_DEFAULTS.map((g) => ({
  id: g.id,
  label: GOALS[g.id as GoalKey].label,
  weight: g.weight,
}));

const rowBtn =
  'inline-flex h-8 w-8 items-center justify-center text-muted transition-colors hover:text-fg disabled:opacity-30 disabled:hover:text-muted';

export function GoalsEditor() {
  const [goals, setGoals] = useState<Goal[]>(DEFAULTS);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const stats = await getUserStats();
      if (!active) return;
      // An empty array means "never saved", not "no goals" — a user who really
      // wants none can remove them all and save, which stores [] and reads back
      // as the defaults again. Living with that: an empty goal list carries no
      // information for the prompt anyway.
      if (stats?.goals?.length) setGoals(stats.goals);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function onSave() {
    if (saving) return;
    setSaving(true);
    const ok = await upsertUserStats({
      goals: goals.filter((g) => g.label.trim() !== ''),
    });
    setSaving(false);
    toast(ok ? 'Goals saved' : 'Could not save — try again', ok ? 'success' : 'error');
  }

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
    if (!label || goals.length >= STATS_LIMITS.maxGoals) return;
    setGoals((gs) => [...gs, { id: crypto.randomUUID(), label, weight: GOAL_WEIGHT.default }]);
    setDraft('');
  }

  if (loading) return <p className="text-sm text-muted">Loading…</p>;

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
                    min={GOAL_WEIGHT.min}
                    max={GOAL_WEIGHT.max}
                    step={GOAL_WEIGHT.step}
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
          maxLength={STATS_LIMITS.goalLabelChars}
          className="min-h-11 flex-1 border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-fg"
        />
        <Button
          variant="ghost"
          onClick={add}
          disabled={draft.trim() === '' || goals.length >= STATS_LIMITS.maxGoals}
        >
          Add
        </Button>
      </div>

      <div>
        <Button onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save goals'}
        </Button>
      </div>
    </div>
  );
}
