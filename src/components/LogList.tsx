import { useMemo } from 'react';
import type { WorkoutLog } from '@/lib/types';
import { formatDate, formatDuration } from '@/lib/format';
import { tagColor } from '@/lib/tags';
import { sessionShaper } from '@/lib/sessionShape';
import { SessionShapeBar } from '@/components/SessionShape';

// `history` is what each bar's height is compared against. Defaults to the
// rows themselves; pass the full log set where one is loaded so a five-row
// slice is not judged only against itself.
export function LogList({
  logs,
  history,
  onSelect,
}: {
  logs: WorkoutLog[];
  history?: WorkoutLog[];
  onSelect?: (log: WorkoutLog) => void;
}) {
  const shapeOf = useMemo(() => sessionShaper(history ?? logs), [history, logs]);
  return (
    <ul className="lift border border-border bg-surface">
      {logs.map((log) => {
        // The stripe is the only place the tag shows: the pill beside it said
        // the same thing and was the widest thing in the row.
        const accent = log.tags[0] ? tagColor(log.tags[0]) : 'transparent';
        const inner = (
          <>
            <div className="w-14 shrink-0">
              <div className="text-[0.7rem] tabular-nums leading-tight text-subtle">{formatDate(log.log_date)}</div>
              {log.total_seconds ? (
                <div className="text-[0.6rem] tabular-nums leading-tight text-muted">
                  {formatDuration(log.total_seconds)}
                </div>
              ) : null}
            </div>
            <SessionShapeBar shape={shapeOf(log)} />
          </>
        );
        return (
          <li key={log.id} className="border-b border-border-soft last:border-b-0">
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(log)}
                className="flex min-h-11 w-full items-center gap-3 px-3 py-1 text-left transition-colors hover:bg-elevated"
                style={{ boxShadow: `inset 3px 0 0 ${accent}` }}
              >
                {inner}
              </button>
            ) : (
              <div
                className="flex min-h-11 items-center gap-3 px-3 py-1"
                style={{ boxShadow: `inset 3px 0 0 ${accent}` }}
              >
                {inner}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
