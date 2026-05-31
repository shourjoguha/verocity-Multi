import type { WorkoutLog } from '@/lib/types';
import { formatDate } from '@/lib/format';
import { tagColor } from '@/lib/tags';
import { Tag } from '@/components/ui/primitives';
import { SetShapeStrip } from '@/components/SetShapeStrip';
import { SessionTime } from '@/components/SessionTime';
import { DeleteLogButton } from '@/components/DeleteLogButton';
import { Modal } from '@/components/ui/Modal';

// Tap-a-log quick popup: a session at a glance with Open / Resume actions,
// plus inline total-time editing and delete, instead of jumping straight to
// the full session page.
export function LogQuickView({
  log,
  open,
  onClose,
  onUpdated,
  onDeleted,
}: {
  log: WorkoutLog | null;
  open: boolean;
  onClose: () => void;
  onUpdated?: (log: WorkoutLog) => void;
  onDeleted?: (id: string) => void;
}) {
  const resumable = !!log && (log.status === 'in_progress' || log.status === 'paused');

  return (
    <Modal open={open && !!log} onClose={onClose} title={log ? formatDate(log.log_date) : 'Session'}>
      {log ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mb-3 flex flex-wrap items-center gap-1">
              {log.tags.length > 0 ? (
                log.tags.map((t) => <Tag key={t} label={t} color={tagColor(t)} />)
              ) : (
                <span className="text-sm text-fg">{log.day_key ?? log.activity_type ?? 'Session'}</span>
              )}
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="uppercase tracking-wider text-muted">{log.status}</span>
              <SessionTime log={log} onUpdate={(s) => onUpdated?.({ ...log, total_seconds: s })} />
            </div>
            <div className="mt-4">
              <SetShapeStrip data={log.data} />
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-border p-4">
            <span className="mr-auto">
              <DeleteLogButton
                id={log.id}
                onDeleted={() => {
                  onDeleted?.(log.id);
                  onClose();
                }}
              />
            </span>
            <a
              href={`/app/session?id=${log.id}`}
              className="inline-flex min-h-12 items-center justify-center border border-border px-4 text-sm uppercase tracking-wider text-fg transition-colors hover:border-fg"
            >
              Open
            </a>
            {resumable ? (
              <a
                href={`/app/log?logId=${log.id}`}
                className="inline-flex min-h-12 items-center justify-center bg-fg px-4 text-sm uppercase tracking-wider text-bg transition-colors hover:bg-fg/85"
              >
                Resume
              </a>
            ) : null}
          </div>
        </>
      ) : null}
    </Modal>
  );
}
