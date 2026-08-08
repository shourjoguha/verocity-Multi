import { useMemo, useState, type CSSProperties } from 'react';
import type { WorkoutLog } from '@/lib/types';
import { sessionTagColors } from '@/lib/tags';
import { formatDuration } from '@/lib/format';
import { SectionHeader } from '@/components/ui/primitives';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
import { LogList } from '@/components/LogList';

// Presentation-only month grid extracted from the retired CalendarView.
// Data (`logs`) is passed in, so a parent that already loaded logs (Home) does
// not pay for a second query. All day interactions fan out through
// `onDayClick`, so overlays live in the parent — no double mount.

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

function mondayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

export interface MonthCalendarProps {
  logs: WorkoutLog[];
  initialMonth?: Date;
  interactive?: boolean;
  headerVariant?: 'compact' | 'full';
  // Fired for any day cell tap. Receives the ISO date (YYYY-MM-DD) and the
  // logs on that day so the parent can decide whether to preview or add.
  onDayClick?: (date: string, sessions: WorkoutLog[]) => void;
  // Fired when the user taps a session inside the "This month" list below the
  // grid. Omitted → the list rows are non-interactive.
  onSelectLog?: (log: WorkoutLog) => void;
  className?: string;
}

export function MonthCalendar({
  logs,
  initialMonth,
  interactive = true,
  headerVariant = 'compact',
  onDayClick,
  onSelectLog,
  className = '',
}: MonthCalendarProps) {
  const [month, setMonth] = useState(() => {
    const d = initialMonth ?? new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  });

  // Filter the (usually complete) log set to the visible month once per change.
  // getAllLogs on Home can hold years of history, so scanning it per render
  // for the grid keys is measurably cheaper than a per-cell find.
  const visible = useMemo(() => {
    const yyyy = month.getUTCFullYear();
    const mm = month.getUTCMonth();
    return logs.filter((log) => {
      const d = log.log_date.slice(0, 10);
      const y = Number(d.slice(0, 4));
      const m = Number(d.slice(5, 7)) - 1;
      return y === yyyy && m === mm;
    });
  }, [logs, month]);

  const byDay = useMemo(() => {
    const map = new Map<string, WorkoutLog[]>();
    for (const log of visible) {
      const key = log.log_date.slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), log]);
    }
    return map;
  }, [visible]);

  const monthSessions = useMemo(
    () => [...visible].sort((a, b) => b.log_date.localeCompare(a.log_date)),
    [visible],
  );

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

  const navBtn =
    'hill-btn min-h-11 min-w-11 border border-border bg-surface px-3 text-fg transition-colors hover:border-fg';

  return (
    <div className={className}>
      {headerVariant === 'full' ? (
        <header className="mb-6">
          <p className="t-eyebrow text-muted">{monthLabel}</p>
          <div className="mt-2 flex items-end justify-between gap-4">
            <EchoText
              text="CALENDAR"
              as="h1"
              className={ECHO_APP_TITLE}
            />
            <div className="flex shrink-0 gap-2 pb-1">
              <button onClick={() => shift(-1)} className={navBtn} aria-label="Previous month">
                ←
              </button>
              <button onClick={() => shift(1)} className={navBtn} aria-label="Next month">
                →
              </button>
            </div>
          </div>
        </header>
      ) : (
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <SectionHeader>Calendar</SectionHeader>
            <span className="t-eyebrow -mt-1 text-muted">{monthLabel}</span>
          </div>
          <div className="flex shrink-0 gap-1">
            <button onClick={() => shift(-1)} className={navBtn} aria-label="Previous month">
              ←
            </button>
            <button onClick={() => shift(1)} className={navBtn} aria-label="Next month">
              →
            </button>
          </div>
        </div>
      )}

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
          const isToday = key === todayKey;
          const activate = () => {
            if (interactive && onDayClick) onDayClick(key, sessions);
          };
          const cellStyle: CSSProperties | undefined = undefined;
          return (
            <div
              key={key}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={
                interactive
                  ? sessions.length > 0
                    ? `${key} — view session`
                    : `${key} — add session`
                  : undefined
              }
              onClick={interactive ? activate : undefined}
              onKeyDown={
                interactive
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        activate();
                      }
                    }
                  : undefined
              }
              style={cellStyle}
              className={`aspect-square bg-surface p-1 ${
                isToday ? 'ring-1 ring-inset ring-teal' : ''
              } ${
                interactive
                  ? 'cursor-pointer transition-colors hover:bg-elevated focus:outline-none focus-visible:ring-1 focus-visible:ring-teal'
                  : ''
              }`}
            >
              <div
                className={`text-[0.65rem] tabular-nums ${
                  isToday ? 'font-semibold text-teal' : 'text-muted'
                }`}
              >
                {day}
              </div>
              <div className="mt-1 flex flex-col gap-[2px]">
                {sessions.map((s) => (
                  <span
                    key={s.id}
                    title={formatDuration(s.total_seconds)}
                    className="flex h-1.5 w-full"
                  >
                    {sessionTagColors(s.tags, s.activity_type).map((c, ci) => (
                      <span key={ci} className="h-full flex-1" style={{ backgroundColor: c }} />
                    ))}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {monthSessions.length > 0 ? (
        <section className="mt-6">
          <SectionHeader>This month</SectionHeader>
          <LogList logs={monthSessions} onSelect={onSelectLog} />
        </section>
      ) : null}
    </div>
  );
}
