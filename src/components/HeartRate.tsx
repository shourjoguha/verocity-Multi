import { useState } from 'react';
import { updateLog } from '@/lib/queries';
import type { WorkoutLog } from '@/lib/types';
import { toast } from '@/lib/toast';

// Tap-to-edit average / max heart rate (BPM) for a session. Mirrors SessionTime:
// post-session metadata persisted to workout_logs.hr_avg / hr_max. Shared by the
// session detail page and the calendar quick-view popup.
const MIN_BPM = 30;
const MAX_BPM = 230;
const clampBpm = (n: number) => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(n)));

export function HeartRate({
  log,
  onUpdate,
}: {
  log: WorkoutLog;
  onUpdate: (patch: { hr_avg: number | null; hr_max: number | null }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [avg, setAvg] = useState('');
  const [max, setMax] = useState('');
  const [saving, setSaving] = useState(false);

  function start() {
    setAvg(log.hr_avg != null ? String(log.hr_avg) : '');
    setMax(log.hr_max != null ? String(log.hr_max) : '');
    setEditing(true);
  }

  async function save() {
    const patch = {
      hr_avg: avg.trim() === '' ? null : clampBpm(Number(avg)),
      hr_max: max.trim() === '' ? null : clampBpm(Number(max)),
    };
    setSaving(true);
    const ok = await updateLog(log.id, patch);
    setSaving(false);
    if (!ok) {
      toast('Could not update heart rate', 'error');
      return;
    }
    onUpdate(patch);
    setEditing(false);
    toast('Heart rate updated', 'success');
  }

  if (!editing) {
    const has = log.hr_avg != null || log.hr_max != null;
    return (
      <button
        type="button"
        onClick={start}
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
        title="Edit heart rate"
      >
        <span aria-hidden="true">♥</span>
        {has ? (
          <span className="tabular-nums">
            {log.hr_avg ?? '—'}
            <span className="text-[0.6rem] uppercase tracking-wider"> avg</span>
            {log.hr_max != null ? (
              <>
                {' · '}
                {log.hr_max}
                <span className="text-[0.6rem] uppercase tracking-wider"> max</span>
              </>
            ) : null}
          </span>
        ) : (
          <span className="text-[0.6rem] uppercase tracking-wider">add HR</span>
        )}
      </button>
    );
  }

  const inputCls =
    'w-14 border border-border bg-surface px-2 py-1 text-center text-sm tabular-nums text-fg focus:border-fg focus:outline-none';
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted">
      <span aria-hidden="true">♥</span>
      <input
        type="number"
        inputMode="numeric"
        value={avg}
        onChange={(e) => setAvg(e.target.value)}
        placeholder="avg"
        aria-label="Average heart rate (BPM)"
        className={inputCls}
      />
      <input
        type="number"
        inputMode="numeric"
        value={max}
        onChange={(e) => setMax(e.target.value)}
        placeholder="max"
        aria-label="Max heart rate (BPM)"
        className={inputCls}
      />
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="hill-btn ml-1 inline-flex min-h-8 items-center bg-fg px-2 t-control text-bg transition-colors hover:bg-fg/85 disabled:opacity-40"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="hill-btn inline-flex min-h-8 items-center border border-border bg-surface px-2 t-control text-fg transition-colors hover:border-fg"
      >
        Cancel
      </button>
    </span>
  );
}
