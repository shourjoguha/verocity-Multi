import { useState } from 'react';
import { ACTIVITY_TAGS, TIMERS } from '@/app.config';
import { Button } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/Modal';
import { WheelPicker } from '@/components/ui/WheelPicker';

// Same range as HeartRate.tsx / ActivityLogger.tsx.
const MIN_BPM = 30;
const MAX_BPM = 230;

const HOURS = Array.from({ length: TIMERS.finishMaxHours + 1 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
// null first: "not logged" is where the wheel starts.
const BPM: (number | null)[] = [null, ...Array.from({ length: MAX_BPM - MIN_BPM + 1 }, (_, i) => MIN_BPM + i)];

export type FinishDetails = {
  tags: string[];
  // Undefined when the duration wheels were not touched — the stopwatch's
  // exact seconds stand rather than being rounded to the minute.
  seconds?: number;
  hrAvg: number | null;
  hrMax: number | null;
};

// Shown by the Logger's Finish when nothing about the session has been filled
// in yet. Every field is optional; Save with nothing chosen finishes as before.
export function FinishDetailsSheet({
  open,
  seconds,
  onClose,
  onSave,
}: {
  open: boolean;
  seconds: number;
  onClose: () => void;
  onSave: (details: FinishDetails) => Promise<void>;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Finish session">
      {/* A child, so its state is fresh each time the sheet opens. */}
      <FinishDetailsBody seconds={seconds} onSave={onSave} />
    </Modal>
  );
}

function FinishDetailsBody({ seconds, onSave }: { seconds: number; onSave: (d: FinishDetails) => Promise<void> }) {
  const [tags, setTags] = useState<string[]>([]);
  const [h, setH] = useState(() => Math.min(TIMERS.finishMaxHours, Math.floor(seconds / 3600)));
  const [m, setM] = useState(() => Math.floor((seconds % 3600) / 60));
  const [timeTouched, setTimeTouched] = useState(false);
  const [hr, setHr] = useState<number | null>(null);
  const [hrMax, setHrMax] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const toggle = (key: string) =>
    setTags((prev) => (prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]));

  return (
    <>
      <div className="flex flex-col gap-4 overflow-y-auto p-4">
        <div>
          <div className="mb-2 t-label text-muted">Session type · optional</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(ACTIVITY_TAGS).map(([key, v]) => {
              const on = tags.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggle(key)}
                  className={`hill-btn flex min-h-11 items-center border bg-surface px-3 t-control transition-colors ${
                    on ? '' : 'border-border text-muted hover:text-fg'
                  }`}
                  style={on ? { borderColor: v.color, color: v.color } : undefined}
                  aria-pressed={on}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* One row of four wheels, so the sheet's height does not grow. */}
        <div className="flex gap-3">
          <div className="min-w-0 flex-[2]">
            <div className="mb-2 t-label text-muted">Duration</div>
            <div className="flex items-center gap-1">
              <WheelPicker
                label="Hours"
                options={HOURS}
                value={h}
                onChange={(v) => {
                  setH(v);
                  setTimeTouched(true);
                }}
                format={(v) => `${v}h`}
              />
              <WheelPicker
                label="Minutes"
                options={MINUTES}
                value={m}
                onChange={(v) => {
                  setM(v);
                  setTimeTouched(true);
                }}
                format={(v) => `${String(v).padStart(2, '0')}m`}
              />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-2 t-label text-muted">Avg HR</div>
            <WheelPicker
              label="Average heart rate (BPM)"
              options={BPM}
              value={hr}
              onChange={setHr}
              format={(v) => (v == null ? '—' : String(v))}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-2 t-label text-muted">Max HR</div>
            <WheelPicker
              label="Max heart rate (BPM)"
              options={BPM}
              value={hrMax}
              onChange={setHrMax}
              format={(v) => (v == null ? '—' : String(v))}
            />
          </div>
        </div>
      </div>
      <div className="border-t border-border p-4">
        <Button
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            // Resolves only if the save failed — success navigates away.
            await onSave({ tags, seconds: timeTouched ? h * 3600 + m * 60 : undefined, hrAvg: hr, hrMax });
            setSaving(false);
          }}
          className="w-full"
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </>
  );
}
