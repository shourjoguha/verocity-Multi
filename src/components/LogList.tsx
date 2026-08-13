import type { WorkoutLog } from '@/lib/types';
import { formatDate, formatDuration } from '@/lib/format';
import { tagColor } from '@/lib/tags';
import { SetShapeStrip } from '@/components/SetShapeStrip';
import { Tag } from '@/components/ui/primitives';

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
            <div className="w-14 shrink-0">
              <div className="text-[0.7rem] tabular-nums leading-tight text-subtle">{formatDate(log.log_date)}</div>
              {log.total_seconds ? (
                <div className="text-[0.6rem] tabular-nums leading-tight text-muted">
                  {formatDuration(log.total_seconds)}
                </div>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {log.tags.length > 0 ? (
                <>
                  <Tag label={log.tags[0]} color={tagColor(log.tags[0])} />
                  {log.tags.length > 1 ? (
                    <span className="shrink-0 text-[0.6rem] text-muted">
                      +{log.tags.length - 1}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="truncate text-[0.7rem] text-muted">
                  {log.day_key ?? log.activity_type ?? 'Session'}
                </span>
              )}
            </div>
            <SetShapeStrip data={log.data} className="shrink-0" />
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
