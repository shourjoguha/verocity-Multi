import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getLogById, updateLog } from '@/lib/queries';
import type { SetActual, WorkoutLog } from '@/lib/types';
import { tagColor } from '@/lib/tags';
import { formatDate, formatDuration } from '@/lib/format';
import { toast } from '@/lib/toast';
import { SECTIONS, type SectionKey } from '@/app.config';
import { EmptyState, SectionHeader, Tag } from '@/components/ui/primitives';
import { EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';

function formatActual(a: SetActual): string {
  const parts: string[] = [];
  if (a.weight != null && a.reps != null) parts.push(`${a.weight} × ${a.reps}`);
  else if (a.reps != null) parts.push(`${a.reps} reps`);
  if (a.time != null) parts.push(`${a.time}s`);
  if (a.distance != null) parts.push(`${a.distance}m`);
  if (a.rpe != null) parts.push(`@${a.rpe}`);
  return parts.length ? parts.join(' ') : '—';
}

const sectionLabel = (k: SectionKey) => k.charAt(0).toUpperCase() + k.slice(1);

function SessionTime({ log, onUpdate }: { log: WorkoutLog; onUpdate: (seconds: number) => void }) {
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

export default function SessionDetail() {
  const [loading, setLoading] = useState(true);
  const [log, setLog] = useState<WorkoutLog | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        window.location.href = '/login';
        return;
      }
      const id = new URLSearchParams(window.location.search).get('id');
      if (!id) {
        setLoading(false);
        return;
      }
      setLog(await getLogById(id));
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="px-6 py-16 text-sm text-muted">Loading…</div>;

  if (!log) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <EmptyState>Session not found.</EmptyState>
      </div>
    );
  }

  const vibe = log.data?.session?.vibe;
  const orderedSections = (log.data?.sections ?? [])
    .slice()
    .sort((a, b) => SECTIONS.indexOf(a.key) - SECTIONS.indexOf(b.key));

  return (
    <PageStagger className="mx-auto max-w-3xl px-6 py-10">
      <Item>
        <header className="mb-8">
          <p className="text-[0.7rem] uppercase tracking-[0.3em] text-muted">
            {formatDate(log.log_date)} · {log.status}
          </p>
          <EchoText
            text={log.activity_type ?? 'Session'}
            as="h1"
            className="mt-2 font-display text-5xl font-bold uppercase leading-[0.9] tracking-[-0.04em] text-fg md:text-7xl"
          />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {log.tags.map((t) => (
              <Tag key={t} label={t} color={tagColor(t)} />
            ))}
            <SessionTime log={log} onUpdate={(s) => setLog({ ...log, total_seconds: s })} />
          </div>
          {vibe ? (
            <div className="mt-3 flex gap-4 text-[0.7rem] uppercase tracking-wider text-muted">
              <span>Sleep {vibe.sleep}</span>
              <span>Energy {vibe.energy}</span>
              <span>Soreness {vibe.soreness}</span>
            </div>
          ) : null}
        </header>
      </Item>

      {orderedSections.length === 0 ? (
        <Item>
          <EmptyState>No logged sets.</EmptyState>
        </Item>
      ) : (
        orderedSections.map((section) => (
          <Item key={section.key}>
            <section className="mb-6">
              <SectionHeader>{sectionLabel(section.key)}</SectionHeader>
              <div className="flex flex-col gap-3">
                {section.groups.map((group) => (
                  <div key={group.id} className="border border-border">
                    {group.kind !== 'single' ? (
                      <div className="border-b border-border px-3 py-1 text-[0.65rem] uppercase tracking-wider text-muted">
                        {group.kind}
                      </div>
                    ) : null}
                    {group.items.map((item) => (
                      <div key={item.id} className="px-3 py-2">
                        <div className="mb-1 capitalize text-fg">{item.movement}</div>
                        <ul className="flex flex-col gap-1">
                          {item.sets.map((set, i) => (
                            <li
                              key={i}
                              className="flex items-center justify-between text-sm tabular-nums"
                            >
                              <span className={set.actual.completed ? 'text-fg' : 'text-muted'}>
                                {formatActual(set.actual)}
                              </span>
                              <span className="text-[0.7rem] text-muted">
                                {set.notations.join(' ')}
                                {set.actual.completed ? ' ✓' : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          </Item>
        ))
      )}
    </PageStagger>
  );
}
