import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { createLog } from '@/lib/queries';
import { ACTIVITY_TAGS, ACTIVITY_TYPES, METRICS } from '@/app.config';
import type { LogDocument } from '@/lib/types';
import { Button, LoadingScreen } from '@/components/ui/primitives';
import { EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';

const today = () => new Date().toISOString().slice(0, 10);

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
  const [date, setDate] = useState(today());
  const [minutes, setMinutes] = useState('');
  const [distance, setDistance] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

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
    const created = await createLog({
      log_date: date,
      status: 'done',
      activity_type: type.trim(),
      total_seconds: durationSec || null,
      started_at: null,
      ended_at: new Date().toISOString(),
      tags,
      notes: notes.trim() || null,
      data: buildActivityDoc(type.trim(), durationSec, distanceM),
    });
    setSaving(false);
    if (!created) {
      setError('Could not save. Check your connection and try again.');
      return;
    }
    window.location.href = '/app';
  }

  return (
    <PageStagger className="mx-auto max-w-md px-6 py-10">
      <Item>
        <EchoText
          text="LOG ACTIVITY"
          as="h1"
          className="mb-8 font-display text-5xl font-bold uppercase leading-[0.9] tracking-[-0.04em] text-fg md:text-7xl"
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
            className={`min-h-9 border px-3 t-control transition-colors ${
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
            className="min-h-9 border px-3 t-control transition-colors"
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
