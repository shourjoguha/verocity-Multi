import type { WorkoutLog } from '@/lib/types';
import { formatDate, formatDuration } from '@/lib/format';
import { tagColor } from '@/lib/tags';
import { SetShapeStrip } from '@/components/SetShapeStrip';
import { Tag } from '@/components/ui/primitives';

// The shared workout-row list — one source of truth for the session row used on
// Home and Calendar (and anywhere else). Duration sits UNDER the date so it
// never competes with the SetShapeStrip reps/sets bars or overflows narrow
// viewports. Pass `onSelect` for the interactive (app) variant; omit it for a
// read-only (showcase) list.
export function LogList({
  logs,
  onSelect,
}: {
  logs: WorkoutLog[];
  onSelect?: (log: WorkoutLog) => void;
}) {
  return (
    <ul className="lift border border-border bg-surface">
      {logs.map((log) => {
        const accent = log.tags[0] ? tagColor(log.tags[0]) : 'transparent';
        const inner = (
          <>
            <div className="w-16 shrink-0">
              <div className="text-sm tabular-nums text-subtle">{formatDate(log.log_date)}</div>
              {log.total_seconds ? (
                <div className="text-[0.7rem] tabular-nums text-muted">
                  {formatDuration(log.total_seconds)}
                </div>
              ) : null}
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
          </>
        );
        return (
          <li key={log.id} className="border-b border-border last:border-b-0">
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(log)}
                className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-elevated"
                style={{ boxShadow: `inset 3px 0 0 ${accent}` }}
              >
                {inner}
              </button>
            ) : (
              <div
                className="flex items-center gap-4 px-4 py-3"
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
