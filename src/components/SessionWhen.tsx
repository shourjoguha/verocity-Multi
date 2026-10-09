import { useState } from 'react';
import { updateLog } from '@/lib/queries';
import type { WorkoutLog } from '@/lib/types';
import { formatDate } from '@/lib/format';
import { localTimeOf, retimeLog } from '@/lib/logWhen';
import { toast } from '@/lib/toast';

// Tap-to-edit start date and time of a session — the backdating control.
// Mirrors SessionTime. A session still in progress shows its start read-only:
// `started_at` anchors the live stopwatch and auto-end (see lib/logWhen.ts).
export function SessionWhen({
  log,
  onUpdate,
}: {
  log: WorkoutLog;
  onUpdate: (patch: Partial<WorkoutLog>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [saving, setSaving] = useState(false);

  const shownTime = localTimeOf(log.started_at);
  const label = `${formatDate(log.log_date)}${shownTime ? ` · ${shownTime}` : ''}`;

  if (log.status === 'in_progress') {
    return <span className="text-sm tabular-nums text-muted">{label}</span>;
  }

  function start() {
    setDate(log.log_date.slice(0, 10));
    setTime(shownTime);
    setEditing(true);
  }

  async function save() {
    if (!date) return;
    const patch = retimeLog(log, date, time);
    setSaving(true);
    const ok = await updateLog(log.id, patch);
    setSaving(false);
    if (!ok) {
      toast('Could not update session start', 'error');
      return;
    }
    onUpdate(patch);
    setEditing(false);
    toast('Session start updated', 'success');
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={start}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm tabular-nums text-muted transition-colors hover:text-fg"
        title="Edit when this session started"
      >
        {label}
        <span className="text-[0.6rem] uppercase tracking-wider">edit</span>
      </button>
    );
  }

  const inputCls =
    'min-h-11 min-w-0 flex-1 rounded-control border border-border bg-surface px-2 text-sm tabular-nums text-fg outline-none focus:border-subtle';
  return (
    <span className="flex w-full flex-wrap items-center gap-2">
      {/* Native inputs, as in the meal "When" row — on iOS these are the OS
          wheels. Full width, with the buttons wrapped below: sharing a row
          with them clipped both values at 375px. */}
      <span className="flex w-full min-w-0 gap-2">
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          aria-label="Session start time"
          className={inputCls}
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Session date"
          className={inputCls}
        />
      </span>
      <span className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !date}
          className="hill-btn inline-flex min-h-11 items-center bg-fg px-3 t-control text-bg transition-colors hover:bg-fg/85 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="hill-btn inline-flex min-h-11 items-center border border-border bg-surface px-3 t-control text-fg transition-colors hover:border-fg"
        >
          Cancel
        </button>
      </span>
    </span>
  );
}
