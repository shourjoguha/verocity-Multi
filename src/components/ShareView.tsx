import { useEffect, useState } from 'react';
import { fetchShare, type ShareResult } from '@/lib/share';
import type { ParsedPlan, Plan, Profile, WorkoutLog } from '@/lib/types';
import { BLOCKS, type BlockKey } from '@/app.config';
import { formatDate, formatDuration } from '@/lib/format';
import { tagColor } from '@/lib/tags';
import { EmptyState, LoadingScreen, SectionHeader, StatCard, Tag } from '@/components/ui/primitives';
import { EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';

const echoTitle =
  'font-display text-5xl font-bold uppercase leading-[0.9] tracking-[-0.04em] text-fg md:text-7xl';

const ERRORS: Record<string, string> = {
  missing_token: 'This link is missing its token.',
  invalid_token: 'This link is invalid or has been revoked.',
  expired_token: 'This link has expired.',
  network_error: 'Could not reach the server. Check your connection and try again.',
};

function errorMessage(code: string): string {
  return ERRORS[code] ?? 'This link could not be opened.';
}

function planWeeks(parsed: ParsedPlan): number {
  return Math.max(
    1,
    ...parsed.blocks.map((b) => b.endWeek),
    ...parsed.days.flatMap((d) => d.exercises.flatMap((e) => Object.keys(e.plannedByWeek).map(Number))),
  );
}

function PlanReadView({ parsed }: { parsed: ParsedPlan }) {
  const weeks = Array.from({ length: planWeeks(parsed) }, (_, i) => i + 1);
  const blockForWeek = (w: number): BlockKey | null =>
    parsed.blocks.find((b) => w >= b.startWeek && w <= b.endWeek)?.type ?? null;

  return (
    <PageStagger>
      <Item>
        <header className="mb-2">
          <p className="text-[0.7rem] uppercase tracking-[0.35em] text-muted">Plan</p>
          <EchoText text={parsed.title} as="h1" className={`mt-2 ${echoTitle}`} />
          {parsed.blocks.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {parsed.blocks.map((b, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-2 text-[0.7rem] uppercase tracking-wider text-muted"
                >
                  <span className="inline-block h-2 w-2" style={{ backgroundColor: BLOCKS[b.type]?.color }} />
                  {BLOCKS[b.type]?.label ?? b.type} · W{b.startWeek}–{b.endWeek}
                </span>
              ))}
            </div>
          ) : null}
        </header>
      </Item>

      {parsed.days.map((day) => (
        <Item key={day.dayKey}>
          <section className="mt-8">
          <SectionHeader>{day.label}</SectionHeader>
          <div className="overflow-x-auto border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[0.65rem] uppercase tracking-wider text-muted">
                  <th className="sticky left-0 z-10 border-b border-border bg-surface px-3 py-2 text-left font-medium">
                    Movement
                  </th>
                  {weeks.map((w) => (
                    <th key={w} className="border-b border-l border-border px-3 py-2 text-center font-medium">
                      <span
                        className="mx-auto mb-1 block h-1 w-4"
                        style={{
                          backgroundColor: blockForWeek(w) ? BLOCKS[blockForWeek(w)!].color : 'transparent',
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
                    <td className="sticky left-0 z-10 bg-surface px-3 py-2 capitalize text-fg">{ex.movement}</td>
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
        </Item>
      ))}
    </PageStagger>
  );
}

function LogReadView({ log }: { log: WorkoutLog }) {
  const sections = log.data?.sections ?? [];
  return (
    <PageStagger>
      <Item>
        <header className="mb-2">
          <p className="text-[0.7rem] uppercase tracking-[0.3em] text-muted">{formatDate(log.log_date)}</p>
          <EchoText text={log.activity_type ?? 'Session'} as="h1" className={`mt-2 ${echoTitle}`} />
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{formatDuration(log.total_seconds)}</span>
            {log.tags.map((t) => (
              <Tag key={t} label={t} color={tagColor(t)} />
            ))}
          </div>
        </header>
      </Item>

      {sections.length === 0 ? (
        <Item>
          <EmptyState>No sets recorded.</EmptyState>
        </Item>
      ) : (
        sections.map((section) => (
          <Item key={section.key}>
            <section className="mt-6">
            <SectionHeader>{section.key}</SectionHeader>
            <ul className="divide-y divide-border border border-border">
              {section.groups.flatMap((g) =>
                g.items.map((item) => (
                  <li key={item.id} className="px-4 py-3">
                    <div className="capitalize text-fg">{item.movement}</div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-subtle">
                      {item.sets.map((s, i) => (
                        <span key={i} className={s.actual.completed ? '' : 'text-muted line-through'}>
                          {[s.actual.weight && `${s.actual.weight}kg`, s.actual.reps && `${s.actual.reps}`, s.actual.rpe && `@${s.actual.rpe}`, s.actual.distance && `${s.actual.distance}m`, s.actual.time && `${s.actual.time}s`]
                            .filter(Boolean)
                            .join(' × ') || (s.planned ?? '—')}
                        </span>
                      ))}
                    </div>
                  </li>
                )),
              )}
            </ul>
            </section>
          </Item>
        ))
      )}
    </PageStagger>
  );
}

function ProfileReadView({
  profile,
  plans,
  logs,
}: {
  profile: Profile | null;
  plans: Plan[];
  logs: WorkoutLog[];
}) {
  const totalSeconds = logs.reduce((acc, l) => acc + (l.total_seconds ?? 0), 0);
  const activePlan = plans.find((p) => p.is_active) ?? plans[0] ?? null;

  return (
    <PageStagger>
      <Item>
        <header className="mb-2">
          <p className="text-[0.7rem] uppercase tracking-[0.3em] text-muted">Shared profile</p>
          <EchoText text={profile?.display_name ?? 'Athlete'} as="h1" className={`mt-2 ${echoTitle}`} />
        </header>
      </Item>

      <Item>
        <section className="mt-6 grid grid-cols-2 gap-px bg-border">
          <StatCard label="Sessions" value={logs.length} />
          <StatCard label="Total time" value={formatDuration(totalSeconds)} />
        </section>
      </Item>

      {activePlan ? (
        <Item>
          <section className="mt-8">
            <SectionHeader>Active plan</SectionHeader>
            <div className="border border-border bg-surface p-4 font-display text-xl text-fg">
              {activePlan.name}
            </div>
          </section>
        </Item>
      ) : null}

      <Item>
        <section className="mt-8">
          <SectionHeader>Recent sessions</SectionHeader>
          {logs.length === 0 ? (
            <EmptyState>No sessions logged yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-border border border-border">
              {logs.slice(0, 20).map((log) => (
                <li key={log.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="w-16 shrink-0 text-sm tabular-nums text-subtle">
                    {formatDate(log.log_date)}
                  </div>
                  <div className="flex flex-1 flex-wrap gap-1">
                    {log.tags.length > 0 ? (
                      log.tags.map((t) => <Tag key={t} label={t} color={tagColor(t)} />)
                    ) : (
                      <span className="text-sm text-muted">{log.activity_type ?? 'Session'}</span>
                    )}
                  </div>
                  <div className="w-12 shrink-0 text-right text-sm tabular-nums text-muted">
                    {formatDuration(log.total_seconds)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Item>
    </PageStagger>
  );
}

function render(result: ShareResult) {
  if (result.scope === 'plan') {
    return result.plan ? <PlanReadView parsed={result.plan.parsed} /> : <EmptyState>Plan not found.</EmptyState>;
  }
  if (result.scope === 'log') {
    return result.log ? <LogReadView log={result.log} /> : <EmptyState>Workout not found.</EmptyState>;
  }
  return <ProfileReadView profile={result.profile} plans={result.plans} logs={result.logs} />;
}

export default function ShareView() {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; result: ShareResult }
  >({ kind: 'loading' });

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setState({ kind: 'error', message: errorMessage('missing_token') });
      return;
    }
    (async () => {
      const { data, error } = await fetchShare(token);
      if (data) setState({ kind: 'ok', result: data });
      else setState({ kind: 'error', message: errorMessage(error ?? '') });
    })();
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      {state.kind === 'loading' ? (
        <LoadingScreen />
      ) : state.kind === 'error' ? (
        <EmptyState>{state.message}</EmptyState>
      ) : (
        render(state.result)
      )}
    </div>
  );
}
