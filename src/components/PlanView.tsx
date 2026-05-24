import { getActivePlan } from '@/lib/queries';
import { useAuthedQuery } from '@/lib/useAuthedQuery';
import { BLOCKS, type BlockKey } from '@/app.config';
import { EmptyState, SectionHeader } from '@/components/ui/primitives';

export default function PlanView() {
  const { data: plan, loading } = useAuthedQuery(() => getActivePlan());

  if (loading) return <div className="px-6 py-16 text-sm text-muted">Loading…</div>;

  if (!plan) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="mb-6 font-display text-3xl font-semibold tracking-tight text-fg">Plan</h1>
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

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <div className="flex items-baseline justify-between">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">
            {parsed.title}
          </h1>
          <div className="flex gap-4">
            <a
              href="/app/plan/edit"
              className="text-[0.7rem] uppercase tracking-wider text-muted hover:text-fg"
            >
              Edit
            </a>
            <a
              href="/app/plan/upload"
              className="text-[0.7rem] uppercase tracking-wider text-muted hover:text-fg"
            >
              New plan
            </a>
          </div>
        </div>
        {parsed.blocks.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {parsed.blocks.map((b, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-2 text-[0.7rem] uppercase tracking-wider text-muted"
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

      {parsed.days.map((day) => (
        <section key={day.dayKey} className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <SectionHeader>{day.label}</SectionHeader>
            <a
              href={`/app/log?day=${encodeURIComponent(day.dayKey)}`}
              className="text-[0.7rem] uppercase tracking-wider text-muted hover:text-fg"
            >
              Start →
            </a>
          </div>
          <div className="overflow-x-auto border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[0.65rem] uppercase tracking-wider text-muted">
                  <th className="sticky left-0 z-10 border-b border-border bg-surface px-3 py-2 text-left font-medium">
                    Movement
                  </th>
                  {weeks.map((w) => (
                    <th
                      key={w}
                      className="border-b border-l border-border px-3 py-2 text-center font-medium"
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
                {day.exercises.map((ex, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="sticky left-0 z-10 bg-surface px-3 py-2 capitalize text-fg">
                      {ex.movement}
                    </td>
                    {weeks.map((w) => (
                      <td
                        key={w}
                        className="border-l border-border px-3 py-2 text-center tabular-nums text-subtle"
                      >
                        {ex.plannedByWeek[w] ?? '·'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
