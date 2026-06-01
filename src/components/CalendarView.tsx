import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getActivePlan, getLogsInRange } from '@/lib/queries';
import type { Plan, WorkoutLog } from '@/lib/types';
import { tagColor } from '@/lib/tags';
import { formatDate, formatDuration } from '@/lib/format';
import { EmptyState, SectionHeader, Tag } from '@/components/ui/primitives';
import { EchoText } from '@/components/EchoText';
import { SetShapeStrip } from '@/components/SetShapeStrip';
import { Item, PageStagger } from '@/components/anim';
import { AddSessionMenu } from '@/components/AddSessionMenu';
import { LogQuickView } from '@/components/LogQuickView';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

// Monday-first weekday index (0 = Mon … 6 = Sun).
function mondayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

export default function CalendarView() {
  const [ready, setReady] = useState(false);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  });
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [addDate, setAddDate] = useState<string | null>(null);
  const [quickLog, setQuickLog] = useState<WorkoutLog | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        window.location.href = '/login';
        return;
      }
      setReady(true);
      getActivePlan().then(setPlan);
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    setLoading(true);
    const start = month;
    const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
    getLogsInRange(ymd(start), ymd(end)).then((l) => {
      if (!active) return;
      setLogs(l);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [ready, month]);

  if (!ready) return <div className="px-6 py-16 text-sm text-muted">Loading…</div>;

  const byDay = new Map<string, WorkoutLog[]>();
  for (const log of logs) {
    const key = log.log_date.slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), log]);
  }
  const monthSessions = [...logs].sort((a, b) => b.log_date.localeCompare(a.log_date));

  const daysInMonth = new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const leading = mondayIndex(month);
  const cells: (number | null)[] = [
    ...Array(leading).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const monthLabel = month.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const shift = (delta: number) =>
    setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + delta, 1)));

  return (
    <>
    <PageStagger className="mx-auto max-w-3xl px-6 py-10">
      <Item>
        <header className="mb-8">
          <p className="text-[0.7rem] uppercase tracking-[0.35em] text-muted">{monthLabel}</p>
          <div className="mt-2 flex items-end justify-between gap-4">
            <EchoText
              text="CALENDAR"
              as="h1"
              className="font-display text-5xl font-bold uppercase leading-[0.9] tracking-[-0.04em] text-fg md:text-7xl"
            />
            <div className="flex shrink-0 gap-2 pb-1">
              <button
                onClick={() => shift(-1)}
                className="hill-btn min-h-11 border border-border bg-surface px-3 text-fg transition-colors hover:border-fg"
                aria-label="Previous month"
              >
                ←
              </button>
              <button
                onClick={() => shift(1)}
                className="hill-btn min-h-11 border border-border bg-surface px-3 text-fg transition-colors hover:border-fg"
                aria-label="Next month"
              >
                →
              </button>
            </div>
          </div>
        </header>
      </Item>

      <Item>
        <div className="mb-2 grid grid-cols-7 gap-px">
          {WEEKDAYS.map((d) => (
            <div key={d} className="text-center text-[0.6rem] uppercase tracking-wider text-muted">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-px bg-border">
          {cells.map((day, i) => {
            if (day == null) return <div key={`b${i}`} className="aspect-square bg-bg" />;
            const key = ymd(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day)));
            const sessions = byDay.get(key) ?? [];
            return (
              <div
                key={key}
                role="button"
                tabIndex={0}
                onClick={() => setAddDate(key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setAddDate(key);
                  }
                }}
                className="aspect-square cursor-pointer bg-surface p-1 transition-colors hover:bg-elevated focus:outline-none focus-visible:ring-1 focus-visible:ring-fg"
              >
                <div className="text-[0.65rem] tabular-nums text-muted">{day}</div>
                <div className="mt-1 flex flex-col gap-[2px]">
                  {sessions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setQuickLog(s);
                      }}
                      title={formatDuration(s.total_seconds)}
                      className="h-1.5 w-full"
                      style={{ backgroundColor: tagColor(s.tags[0] ?? '') }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Item>

      {monthSessions.length > 0 ? (
        <Item>
          <section className="mt-8">
            <SectionHeader>This month</SectionHeader>
            <ul className="lift border border-border bg-surface">
              {monthSessions.map((log) => {
                const accent = log.tags[0] ? tagColor(log.tags[0]) : 'transparent';
                return (
                  <li key={log.id} className="border-b border-border last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setQuickLog(log)}
                      className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-elevated"
                      style={{ boxShadow: `inset 3px 0 0 ${accent}` }}
                    >
                      <div className="w-16 shrink-0 text-sm tabular-nums text-subtle">
                        {formatDate(log.log_date)}
                      </div>
                      <div className="flex flex-1 flex-wrap gap-1">
                        {log.tags.length > 0 ? (
                          log.tags.map((t) => <Tag key={t} label={t} color={tagColor(t)} />)
                        ) : (
                          <span className="text-sm text-muted">
                            {log.day_key ?? log.activity_type ?? 'Session'}
                          </span>
                        )}
                      </div>
                      <SetShapeStrip data={log.data} className="shrink-0" />
                      <div className="w-12 shrink-0 text-right text-sm tabular-nums text-muted">
                        {formatDuration(log.total_seconds)}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </Item>
      ) : null}

      {!loading && logs.length === 0 ? (
        <Item>
          <div className="mt-6">
            <EmptyState>No sessions this month.</EmptyState>
          </div>
        </Item>
      ) : null}
    </PageStagger>

      <AddSessionMenu
        plan={plan}
        date={addDate ?? undefined}
        open={addDate !== null}
        onClose={() => setAddDate(null)}
      />
      <LogQuickView
        log={quickLog}
        open={quickLog !== null}
        onClose={() => setQuickLog(null)}
        onUpdated={(updated) => {
          setLogs((ls) => ls.map((l) => (l.id === updated.id ? updated : l)));
          setQuickLog(updated);
        }}
        onDeleted={(id) => setLogs((ls) => ls.filter((l) => l.id !== id))}
      />
    </>
  );
}
