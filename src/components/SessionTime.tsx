import { useState } from 'react';
import { updateLog } from '@/lib/queries';
import type { WorkoutLog } from '@/lib/types';
import { formatDuration } from '@/lib/format';
import { toast } from '@/lib/toast';

// Tap-to-edit total session time. Displays the duration; tapping reveals
// hours/minutes inputs that persist to workout_logs.total_seconds. Shared by
// the session detail page and the calendar quick-view popup.
export function SessionTime({
  log,
  onUpdate,
}: {
  log: WorkoutLog;
  onUpdate: (seconds: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [h, setH] = useState(0);
  const [m, setM] = useState(0);
  const [saving, setSaving] = useState(false);

  function start() {
    const total = log.total_seconds ?? 0;
    setH(Math.floor(total / 3600));
    setM(Math.floor((total % 3600) / 60));
    setEditing(true);
  }

  async function save() {
    const seconds = Math.max(0, h) * 3600 + Math.max(0, m) * 60;
    setSaving(true);
    const ok = await updateLog(log.id, { total_seconds: seconds });
    setSaving(false);
    if (!ok) {
      toast('Could not update session time', 'error');
      return;
    }
    onUpdate(seconds);
    setEditing(false);
    toast('Session time updated', 'success');
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={start}
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
        title="Edit session time"
      >
        {formatDuration(log.total_seconds)}
        <span className="text-[0.6rem] uppercase tracking-wider">edit</span>
      </button>
    );
  }

  const inputCls =
    'w-12 border border-border bg-surface px-2 py-1 text-center text-sm tabular-nums text-fg focus:border-fg focus:outline-none';
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted">
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={h}
        onChange={(e) => setH(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        aria-label="Hours"
        className={inputCls}
      />
      h
      <input
        type="number"
        min={0}
        max={59}
        inputMode="numeric"
        value={m}
        onChange={(e) => setM(Math.min(59, Math.max(0, Math.floor(Number(e.target.value) || 0))))}
        aria-label="Minutes"
        className={inputCls}
      />
      m
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="ml-1 inline-flex min-h-8 items-center bg-fg px-2 text-[0.7rem] uppercase tracking-wider text-bg transition-colors hover:bg-fg/85 disabled:opacity-40"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="inline-flex min-h-8 items-center border border-border px-2 text-[0.7rem] uppercase tracking-wider text-fg transition-colors hover:border-fg"
      >
        Cancel
      </button>
    </span>
  );
}
