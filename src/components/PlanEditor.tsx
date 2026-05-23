import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getActivePlan, updatePlan } from '@/lib/queries';
import {
  addDay,
  addExercise,
  moveDay,
  moveExercise,
  planWeeks,
  removeDay,
  removeExercise,
  setDayLabel,
  setExerciseMovement,
  setExerciseSection,
  setPlanned,
  setTitle,
} from '@/lib/planEdits';
import { SECTIONS, type SectionKey } from '@/app.config';
import type { ParsedPlan } from '@/lib/types';
import { Button, EmptyState } from '@/components/ui/primitives';

const SAVE_DEBOUNCE_MS = 1200;
const cellClass =
  'min-h-9 w-full border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-subtle';

export default function PlanEditor() {
  const [ready, setReady] = useState(false);
  const [planId, setPlanId] = useState<string | null>(null);
  const [plan, setPlan] = useState<ParsedPlan | null>(null);
  const [save, setSave] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle');
  const [extraWeeks, setExtraWeeks] = useState(0);

  const dragDay = useRef<number | null>(null);
  const dragEx = useRef<{ di: number; ei: number } | null>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        window.location.href = '/login';
        return;
      }
      const active = await getActivePlan();
      if (active) {
        setPlanId(active.id);
        setPlan(active.parsed);
      }
      setReady(true);
    })();
  }, []);

  // Debounced autosave on every edit (skips the initial load).
  useEffect(() => {
    if (!plan || !planId) return;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setSave('pending');
    const t = setTimeout(async () => {
      setSave('saving');
      const ok = await updatePlan(planId, plan);
      setSave(ok ? 'saved' : 'idle');
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [plan, planId]);

  if (!ready) return <div className="px-6 py-16 text-sm text-muted">Loading…</div>;

  if (!plan) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="mb-6 font-display text-3xl font-semibold tracking-tight text-fg">Edit plan</h1>
        <EmptyState>
          No active plan.{' '}
          <a href="/app/plan/upload" className="text-fg underline hover:text-subtle">
            Create one
          </a>
          .
        </EmptyState>
      </div>
    );
  }

  const cols = Math.max(planWeeks(plan), extraWeeks);
  const weeks = Array.from({ length: cols }, (_, i) => i + 1);
  const edit = (fn: (p: ParsedPlan) => ParsedPlan) => setPlan((p) => (p ? fn(p) : p));

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between gap-4">
        <input
          value={plan.title}
          onChange={(e) => edit((p) => setTitle(p, e.target.value))}
          className="min-w-0 flex-1 border-b border-border bg-transparent pb-1 font-display text-3xl font-semibold tracking-tight text-fg outline-none focus:border-subtle"
          aria-label="Plan title"
        />
        <div className="flex shrink-0 items-center gap-4">
          <span className="text-[0.7rem] uppercase tracking-wider text-muted">
            {save === 'saving' ? 'Saving…' : save === 'pending' ? 'Editing…' : save === 'saved' ? 'Saved' : ''}
          </span>
          <a href="/app/plan" className="text-[0.7rem] uppercase tracking-wider text-muted hover:text-fg">
            Done →
          </a>
        </div>
      </header>

      {plan.days.map((day, di) => (
        <section
          key={day.dayKey}
          className="mb-8"
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragDay.current != null && dragDay.current !== di) edit((p) => moveDay(p, dragDay.current!, di));
            dragDay.current = null;
          }}
        >
          <div className="mb-3 flex items-center gap-2">
            <span
              draggable
              onDragStart={() => (dragDay.current = di)}
              className="cursor-grab select-none px-1 text-muted"
              aria-hidden="true"
            >
              ⠿
            </span>
            <input
              value={day.label}
              onChange={(e) => edit((p) => setDayLabel(p, di, e.target.value))}
              className="min-w-0 flex-1 border-b border-transparent bg-transparent font-display text-lg text-fg outline-none hover:border-border focus:border-subtle"
              aria-label={`Day ${di + 1} label`}
            />
            <button
              onClick={() => edit((p) => moveDay(p, di, di - 1))}
              disabled={di === 0}
              className="px-2 text-muted hover:text-fg disabled:opacity-30"
              aria-label="Move day up"
            >
              ↑
            </button>
            <button
              onClick={() => edit((p) => moveDay(p, di, di + 1))}
              disabled={di === plan.days.length - 1}
              className="px-2 text-muted hover:text-fg disabled:opacity-30"
              aria-label="Move day down"
            >
              ↓
            </button>
            <button
              onClick={() => edit((p) => removeDay(p, di))}
              className="px-2 text-muted hover:text-accent"
              aria-label="Delete day"
            >
              ×
            </button>
          </div>

          <div className="overflow-x-auto border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[0.65rem] uppercase tracking-wider text-muted">
                  <th className="border-b border-border px-2 py-2 text-left font-medium">Movement</th>
                  <th className="border-b border-l border-border px-2 py-2 text-left font-medium">Section</th>
                  {weeks.map((w) => (
                    <th key={w} className="border-b border-l border-border px-2 py-2 text-center font-medium">
                      W{w}
                    </th>
                  ))}
                  <th className="border-b border-l border-border px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {day.exercises.map((ex, ei) => (
                  <tr
                    key={ei}
                    className="border-b border-border last:border-0"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      const src = dragEx.current;
                      if (src && src.di === di && src.ei !== ei) edit((p) => moveExercise(p, di, src.ei, ei));
                      dragEx.current = null;
                    }}
                  >
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        <span
                          draggable
                          onDragStart={() => (dragEx.current = { di, ei })}
                          className="cursor-grab select-none text-muted"
                          aria-hidden="true"
                        >
                          ⠿
                        </span>
                        <input
                          value={ex.movement}
                          onChange={(e) => edit((p) => setExerciseMovement(p, di, ei, e.target.value))}
                          placeholder="Movement"
                          className={cellClass}
                          aria-label="Movement name"
                        />
                      </div>
                    </td>
                    <td className="border-l border-border px-2 py-1">
                      <select
                        value={ex.section}
                        onChange={(e) => edit((p) => setExerciseSection(p, di, ei, e.target.value as SectionKey))}
                        className={cellClass}
                        aria-label="Section"
                      >
                        {SECTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    {weeks.map((w) => (
                      <td key={w} className="border-l border-border px-2 py-1">
                        <input
                          value={ex.plannedByWeek[w] ?? ''}
                          onChange={(e) => edit((p) => setPlanned(p, di, ei, w, e.target.value))}
                          placeholder="·"
                          className={`${cellClass} text-center tabular-nums`}
                          aria-label={`Week ${w} planned`}
                        />
                      </td>
                    ))}
                    <td className="border-l border-border px-1 py-1 text-center">
                      <div className="flex items-center justify-center">
                        <button
                          onClick={() => edit((p) => moveExercise(p, di, ei, ei - 1))}
                          disabled={ei === 0}
                          className="px-1 text-muted hover:text-fg disabled:opacity-30"
                          aria-label="Move exercise up"
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => edit((p) => moveExercise(p, di, ei, ei + 1))}
                          disabled={ei === day.exercises.length - 1}
                          className="px-1 text-muted hover:text-fg disabled:opacity-30"
                          aria-label="Move exercise down"
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => edit((p) => removeExercise(p, di, ei))}
                          className="px-1 text-muted hover:text-accent"
                          aria-label="Delete exercise"
                        >
                          ×
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={() => edit((p) => addExercise(p, di))}
            className="mt-2 text-[0.7rem] uppercase tracking-wider text-muted hover:text-fg"
          >
            + Exercise
          </button>
        </section>
      ))}

      <div className="flex gap-3">
        <Button variant="ghost" onClick={() => edit((p) => addDay(p))}>
          + Day
        </Button>
        <Button variant="ghost" onClick={() => setExtraWeeks(cols + 1)}>
          + Week
        </Button>
      </div>
    </div>
  );
}
