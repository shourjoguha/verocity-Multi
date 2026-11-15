import { useEffect, useState } from 'react';
import { GOAL_DEFAULTS, GOALS, GOAL_WEIGHT, STATS_LIMITS, type GoalKey } from '@/app.config';
import { getUserStats, upsertUserStats } from '@/lib/queries';
import type { Goal } from '@/lib/types';
import { toast } from '@/lib/toast';
import { Button, FIELD } from '@/components/ui/primitives';

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

// Each goal is ONE compact row — rank, label, a thin weight bar, the weight —
// and the row itself is the button that opens it. Only one row is open at a
// time; the open row adds the weight slider and Up / Down / Remove. The row is a
// genuine min-h-11 with no negative margin: a faked row height overlaps its
// neighbours in a vertical list (docs/LESSONS.md, "The slim-thumb trick does not
// transfer to a stacked list"). Rows are divided by soft hairlines, no gaps.
//
// Save stays explicit (owner decision: changes must be discardable — leave the
// page and nothing was written), and is the section's one primary. It enables
// only when the list differs from what is stored, or when nothing is stored yet
// and the defaults on screen have never been saved.

const span = GOAL_WEIGHT.max - GOAL_WEIGHT.min;
const sameGoals = (a: Goal[], b: Goal[]) => JSON.stringify(a) === JSON.stringify(b);

export function GoalsEditor() {
  const [goals, setGoals] = useState<Goal[]>(DEFAULTS);
  // What is stored, or null when nothing has ever been saved.
  const [saved, setSaved] = useState<Goal[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
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
      if (stats?.goals?.length) {
        setGoals(stats.goals);
        setSaved(stats.goals);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const dirty = saved === null || !sameGoals(goals, saved);

  async function onSave() {
    if (saving || !dirty) return;
    setSaving(true);
    const next = goals.filter((g) => g.label.trim() !== '');
    const ok = await upsertUserStats({ goals: next });
    setSaving(false);
    if (ok) {
      setGoals(next);
      setSaved(next);
    }
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
    setOpenId(null);
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
        // -mx-4 -mt-4: flush with the Disclosure body edges, so the rows read
        // as the card's own rows under its summary divider.
        <ol className="-mx-4 -mt-4 border-b border-border-soft [&>*+*]:border-t [&>*+*]:border-border-soft">
          {goals.map((g, i) => {
            const open = openId === g.id;
            const pct = Math.max(0, Math.min(100, ((g.weight - GOAL_WEIGHT.min) / span) * 100));
            const panelId = `goal-panel-${g.id}`;
            return (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : g.id)}
                  aria-expanded={open}
                  aria-controls={panelId}
                  className="flex min-h-11 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-tappable-hover"
                >
                  <span className="t-eyebrow w-6 shrink-0 tabular-nums text-muted">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">{g.label}</span>
                  <span aria-hidden="true" className="h-1 w-14 shrink-0 overflow-hidden rounded-[1px] bg-elevated">
                    <span className="block h-full bg-fg" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="t-label w-8 shrink-0 text-right tabular-nums text-fg">{g.weight}</span>
                </button>
                {open ? (
                  <div id={panelId} className="flex flex-col gap-3 px-4 pb-3">
                    <input
                      type="range"
                      min={GOAL_WEIGHT.min}
                      max={GOAL_WEIGHT.max}
                      step={GOAL_WEIGHT.step}
                      value={g.weight}
                      onChange={(e) => setWeight(g.id, Number(e.target.value))}
                      aria-label={`${g.label} weight`}
                      // h-7: the track draws thin, but the input box is the
                      // hit area, and a 4px-tall box was a 4px-tall target.
                      className="h-7 w-full cursor-pointer accent-fg"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => move(g.id, -1)}
                        disabled={i === 0}
                      >
                        ↑ Up
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => move(g.id, 1)}
                        disabled={i === goals.length - 1}
                      >
                        ↓ Down
                      </Button>
                      <Button variant="ghost" onClick={() => remove(g.id)} className="ml-auto">
                        Remove
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
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
            className={FIELD}
          />
        </div>
        <Button
          variant="ghost"
          onClick={add}
          disabled={draft.trim() === '' || goals.length >= STATS_LIMITS.maxGoals}
        >
          Add
        </Button>
      </div>

      <div>
        <Button onClick={onSave} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save goals'}
        </Button>
      </div>
    </div>
  );
}
