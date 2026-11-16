import { useState } from 'react';
import { updateLog } from '@/lib/queries';
import type { VibeCheck, WorkoutLog } from '@/lib/types';
import { localTimeOf, retimeLog } from '@/lib/logWhen';
import { toast } from '@/lib/toast';
import { FIELD } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/Modal';
import { VibeCheckCard } from '@/components/logger/VibeCheckCard';

// The session page's ONE edit for its details: when it started, how long it
// ran, heart rate and readiness. Each used to carry its own "edit" word and its
// own inline form (SessionWhen, SessionTime, HeartRate, the vibe card), so the
// header was four editors stacked. One sheet, one Save — the readiness card's
// own button is that Save, so the sheet has no second action row.
const MIN_BPM = 30;
const MAX_BPM = 230;
const clampBpm = (n: number) => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(n)));
const DEFAULT_VIBE: VibeCheck = { sleep: 3, energy: 3, soreness: 3 };

export function SessionDetailsSheet({
  log,
  open,
  onClose,
  onSaved,
}: {
  log: WorkoutLog;
  open: boolean;
  onClose: () => void;
  onSaved: (next: WorkoutLog, vibeChanged: boolean) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Session details">
      {/* Remounted per open so the fields re-seed from the saved row. */}
      {open ? <DetailsForm log={log} onClose={onClose} onSaved={onSaved} /> : null}
    </Modal>
  );
}

function DetailsForm({
  log,
  onClose,
  onSaved,
}: {
  log: WorkoutLog;
  onClose: () => void;
  onSaved: (next: WorkoutLog, vibeChanged: boolean) => void;
}) {
  const total = log.total_seconds ?? 0;
  const [date, setDate] = useState(log.log_date.slice(0, 10));
  const [time, setTime] = useState(localTimeOf(log.started_at));
  const [h, setH] = useState(Math.floor(total / 3600));
  const [m, setM] = useState(Math.floor((total % 3600) / 60));
  const [avg, setAvg] = useState(log.hr_avg != null ? String(log.hr_avg) : '');
  const [max, setMax] = useState(log.hr_max != null ? String(log.hr_max) : '');
  const [saving, setSaving] = useState(false);
  const initialVibe = log.data?.session?.vibe;
  const running = log.status === 'in_progress';

  async function save(vibe: VibeCheck) {
    if (!date) return;
    // A readiness the athlete never set and did not touch stays unset, rather
    // than being written as the card's 3/3/3 default.
    const vibeChanged = initialVibe
      ? JSON.stringify(initialVibe) !== JSON.stringify(vibe)
      : JSON.stringify(vibe) !== JSON.stringify(DEFAULT_VIBE);
    const seconds = Math.max(0, h) * 3600 + Math.max(0, m) * 60;
    const patch: Partial<WorkoutLog> = {
      ...(running ? {} : retimeLog({ ...log, total_seconds: seconds }, date, time)),
      ...(running ? {} : { total_seconds: seconds }),
      hr_avg: avg.trim() === '' ? null : clampBpm(Number(avg)),
      hr_max: max.trim() === '' ? null : clampBpm(Number(max)),
      ...(vibeChanged
        ? { data: { ...(log.data ?? { sections: [] }), session: { ...log.data?.session, vibe } } }
        : {}),
    };
    setSaving(true);
    const ok = await updateLog(log.id, patch);
    setSaving(false);
    if (!ok) {
      toast('Could not update session', 'error');
      return;
    }
    onSaved({ ...log, ...patch } as WorkoutLog, vibeChanged);
    toast('Session updated', 'success');
  }

  const num = `${FIELD} min-w-0 text-center tabular-nums`;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      {running ? null : (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="t-label text-muted">Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${FIELD} min-w-0`} />
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="t-label text-muted">Start</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`${FIELD} min-w-0 tabular-nums`} />
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="t-label text-muted">Hours</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={h}
              onChange={(e) => setH(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              className={num}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="t-label text-muted">Minutes</span>
            <input
              type="number"
              min={0}
              max={59}
              inputMode="numeric"
              value={m}
              onChange={(e) => setM(Math.min(59, Math.max(0, Math.floor(Number(e.target.value) || 0))))}
              className={num}
            />
          </label>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="t-label text-muted">Avg HR</span>
          <input type="number" inputMode="numeric" placeholder="—" value={avg} onChange={(e) => setAvg(e.target.value)} className={num} />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="t-label text-muted">Max HR</span>
          <input type="number" inputMode="numeric" placeholder="—" value={max} onChange={(e) => setMax(e.target.value)} className={num} />
        </label>
      </div>
      <VibeCheckCard
        initial={initialVibe}
        saveLabel="Save"
        skipLabel="Cancel"
        saving={saving}
        onSave={save}
        onSkip={onClose}
      />
    </div>
  );
}
