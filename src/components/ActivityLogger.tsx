import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { createLog } from '@/lib/queries';
import { track } from '@/lib/analytics';
import { ACTIVITY_TAGS, ACTIVITY_TYPES, METRICS } from '@/app.config';
import type { LogDocument, VibeCheck } from '@/lib/types';
import { Button, LoadingScreen } from '@/components/ui/primitives';
import { Disclosure } from '@/components/ui/Disclosure';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';

const today = () => new Date().toISOString().slice(0, 10);

// Post-session heart rate, clamped to the same range as HeartRate.tsx.
const MIN_BPM = 30;
const MAX_BPM = 230;
const clampBpm = (n: number) => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(n)));

const VIBE_SCALE = [1, 2, 3, 4, 5];
const VIBE_FIELDS: { key: keyof VibeCheck; label: string }[] = [
  { key: 'sleep', label: 'Sleep' },
  { key: 'energy', label: 'Energy' },
  { key: 'soreness', label: 'Soreness' },
];
type PartialVibe = { [K in keyof VibeCheck]: number | null };

// Build a contract-faithful log: a single conditioning movement carrying the
// session's distance/time, so the activity shows up in stats like any session.
function buildActivityDoc(type: string, durationSec: number, distanceM: number): LogDocument {
  if (!durationSec && !distanceM) return { sections: [] };
  return {
    sections: [
      {
        key: 'conditioning',
        groups: [
          {
            id: crypto.randomUUID(),
            kind: 'single',
            items: [
              {
                id: crypto.randomUUID(),
                movement: type,
                primaryMetric: distanceM ? 'distance' : 'time',
                sets: [
                  {
                    planned: null,
                    notations: [],
                    actual: {
                      distance: distanceM || undefined,
                      time: durationSec || undefined,
                      completed: true,
                      prefilled: false,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

export default function ActivityLogger() {
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<string>(ACTIVITY_TYPES[0]);
  // AddSessionMenu forwards the calendar's chosen day as ?date=; without this
  // an activity logged onto a past day silently landed on today. Lazy initial
  // state — window is not available when this module is evaluated on the server.
  const [date, setDate] = useState(() => {
    if (typeof window === 'undefined') return today();
    return new URLSearchParams(window.location.search).get('date') ?? today();
  });
  const [minutes, setMinutes] = useState('');
  const [distance, setDistance] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  // Optional readiness + HR, mirroring what workouts capture (VibeCheck on
  // doc.session.vibe; hr_avg / hr_max columns). Each vibe field is nullable so
  // an untouched section attaches nothing.
  const [vibe, setVibe] = useState<PartialVibe>({ sleep: null, energy: null, soreness: null });
  const [hrAvg, setHrAvg] = useState('');
  const [hrMax, setHrMax] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        window.location.href = '/login';
        return;
      }
      setReady(true);
    })();
  }, []);

  if (!ready) return <LoadingScreen />;

  const toggleTag = (t: string) =>
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  async function save() {
    if (!type.trim()) {
      setError('Pick an activity type.');
      return;
    }
    setSaving(true);
    setError(null);
    const durationSec = Math.round((parseFloat(minutes) || 0) * 60);
    const distanceM = Math.round(parseFloat(distance) || 0);
    const doc = buildActivityDoc(type.trim(), durationSec, distanceM);
    // Attach the vibe check only if the user set at least one field; unset
    // fields fall back to the neutral 3 the workout logger also defaults to.
    if (vibe.sleep != null || vibe.energy != null || vibe.soreness != null) {
      doc.session = {
        vibe: { sleep: vibe.sleep ?? 3, energy: vibe.energy ?? 3, soreness: vibe.soreness ?? 3 },
      };
    }
    const hr_avg = hrAvg.trim() === '' ? null : clampBpm(Number(hrAvg));
    const hr_max = hrMax.trim() === '' ? null : clampBpm(Number(hrMax));
    const created = await createLog({
      log_date: date,
      status: 'done',
      activity_type: type.trim(),
      total_seconds: durationSec || null,
      started_at: null,
      ended_at: new Date().toISOString(),
      hr_avg,
      hr_max,
      tags,
      notes: notes.trim() || null,
      data: doc,
    });
    setSaving(false);
    if (!created) {
      setError('Could not save. Check your connection and try again.');
      return;
    }
    track('activity_logged', {
      activity_type: type.trim(),
      duration_seconds: durationSec,
      distance_meters: distanceM,
      tags,
    });
    window.location.href = '/app';
  }

  return (
    <PageStagger className="mx-auto max-w-md px-4 sm:px-6 py-10">
      <Item>
        <EchoText
          text="LOG ACTIVITY"
          as="h1"
          className={`mb-8 ${ECHO_APP_TITLE}`}
        />
      </Item>

      <Item>
      <label className="mb-2 block t-control text-muted">Type</label>
      <div className="mb-5 flex flex-wrap gap-2">
        {ACTIVITY_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`flex min-h-11 items-center border px-3 t-control transition-colors ${
              type === t ? 'border-fg text-fg' : 'border-border text-muted hover:text-fg'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4">
        <div>
          <label className="mb-2 block t-control text-muted">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="min-h-11 w-full border border-border bg-surface px-3 text-base text-fg outline-none focus:border-subtle"
          />
        </div>
        <div>
          <label className="mb-2 block t-control text-muted">Minutes</label>
          <input
            type="number"
            inputMode="decimal"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="30"
            className="min-h-11 w-full border border-border bg-surface px-3 text-base text-fg outline-none placeholder:text-muted focus:border-subtle"
          />
        </div>
      </div>

      <label className="mb-2 block t-control text-muted">
        Distance ({METRICS.distance.unit}, optional)
      </label>
      <input
        type="number"
        inputMode="decimal"
        value={distance}
        onChange={(e) => setDistance(e.target.value)}
        placeholder="5000"
        className="mb-5 min-h-11 w-full border border-border bg-surface px-3 text-base text-fg outline-none placeholder:text-muted focus:border-subtle"
      />

      <label className="mb-2 block t-control text-muted">Tags</label>
      <div className="mb-5 flex flex-wrap gap-2">
        {Object.entries(ACTIVITY_TAGS).map(([key, { label, color }]) => (
          <button
            key={key}
            type="button"
            onClick={() => toggleTag(key)}
            className="flex min-h-11 items-center border px-3 t-control transition-colors"
            style={
              tags.includes(key)
                ? { borderColor: color, color }
                : { borderColor: 'var(--color-border)', color: 'var(--color-muted)' }
            }
          >
            {label}
          </button>
        ))}
      </div>

      <label className="mb-2 block t-control text-muted">Notes</label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        className="mb-5 w-full border border-border bg-surface p-3 text-sm text-fg outline-none placeholder:text-muted focus:border-subtle"
      />

      <div className="mb-5">
        <Disclosure title="Readiness & heart rate" headerRight="optional">
          <div className="flex flex-col gap-3">
            {VIBE_FIELDS.map(({ key, label }) => (
              <div
                key={key}
                role="radiogroup"
                aria-label={label}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-sm text-subtle">{label}</span>
                <div className="flex gap-1">
                  {VIBE_SCALE.map((n) => (
                    // Glyph stays h-9 w-9 (36px); the -my-2 h-11 w-11 wrapper
                    // keeps the 44px tap target without growing the row.
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={vibe[key] === n}
                      aria-label={`${label} ${n}`}
                      onClick={() => setVibe((v) => ({ ...v, [key]: v[key] === n ? null : n }))}
                      className="-my-2 flex h-11 w-11 items-center justify-center"
                    >
                      <span
                        aria-hidden
                        className={`flex h-9 w-9 items-center justify-center border text-sm tabular-nums ${
                          vibe[key] === n
                            ? 'border-fg bg-fg text-bg'
                            : 'border-border text-muted hover:text-fg'
                        }`}
                      >
                        {n}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block t-control text-muted">Avg HR (bpm)</label>
              <input
                type="number"
                inputMode="numeric"
                value={hrAvg}
                onChange={(e) => setHrAvg(e.target.value)}
                placeholder="140"
                aria-label="Average heart rate (BPM)"
                className="min-h-11 w-full border border-border bg-surface px-3 text-base tabular-nums text-fg outline-none placeholder:text-muted focus:border-subtle"
              />
            </div>
            <div>
              <label className="mb-2 block t-control text-muted">Max HR (bpm)</label>
              <input
                type="number"
                inputMode="numeric"
                value={hrMax}
                onChange={(e) => setHrMax(e.target.value)}
                placeholder="175"
                aria-label="Max heart rate (BPM)"
                className="min-h-11 w-full border border-border bg-surface px-3 text-base tabular-nums text-fg outline-none placeholder:text-muted focus:border-subtle"
              />
            </div>
          </div>
        </Disclosure>
      </div>

      {error ? <p className="mb-3 text-sm text-accent">{error}</p> : null}

      <div className="flex gap-3">
        <Button onClick={save} disabled={saving} className="flex-1">
          {saving ? 'Saving…' : 'Save activity'}
        </Button>
        <Button variant="ghost" onClick={() => (window.location.href = '/app')}>
          Cancel
        </Button>
      </div>
      </Item>
    </PageStagger>
  );
}
