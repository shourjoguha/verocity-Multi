import { useState } from 'react';
import { updateLog } from '@/lib/queries';
import type { WorkoutLog } from '@/lib/types';
import { formatDuration } from '@/lib/format';
import { toast } from '@/lib/toast';
import { Button, FIELD } from '@/components/ui/primitives';

// Tap-to-edit total session time. Displays the duration; tapping reveals
// hours/minutes inputs that persist to workout_logs.total_seconds. Shared by
// the session detail page and the calendar quick-view popup.
export function SessionTime({
  log,
  onUpdate,
  compact = false,
}: {
  log: WorkoutLog;
  onUpdate: (seconds: number) => void;
  // LogQuickView's meta line: no "edit" word, a dotted rule carries the
  // affordance instead, and the trigger keeps a 44px hit box.
  compact?: boolean;
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
    if (compact) {
      return (
        <button type="button" onClick={start} className="inline-flex min-h-11 items-center text-sm tabular-nums text-muted transition-colors hover:text-fg" title="Edit session time">
          <span className="border-b border-dotted border-faint">{formatDuration(log.total_seconds)}</span>
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={start}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
        title="Edit session time"
      >
        {formatDuration(log.total_seconds)}
        <span className="text-[0.6rem] uppercase tracking-wider">edit</span>
      </button>
    );
  }

  // FIELD is w-full; the wrapping spans give each field its width.
  const inputCls = `${FIELD} text-center tabular-nums`;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted">
      <span className="w-14">
        <input
          type="number"
          min={0}
          inputMode="numeric"
          value={h}
          onChange={(e) => setH(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          aria-label="Hours"
          className={inputCls}
        />
      </span>
      h
      <span className="w-14">
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
      </span>
      m
      <Button onClick={save} disabled={saving} className="ml-1">
        {saving ? 'Saving…' : 'Save'}
      </Button>
      <Button variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </span>
  );
}
