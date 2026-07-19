import { useEffect, useState } from 'react';
import { supabase, supabasePublic } from '@/lib/supabase';
import { getActivePlan, getLogsInRange } from '@/lib/queries';
import { getCached, setCached } from '@/lib/queryCache';
import { showcaseMonthStart } from '@/lib/showcase';
import type { Plan, WorkoutLog } from '@/lib/types';
import { sessionTagColors } from '@/lib/tags';
import { formatDuration } from '@/lib/format';
import { EmptyState, LoadingScreen, SectionHeader } from '@/components/ui/primitives';
import { EchoText } from '@/components/EchoText';
import { LogList } from '@/components/LogList';
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

export default function CalendarView({ mode = 'app' }: { mode?: 'app' | 'showcase' }) {
  const showcase = mode === 'showcase';
  const client = showcase ? supabasePublic : supabase;
  const [ready, setReady] = useState(false);
  const [month, setMonth] = useState(() => {
    const d = showcase ? showcaseMonthStart() : new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  });
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [addDate, setAddDate] = useState<string | null>(null);
  const [quickLog, setQuickLog] = useState<WorkoutLog | null>(null);

  useEffect(() => {
    if (showcase) {
      setReady(true);
      getActivePlan(client).then(setPlan);
      return;
    }
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
    const start = month;
    const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
    // SWR per month (app only): paint a previously-viewed month instantly while
    // revalidating in the background.
    const cacheKey = showcase
      ? null
      : `cal:logs:${month.getUTCFullYear()}-${month.getUTCMonth() + 1}`;
    const cached = cacheKey ? getCached<WorkoutLog[]>(cacheKey) : undefined;
    if (cached) {
      setLogs(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    getLogsInRange(ymd(start), ymd(end), client).then((l) => {
      if (!active) return;
      if (cacheKey) setCached(cacheKey, l);
      setLogs(l);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [ready, month]);

  if (!ready) return <LoadingScreen />;

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
  const nowLocal = new Date();
  const todayKey = ymd(
    new Date(Date.UTC(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate())),
  );

  const shift = (delta: number) =>
    setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + delta, 1)));

  return (
    <>
    <PageStagger className="mx-auto max-w-3xl px-6 py-8">
      <Item>
        <header className="mb-6">
          <p className="t-eyebrow text-muted">{monthLabel}</p>
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
            <div key={d} className="t-label text-center text-muted">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-px bg-border">
          {cells.map((day, i) => {
            if (day == null) return <div key={`b${i}`} className="aspect-square bg-bg" />;
            const key = ymd(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day)));
            const sessions = byDay.get(key) ?? [];
            const interactive = !showcase;
            const isToday = key === todayKey;
            return (
              <div
                key={key}
                role={interactive ? 'button' : undefined}
                tabIndex={interactive ? 0 : undefined}
                onClick={interactive ? () => setAddDate(key) : undefined}
                onKeyDown={
                  interactive
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setAddDate(key);
                        }
                      }
                    : undefined
                }
                className={`aspect-square bg-surface p-1 ${
                  isToday ? 'ring-1 ring-inset ring-teal' : ''
                } ${
                  interactive
                    ? 'cursor-pointer transition-colors hover:bg-elevated focus:outline-none focus-visible:ring-1 focus-visible:ring-teal'
                    : ''
                }`}
              >
                <div
                  className={`text-[0.65rem] tabular-nums ${isToday ? 'font-semibold text-teal' : 'text-muted'}`}
                >
                  {day}
                </div>
                <div className="mt-1 flex flex-col gap-[2px]">
                  {sessions.map((s) => {
                    const segments = sessionTagColors(s.tags, s.activity_type).map((c, ci) => (
                      <span key={ci} className="h-full flex-1" style={{ backgroundColor: c }} />
                    ));
                    return interactive ? (
                      <button
                        key={s.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setQuickLog(s);
                        }}
                        title={formatDuration(s.total_seconds)}
                        className="flex h-1.5 w-full"
                      >
                        {segments}
                      </button>
                    ) : (
                      <span
                        key={s.id}
                        title={formatDuration(s.total_seconds)}
                        className="flex h-1.5 w-full"
                      >
                        {segments}
                      </span>
                    );
                  })}
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
            <LogList logs={monthSessions} onSelect={showcase ? undefined : setQuickLog} />
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

      {showcase ? null : (
        <>
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
      )}
    </>
  );
}
