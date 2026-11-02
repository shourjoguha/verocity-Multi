import type { CSSProperties } from 'react';
import type { WorkoutLog } from '@/lib/types';
import { formatDuration } from '@/lib/format';
import { sessionTagColors } from '@/lib/tags';
import { sessionSets, sessionsLabel, type DaySummary } from '@/lib/dayLog';

// The Log tab's session list, one card per DAY. Every card shows the day's
// working sets and time while collapsed. A day with one session is a plain row
// and does not open; only a day with several sessions is a native <details>
// whose rows are the separate sessions. This replaced the per-session stacked
// bars: their widths were share of SETS, so every bar ran full width and a
// 45-minute session looked as long as a 100-minute one.

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });

/** A vertical 3px stripe, split top-to-bottom when several tags share it. */
function stripeStyle(colors: string[]): CSSProperties {
  if (colors.length <= 1) return { background: colors[0] ?? 'transparent' };
  const step = 100 / colors.length;
  return {
    background: `linear-gradient(180deg, ${colors.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(', ')})`,
  };
}

function Cells({
  colors,
  date,
  label,
  count,
  sets,
  seconds,
}: {
  colors: string[];
  date: string | null;
  label: string;
  count?: number;
  sets: number;
  seconds: number;
}) {
  return (
    <>
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={stripeStyle(colors)} />
      <span className="w-8 shrink-0 leading-none tabular-nums">
        {date ? (
          <>
            <span className="block text-sm font-semibold text-fg">{Number(date.slice(8, 10))}</span>
            <span className="t-label mt-0.5 block text-[0.55rem] text-muted">
              {WEEKDAY.format(new Date(`${date}T00:00:00Z`))}
            </span>
          </>
        ) : null}
      </span>
      <span className="min-w-0 flex-1 truncate text-[0.8rem] text-fg">
        {label}
        {count ? <span className="ml-1.5 text-[0.7rem] text-muted">×{count}</span> : null}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted">{sets ? `${sets} sets` : ''}</span>
      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-subtle">
        {seconds ? formatDuration(seconds) : ''}
      </span>
    </>
  );
}

// pr-2 plus a w-4 last column on every row, so the chevron on a folded day
// does not push its sets and time out of line with the plain rows.
const ROW = 'relative flex min-h-11 w-full items-center gap-3 py-1 pl-3 pr-2 text-left';
const SPACER = <span aria-hidden className="-ml-1 w-4 shrink-0" />;

function SessionRow({
  log,
  date,
  onSelect,
}: {
  log: WorkoutLog;
  date: string | null;
  onSelect?: (log: WorkoutLog) => void;
}) {
  const cells = (
    <Cells
      colors={sessionTagColors(log.tags, log.activity_type)}
      date={date}
      label={sessionsLabel([log])}
      sets={sessionSets(log)}
      seconds={log.total_seconds ?? 0}
    />
  );
  const row = (
    <>
      {cells}
      {SPACER}
    </>
  );
  return onSelect ? (
    <button type="button" onClick={() => onSelect(log)} className={`${ROW} transition-colors hover:bg-elevated`}>
      {row}
    </button>
  ) : (
    <div className={ROW}>{row}</div>
  );
}

export function DayList({
  days,
  onSelect,
}: {
  days: DaySummary[];
  onSelect?: (log: WorkoutLog) => void;
}) {
  return (
    <ul className="lift border border-border bg-surface">
      {days.map((day) => (
        <li key={day.date} className="border-b border-border-soft last:border-b-0">
          {day.logs.length === 1 ? (
            <SessionRow log={day.logs[0]} date={day.date} onSelect={onSelect} />
          ) : (
            <details className="disclosure group">
              <summary
                className={`${ROW} cursor-pointer list-none outline-none transition-colors hover:bg-elevated focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-teal`}
              >
                <Cells
                  colors={day.colors}
                  date={day.date}
                  label={day.label}
                  count={day.logs.length}
                  sets={day.sets}
                  seconds={day.seconds}
                />
                <span
                  aria-hidden
                  className="-ml-1 inline-flex h-5 w-4 shrink-0 items-center justify-center text-muted transition-transform duration-200 group-open:rotate-90"
                >
                  ›
                </span>
              </summary>
              <div className="border-t border-border-soft bg-elevated/40">
                {day.logs.map((log) => (
                  <SessionRow key={log.id} log={log} date={null} onSelect={onSelect} />
                ))}
              </div>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
