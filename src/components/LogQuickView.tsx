import type { WorkoutLog } from '@/lib/types';
import { SECTIONS, type SectionKey } from '@/app.config';
import { formatDate, formatDuration, formatSetActual } from '@/lib/format';
import { tagColor } from '@/lib/tags';
import { Tag } from '@/components/ui/primitives';
import { SetShapeStrip } from '@/components/SetShapeStrip';
import { SubroutineBody } from '@/components/SubroutineBody';
import { isSubroutine } from '@/lib/subroutine';
import { SessionTime } from '@/components/SessionTime';
import { HeartRate } from '@/components/HeartRate';
import { DeleteLogButton } from '@/components/DeleteLogButton';
import { Modal } from '@/components/ui/Modal';
import { hrefFor } from '@/lib/surface';
import { LogShareControl } from '@/components/LogShareControl';

const sectionLabel = (k: SectionKey) => k.charAt(0).toUpperCase() + k.slice(1);

// A human label for a shared workout: "Day A · 24 Aug 2026", falling back to the
// activity, then bare date. Prefills the inline share control.
const shareLabel = (log: WorkoutLog) =>
  [log.day_key ? `Day ${log.day_key}` : log.activity_type, formatDate(log.log_date)]
    .filter(Boolean)
    .join(' · ');

// Tap-a-log quick popup: a session at a glance with Open / Resume actions,
// plus inline total-time editing and delete, instead of jumping straight to
// the full session page.
export function LogQuickView({
  log,
  open,
  onClose,
  onUpdated,
  onDeleted,
  onAddSession,
  readOnly = false,
}: {
  log: WorkoutLog | null;
  open: boolean;
  onClose: () => void;
  onUpdated?: (log: WorkoutLog) => void;
  onDeleted?: (id: string) => void;
  // Showcase: this is a READ surface, so it opens there in full. Only the
  // controls that mutate the row — inline time, heart rate, delete, resume —
  // drop out; "Open" stays because the session page is public too.
  readOnly?: boolean;
  // Calendar only: a day cell that already has a session opens this view
  // instead of the add menu, so adding a second session lives here.
  onAddSession?: (date: string) => void;
}) {
  const resumable = !!log && (log.status === 'in_progress' || log.status === 'paused');

  const orderedSections = (log?.data?.sections ?? [])
    .filter((s) => s.groups.some((g) => g.items.length > 0))
    .slice()
    .sort((a, b) => SECTIONS.indexOf(a.key) - SECTIONS.indexOf(b.key));

  return (
    <Modal open={open && !!log} onClose={onClose} title={log ? formatDate(log.log_date) : 'Session'}>
      {log ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {log.day_key ? <span className="text-sm text-fg">Day {log.day_key}</span> : null}
              {log.activity_type ? <span className="text-sm text-muted">{log.activity_type}</span> : null}
              {log.tags.map((t) => <Tag key={t} label={t} color={tagColor(t)} />)}
              {!log.day_key && !log.activity_type && log.tags.length === 0 ? (
                <span className="text-sm text-fg">Session</span>
              ) : null}
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="uppercase tracking-wider text-muted">{log.status}</span>
              {readOnly ? (
                <span className="tabular-nums text-muted">{formatDuration(log.total_seconds ?? 0)}</span>
              ) : (
                <SessionTime log={log} onUpdate={(s) => onUpdated?.({ ...log, total_seconds: s })} />
              )}
            </div>
            {!readOnly ? (
              <div className="mt-2 flex justify-end text-sm">
                <HeartRate log={log} onUpdate={(hr) => onUpdated?.({ ...log, ...hr })} />
              </div>
            ) : null}
            <div className="mt-4">
              <SetShapeStrip data={log.data} />
            </div>

            {orderedSections.length > 0 ? (
              <div className="mt-5 flex flex-col gap-4">
                {orderedSections.map((section) => (
                  <div key={section.key}>
                    <div className="t-label mb-1.5 text-muted">
                      {sectionLabel(section.key)}
                    </div>
                    <div className="flex flex-col gap-2">
                      {section.groups.flatMap((g) => g.items).map((item) =>
                        isSubroutine(item) ? (
                          <div key={item.id}>
                            <span className="capitalize text-fg">{item.movement}</span>
                            <SubroutineBody description={item.description} url={item.url} className="mt-0.5" />
                          </div>
                        ) : (
                          <div key={item.id} className="flex items-baseline justify-between gap-3">
                            <span className="shrink-0 capitalize text-fg">{item.movement}</span>
                            <span className="text-right text-xs tabular-nums text-muted">
                              {item.sets.map((s) => formatSetActual(s.actual)).join(', ')}
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {onAddSession && !readOnly ? (
              <button
                type="button"
                onClick={() => onAddSession(log.log_date)}
                className="mt-5 flex min-h-11 w-full items-center justify-center border border-dashed border-border t-control text-muted transition-colors hover:border-fg hover:text-fg"
              >
                + Add another session
              </button>
            ) : null}

            {!readOnly ? (
              <div className="mt-6 border-t border-border pt-4">
                <LogShareControl logId={log.id} defaultLabel={shareLabel(log)} />
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2 border-t border-border p-4">
            <span className="mr-auto">
              {!readOnly ? (
                <DeleteLogButton
                  id={log.id}
                  onDeleted={() => {
                    onDeleted?.(log.id);
                    onClose();
                  }}
                />
              ) : null}
            </span>
            <a
              href={`${hrefFor('/app/session')}?id=${log.id}`}
              className="hill-btn inline-flex min-h-12 items-center justify-center border border-border bg-surface px-4 text-sm uppercase tracking-wider text-fg transition-colors hover:border-fg"
            >
              Open
            </a>
            {resumable && !readOnly ? (
              <a
                href={`/app/log?logId=${log.id}`}
                className="hill-btn inline-flex min-h-12 items-center justify-center bg-fg px-4 text-sm uppercase tracking-wider text-bg transition-colors hover:bg-fg/85"
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
