import { useState } from 'react';
import { supabase, supabasePublic } from '@/lib/supabase';
import { getActivePlan, getAllLogs } from '@/lib/queries';
import { useAuthedQuery } from '@/lib/useAuthedQuery';
import { flattenSets } from '@/lib/stats';
import { e1rm } from '@/lib/e1rm';
import { formatRound } from '@/lib/format';
import { BLOCKS, type BlockKey } from '@/app.config';
import type { PlanDay } from '@/lib/types';
import { EmptyState, LoadingScreen } from '@/components/ui/primitives';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';
import { SubroutineBody } from '@/components/SubroutineBody';
import { isSubroutine } from '@/lib/subroutine';
import { planWeekByLog, planWeekCount } from '@/lib/progression';

export default function PlanView({ mode = 'app' }: { mode?: 'app' | 'showcase' }) {
  const showcase = mode === 'showcase';
  const client = showcase ? supabasePublic : supabase;
  const { data, loading } = useAuthedQuery(
    async () => {
      const plan = await getActivePlan(client);
      const logs = plan ? await getAllLogs(client) : [];
      return { plan, logs };
    },
    { auth: !showcase, key: showcase ? undefined : 'plan:view' },
  );

  // Hooks MUST sit above the `if (loading)` return below. The plan (and so
  // maxWeek / lastCompletedWeek) isn't loaded on this render, so weekIndex
  // starts null and the JSX derives the real active week once data lands —
  // seeding it from a useEffect after load would put a hook below an early
  // return on the loaded render only, which is exactly the React error #310
  // trap in docs/LESSONS.md § "The whole page is blank, and two of the three
  // audits are green on it" (both audit:shell and audit:mobile pass on a
  // blank page — they have nothing to measure).
  const [weekIndex, setWeekIndex] = useState<number | null>(null);
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const [matrixDayId, setMatrixDayId] = useState<string | null>(null);

  if (loading) return <LoadingScreen />;

  const plan = data?.plan ?? null;
  const logs = data?.logs ?? [];

  if (!plan) {
    return (
      <div className="mx-auto max-w-3xl px-4 pb-8 pt-5 sm:px-6">
        <EchoText
          text="PLAN"
          as="h1"
          className={`mb-6 ${ECHO_APP_TITLE}`}
        />
        <EmptyState>
          <p>No active plan.</p>
          {showcase ? null : (
            <a
              href="/app/plan/upload"
              className="hill-btn mt-4 inline-flex min-h-11 items-center justify-center border border-border bg-surface px-4 text-sm uppercase tracking-wider text-fg transition-colors hover:border-fg"
            >
              Create one
            </a>
          )}
        </EmptyState>
      </div>
    );
  }

  const parsed = plan.parsed;
  const maxWeek = planWeekCount(parsed);
  const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);

  const blockForWeek = (w: number): BlockKey | null =>
    parsed.blocks.find((b) => w >= b.startWeek && w <= b.endWeek)?.type ?? null;

  // Best actual set per (movement, week) from this plan's done logs, plus the
  // most recent completed week — to overlay real performance onto the plan grid.
  // The week is recomputed from logging order (the Nth session of a day is week
  // N), so stored week_number never drives display.
  const weekByLog = planWeekByLog(plan.id, logs, maxWeek);
  const doneLogs = logs.filter(
    (l) => l.plan_id === plan.id && l.status === 'done' && weekByLog.has(l.id),
  );
  const lastCompletedWeek =
    doneLogs.reduce((m, l) => Math.max(m, weekByLog.get(l.id) ?? 0), 0) || null;
  const actualBest = new Map<string, { e1rm: number; label: string }>();
  for (const log of doneLogs) {
    const wk = weekByLog.get(log.id) as number;
    for (const s of flattenSets(log)) {
      if (s.weight == null || s.reps == null) continue;
      const est = e1rm(s.weight, s.reps);
      if (est == null) continue;
      const key = `${s.movement.toLowerCase()}|${wk}`;
      const cur = actualBest.get(key);
      if (!cur || est > cur.e1rm) {
        actualBest.set(key, { e1rm: est, label: `${formatRound(s.weight)}×${s.reps}` });
      }
    }
  }

  // The plan isn't loaded on the first render (see the comment on weekIndex
  // above), so the active week is derived here rather than seeded into state:
  // default to one past the last completed week, clamped into range.
  const activeWeek = Math.min(
    Math.max(weekIndex ?? (lastCompletedWeek ? lastCompletedWeek + 1 : 1), 1),
    maxWeek,
  );
  const activeBlock = parsed.blocks.find(
    (b) => activeWeek >= b.startWeek && activeWeek <= b.endWeek,
  );

  // A movement counts toward a week if it carries a planned value for that
  // week, or it's a subroutine — subroutines have no per-week value at all
  // (plannedByWeek is always {}) and render every week they appear in.
  const countForWeek = (day: PlanDay, w: number) =>
    day.exercises.filter((ex) => isSubroutine(ex) || ex.plannedByWeek[w]).length;

  const programmedDayCount = parsed.days.filter((d) => countForWeek(d, activeWeek) > 0).length;
  const movementsThisWeek = parsed.days.reduce((sum, d) => sum + countForWeek(d, activeWeek), 0);

  // Week-rail "programmed" caption: any day carries an explicit planned value
  // for that week. Subroutines are intentionally excluded here — they don't
  // vary week to week, so they say nothing about whether a given week differs
  // from an empty one.
  const weekProgrammed = (w: number) =>
    parsed.days.some((d) => d.exercises.some((ex) => ex.plannedByWeek[w]));

  const toggleDay = (dayKey: string) => {
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
  };

  return (
    <PageStagger className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <Item>
        <header className="mb-4">
          <p className="t-eyebrow text-muted">
            Plan · {(activeBlock && BLOCKS[activeBlock.type]?.label) ?? '—'}
          </p>
          <div className="mt-2 flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <EchoText
              text={parsed.title}
              as="h1"
              className={`min-w-0 break-words ${ECHO_APP_TITLE}`}
            />
            {showcase ? null : (
              <div className="flex shrink-0 gap-2">
                <a
                  href="/app/plan/edit"
                  className="hill-btn t-control inline-flex min-h-11 items-center justify-center border border-border bg-surface px-4 text-fg"
                >
                  Edit
                </a>
                <a
                  href="/app/plan/upload"
                  className="hill-btn t-control inline-flex min-h-11 items-center justify-center border border-fg bg-fg px-4 text-bg hover:bg-subtle"
                >
                  New plan
                </a>
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            {activeBlock ? (
              <span className="inline-flex items-center gap-2 t-control text-muted">
                <span
                  className="inline-block h-2 w-2"
                  style={{ backgroundColor: BLOCKS[activeBlock.type]?.color }}
                />
                {BLOCKS[activeBlock.type]?.label ?? activeBlock.type} · W{activeBlock.startWeek}–
                {activeBlock.endWeek}
              </span>
            ) : null}
            <span className="t-control text-muted">
              W{activeWeek} · {programmedDayCount} days · {movementsThisWeek} movements
            </span>
          </div>
        </header>

        {/* Deliberately not `ui/SegmentedTabs` — CLAUDE.md says "do not roll a
            sixth" segmented control, so the next reader will otherwise want to
            fold this in. It can't be one: each cell needs its own phase-colour
            stripe, a second caption line under the label, and horizontal
            scroll past ~6 weeks, none of which SegmentedTabs supports.
            Not sticky: the mockup pins it at `sticky top-[82px]`, a magic
            number tied to its own fixed header. App.astro's header is
            `h-12 + pt-safe` and auto-hides on scroll, so a hard offset here
            would detach the same way a viewport-anchored bottom bar does. */}
        <div className="mb-6 overflow-x-auto">
          <div role="tablist" aria-label="Week" className="flex min-w-max gap-1">
            {weeks.map((w) => {
              const active = w === activeWeek;
              const programmed = weekProgrammed(w);
              const wBlock = blockForWeek(w);
              return (
                <button
                  key={w}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setWeekIndex(w)}
                  className={`flex min-h-11 min-w-[3.5rem] flex-1 flex-col items-center justify-center gap-1 border bg-surface px-2 py-1 ${
                    active ? 'border-fg' : 'border-border'
                  }`}
                >
                  <span
                    aria-hidden
                    className="h-[3px] w-5"
                    style={{ backgroundColor: wBlock ? BLOCKS[wBlock].color : 'transparent', opacity: active ? 1 : 0.5 }}
                  />
                  <span className={`t-control ${active ? 'font-medium text-fg' : 'text-muted'}`}>
                    W{w}
                  </span>
                  <span className="t-label text-faint">{programmed ? 'set' : 'open'}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Item>

      {parsed.days.map((day, i) => {
        const letter = String.fromCharCode(65 + i);
        const count = countForWeek(day, activeWeek);
        const hasContent = count > 0;
        const isCollapsed = collapsedDays.has(day.dayKey);
        const isMatrix = matrixDayId === day.dayKey;

        return (
          <Item key={day.dayKey}>
            <section className="mb-4 overflow-hidden rounded-card border border-border bg-surface">
              {/* Bespoke, not `ui/Disclosure` — that primitive is a native
                  `<details>` whose entire `<summary>` IS the toggle, and this
                  header needs two more independently-interactive controls
                  (All weeks, Start) beside it. Nesting them inside a
                  `<summary>` is a click-target conflict, not just untidy. */}
              <div className="flex min-h-11 items-stretch">
                <button
                  type="button"
                  onClick={() => toggleDay(day.dayKey)}
                  aria-expanded={!isCollapsed}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-4 text-left text-fg"
                >
                  <span
                    aria-hidden
                    className={`inline-block shrink-0 text-[0.7rem] transition-transform ${
                      isCollapsed ? '' : 'rotate-90'
                    }`}
                  >
                    ▸
                  </span>
                  {/* The count is a non-shrinking SIBLING of the truncating
                      label, not part of it. Inside the same span the ellipsis
                      ate it at 393px and the card lost the one number that
                      says how much is programmed this week. */}
                  <span className="min-w-0 truncate t-control">
                    Day {letter} · {day.label}
                  </span>
                  <span className="shrink-0 t-control text-faint tabular-nums">{count}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMatrixDayId((prev) => (prev === day.dayKey ? null : day.dayKey))}
                  aria-pressed={isMatrix}
                  className={`hill-btn t-control mr-2 inline-flex min-h-11 shrink-0 items-center self-center border px-3 ${
                    isMatrix ? 'border-fg bg-fg text-bg' : 'border-border bg-surface text-muted'
                  }`}
                >
                  All weeks
                </button>
                {showcase ? null : (
                  <a
                    href={`/app/log?day=${encodeURIComponent(day.dayKey)}`}
                    className="t-control -mr-1 inline-flex min-h-11 shrink-0 items-center self-center px-3 text-muted transition-colors hover:text-fg"
                  >
                    Start →
                  </a>
                )}
              </div>

              {isCollapsed ? null : (
                <div className="border-t border-border">
                  {!hasContent ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
                      <p className="t-label text-faint">Not programmed yet</p>
                      {showcase ? null : (
                        <a
                          href="/app/plan/edit"
                          className="t-control inline-flex min-h-11 items-center px-3 text-muted transition-colors hover:text-fg"
                        >
                          Edit plan →
                        </a>
                      )}
                    </div>
                  ) : isMatrix ? (
                    // No border of its own: the day card already supplies the
                    // outer hairline, and the `border-t` above this box divides
                    // it from the header. A second `border border-border` here
                    // doubled the rule on all four sides.
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="t-control text-muted">
                            <th className="sticky left-0 z-10 border-b border-border bg-surface px-3 py-2 text-left font-medium">
                              Movement
                            </th>
                            {weeks.map((w) => (
                              <th
                                key={w}
                                className={`border-b border-l border-border px-3 py-2 text-center font-medium ${
                                  w === lastCompletedWeek ? 'bg-elevated text-fg' : ''
                                }`}
                              >
                                <span
                                  className="mx-auto mb-1 block h-1 w-4"
                                  style={{
                                    backgroundColor: blockForWeek(w)
                                      ? BLOCKS[blockForWeek(w)!].color
                                      : 'transparent',
                                  }}
                                />
                                W{w}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {day.exercises.map((ex, exi) =>
                            isSubroutine(ex) ? (
                              <tr key={exi} className="border-b border-border last:border-0">
                                <td className="sticky left-0 z-10 bg-surface px-3 py-2 capitalize text-fg">
                                  {ex.movement}
                                </td>
                                <td colSpan={weeks.length} className="border-l border-border px-3 py-2">
                                  <SubroutineBody description={ex.description} url={ex.url} />
                                </td>
                              </tr>
                            ) : (
                              <tr key={exi} className="border-b border-border last:border-0">
                                <td className="sticky left-0 z-10 bg-surface px-3 py-2 capitalize text-fg">
                                  {ex.movement}
                                </td>
                                {weeks.map((w) => {
                                  const actual = actualBest.get(`${ex.movement.toLowerCase()}|${w}`);
                                  return (
                                    <td
                                      key={w}
                                      title={actual ? `Best actual · W${w}` : undefined}
                                      className={`border-l border-border px-3 py-2 text-center tabular-nums ${
                                        w === lastCompletedWeek ? 'bg-elevated' : ''
                                      } ${actual ? 'font-medium text-fg' : 'text-subtle'}`}
                                    >
                                      {actual ? actual.label : (ex.plannedByWeek[w] ?? '·')}
                                    </td>
                                  );
                                })}
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <ul className="text-sm sm:grid sm:grid-cols-2">
                      {day.exercises.map((ex, exi) => {
                        if (isSubroutine(ex)) {
                          return (
                            <li
                              key={exi}
                              className="border-t border-border-soft px-4 py-3 first:border-t-0 sm:col-span-2"
                            >
                              <p className="mb-1 truncate capitalize text-fg t-control">{ex.movement}</p>
                              <SubroutineBody description={ex.description} url={ex.url} />
                            </li>
                          );
                        }
                        const actual = actualBest.get(`${ex.movement.toLowerCase()}|${activeWeek}`);
                        const prev = ex.plannedByWeek[activeWeek - 1];
                        const changed = ex.plannedByWeek[activeWeek] !== prev;
                        return (
                          <li
                            key={exi}
                            className="flex min-h-11 items-center justify-between gap-3 border-t border-border-soft px-4 py-2 first:border-t-0 sm:[&:nth-child(-n+2)]:border-t-0"
                          >
                            <span className="flex min-w-0 flex-1 items-center gap-2">
                              {changed ? (
                                <span
                                  aria-hidden
                                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                                  style={{
                                    backgroundColor: activeBlock ? BLOCKS[activeBlock.type]?.color : undefined,
                                  }}
                                  title={`W${activeWeek - 1}: ${prev ?? '—'}`}
                                />
                              ) : null}
                              <span className="truncate capitalize text-fg">{ex.movement}</span>
                            </span>
                            <span
                              title={actual ? `Best actual · W${activeWeek}` : undefined}
                              className={`shrink-0 tabular-nums ${
                                actual ? 'font-medium text-fg' : 'text-subtle'
                              }`}
                            >
                              {actual ? actual.label : (ex.plannedByWeek[activeWeek] ?? '—')}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </section>
          </Item>
        );
      })}
    </PageStagger>
  );
}
