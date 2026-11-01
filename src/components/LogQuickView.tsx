import type { Plan, WorkoutLog } from '@/lib/types';
import { SECTIONS, type SectionKey } from '@/app.config';
import { formatDate, formatDuration } from '@/lib/format';
import { summarizeSets } from '@/lib/setSummary';
import { tagColor } from '@/lib/tags';
import { Tag } from '@/components/ui/primitives';
import { SubroutineBody } from '@/components/SubroutineBody';
import { isSubroutine } from '@/lib/subroutine';
import { SessionTime } from '@/components/SessionTime';
import { SessionWhen } from '@/components/SessionWhen';
import { HeartRate } from '@/components/HeartRate';
import { DeleteLogButton } from '@/components/DeleteLogButton';
import { Modal } from '@/components/ui/Modal';
import { hrefFor } from '@/lib/surface';
import { LogShareControl } from '@/components/LogShareControl';

const sectionLabel = (k: SectionKey) => k.charAt(0).toUpperCase() + k.slice(1);

// `day_key` is the plan's stable slug, not a name: printing it gave
// "Day day-d-pull-dip". The name is the plan day's label, read the same way as
// lib/review.ts. Logs from another plan than the one passed fall back to the
// key — "Day A" when it is a short letter key, else the slug in words.
function dayName(log: WorkoutLog, plan: Plan | null | undefined): string | null {
  if (!log.day_key) return null;
  const label =
    plan && plan.id === log.plan_id ? plan.parsed.days.find((d) => d.dayKey === log.day_key)?.label : undefined;
  if (label) return label;
  if (log.day_key.length <= 3) return `Day ${log.day_key}`;
  return log.day_key
    .replace(/^day[-_\s]*/i, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// A human label for a shared workout: "Day A · 24 Aug 2026", falling back to the
// activity, then bare date. Prefills the inline share control.
const shareLabel = (log: WorkoutLog, plan: Plan | null | undefined) =>
  [dayName(log, plan) ?? log.activity_type, formatDate(log.log_date)]
    .filter(Boolean)
    .join(' · ');

// "done" is the normal case and says nothing; anything else is worth a word.
const STATUS_LABEL: Record<string, string> = { in_progress: 'In progress', paused: 'Paused' };

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
  plan,
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
  // The caller's plan, for the day's name. Optional: without it (or for a log
  // from another plan) the name falls back to the day key.
  plan?: Plan | null;
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
            <div className="flex flex-wrap items-center gap-2">
              {dayName(log, plan) ? <span className="font-medium text-fg">{dayName(log, plan)}</span> : null}
              {log.activity_type ? <span className="text-sm text-muted">{log.activity_type}</span> : null}
              {log.tags.map((t) => <Tag key={t} label={t} color={tagColor(t)} />)}
              {!log.day_key && !log.activity_type && log.tags.length === 0 ? (
                <span className="font-medium text-fg">Session</span>
              ) : null}
            </div>
            {/* One meta line instead of four rows that alternated left and
                right. Each value is its own tap-to-edit control; the dotted
                rule replaces the "edit" words. The date is the sheet title. */}
            <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
              {STATUS_LABEL[log.status] ? (
                <>
                  <span className="t-label text-fg">{STATUS_LABEL[log.status]}</span>
                  <span aria-hidden className="text-faint">·</span>
                </>
              ) : null}
              {readOnly ? (
                <span className="flex min-h-11 items-center tabular-nums">{formatDuration(log.total_seconds ?? 0)}</span>
              ) : (
                <>
                  <SessionWhen compact log={log} onUpdate={(patch) => onUpdated?.({ ...log, ...patch })} />
                  <span aria-hidden className="text-faint">·</span>
                  <SessionTime compact log={log} onUpdate={(sec) => onUpdated?.({ ...log, total_seconds: sec })} />
                  <span aria-hidden className="text-faint">·</span>
                  <HeartRate compact log={log} onUpdate={(hr) => onUpdated?.({ ...log, ...hr })} />
                </>
              )}
            </div>
            {orderedSections.length > 0 ? (
              <div className="mt-3 flex flex-col gap-4">
                {orderedSections.map((section) => (
                  <div key={section.key}>
                    <div className="t-label mb-1.5 text-muted">
                      {sectionLabel(section.key)}
                    </div>
                    <div className="flex flex-col divide-y divide-border-soft">
                      {section.groups.flatMap((g) => g.items).map((item) => {
                        if (isSubroutine(item)) {
                          return (
                            <div key={item.id} className="py-1.5">
                              <span className="capitalize text-fg">{item.movement}</span>
                              <SubroutineBody description={item.description} url={item.url} className="mt-0.5" />
                            </div>
                          );
                        }
                        // Name and a count on one line, the sets factored by
                        // load beneath (lib/setSummary.ts) so nothing wraps
                        // mid-set. Per-set RPE lives on the session page.
                        const sum = summarizeSets(item.sets.map((x) => x.actual));
                        return (
                          <div key={item.id} className="py-1.5">
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="min-w-0 capitalize text-fg">{item.movement}</span>
                              <span className="shrink-0 text-xs tabular-nums text-fg">
                                {sum.count} set{sum.count === 1 ? '' : 's'}
                                {sum.rpe ? <span className="text-muted"> · {sum.rpe}</span> : null}
                              </span>
                            </div>
                            <div className="text-xs tabular-nums text-muted">{sum.line}</div>
                          </div>
                        );
                      })}
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
                <LogShareControl logId={log.id} defaultLabel={shareLabel(log, plan)} />
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
