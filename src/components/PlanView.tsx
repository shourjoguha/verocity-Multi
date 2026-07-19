import { supabase, supabasePublic } from '@/lib/supabase';
import { getActivePlan, getAllLogs } from '@/lib/queries';
import { useAuthedQuery } from '@/lib/useAuthedQuery';
import { flattenSets } from '@/lib/stats';
import { e1rm } from '@/lib/e1rm';
import { formatRound } from '@/lib/format';
import { BLOCKS, type BlockKey } from '@/app.config';
import { EmptyState, LoadingScreen, SectionHeader } from '@/components/ui/primitives';
import { EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';
import { SubroutineBody } from '@/components/SubroutineBody';
import { isSubroutine } from '@/lib/subroutine';

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

  if (loading) return <LoadingScreen />;

  const plan = data?.plan ?? null;
  const logs = data?.logs ?? [];

  if (!plan) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <EchoText
          text="PLAN"
          as="h1"
          className="mb-6 font-display text-5xl font-bold uppercase leading-[0.9] tracking-[-0.04em] text-fg md:text-7xl"
        />
        <EmptyState>
          No active plan.
          {showcase ? null : (
            <>
              {' '}
              <a href="/app/plan/upload" className="text-fg underline hover:text-subtle">
                Create one
              </a>
              .
            </>
          )}
        </EmptyState>
      </div>
    );
  }

  const parsed = plan.parsed;
  const maxWeek = Math.max(
    1,
    ...parsed.blocks.map((b) => b.endWeek),
    ...parsed.days.flatMap((d) =>
      d.exercises.flatMap((e) => Object.keys(e.plannedByWeek).map(Number)),
    ),
  );
  const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);

  const blockForWeek = (w: number): BlockKey | null =>
    parsed.blocks.find((b) => w >= b.startWeek && w <= b.endWeek)?.type ?? null;

  // Best actual set per (movement, week) from this plan's done logs, plus the
  // most recent completed week — to overlay real performance onto the plan grid.
  const doneLogs = logs.filter(
    (l) => l.plan_id === plan.id && l.status === 'done' && l.week_number != null,
  );
  const lastCompletedWeek = doneLogs.reduce((m, l) => Math.max(m, l.week_number ?? 0), 0) || null;
  const actualBest = new Map<string, { e1rm: number; label: string }>();
  for (const log of doneLogs) {
    const wk = log.week_number as number;
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

  return (
    <PageStagger className="mx-auto max-w-5xl px-6 py-8">
      <Item>
        <header className="mb-6">
          <p className="t-eyebrow text-muted">Plan</p>
          <div className="mt-2 flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <EchoText
              text={parsed.title}
              as="h1"
              className="min-w-0 break-words font-display text-4xl font-bold uppercase leading-[0.9] tracking-[-0.04em] text-fg sm:text-5xl md:text-7xl"
            />
            {showcase ? null : (
              <div className="flex shrink-0 gap-4 pb-1">
                <a
                  href="/app/plan/edit"
                  className="t-control text-muted transition-colors hover:text-fg"
                >
                  Edit
                </a>
                <a
                  href="/app/plan/upload"
                  className="t-control text-muted transition-colors hover:text-fg"
                >
                  New plan
                </a>
              </div>
            )}
          </div>
          {parsed.blocks.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {parsed.blocks.map((b, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-2 t-control text-muted"
                >
                  <span
                    className="inline-block h-2 w-2"
                    style={{ backgroundColor: BLOCKS[b.type]?.color }}
                  />
                  {BLOCKS[b.type]?.label ?? b.type} · W{b.startWeek}–{b.endWeek}
                </span>
              ))}
            </div>
          ) : null}
        </header>
      </Item>

      {parsed.days.map((day) => (
        <Item key={day.dayKey}>
          <section className="mb-6">
            <div className="mb-3 flex items-center justify-between">
              <SectionHeader>{day.label}</SectionHeader>
              {showcase ? null : (
                <a
                  href={`/app/log?day=${encodeURIComponent(day.dayKey)}`}
                  className="t-control text-muted transition-colors hover:text-fg"
                >
                  Start →
                </a>
              )}
            </div>
            <div className="overflow-x-auto border border-border">
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
                  {day.exercises.map((ex, i) =>
                    isSubroutine(ex) ? (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="sticky left-0 z-10 bg-surface px-3 py-2 capitalize text-fg">
                          {ex.movement}
                        </td>
                        <td colSpan={weeks.length} className="border-l border-border px-3 py-2">
                          <SubroutineBody description={ex.description} url={ex.url} />
                        </td>
                      </tr>
                    ) : (
                      <tr key={i} className="border-b border-border last:border-0">
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
          </section>
        </Item>
      ))}
    </PageStagger>
  );
}
