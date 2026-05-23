import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getLogById } from '@/lib/queries';
import type { SetActual, WorkoutLog } from '@/lib/types';
import { tagColor } from '@/lib/tags';
import { formatDate, formatDuration } from '@/lib/format';
import { SECTIONS, type SectionKey } from '@/app.config';
import { EmptyState, SectionHeader, Tag } from '@/components/ui/primitives';

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
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <p className="text-[0.7rem] uppercase tracking-[0.3em] text-muted">
          {formatDate(log.log_date)} · {log.status}
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">
          {log.activity_type ?? 'Session'}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {log.tags.map((t) => (
            <Tag key={t} label={t} color={tagColor(t)} />
          ))}
          <span className="text-sm text-muted">{formatDuration(log.total_seconds)}</span>
        </div>
        {vibe ? (
          <div className="mt-3 flex gap-4 text-[0.7rem] uppercase tracking-wider text-muted">
            <span>Sleep {vibe.sleep}</span>
            <span>Energy {vibe.energy}</span>
            <span>Soreness {vibe.soreness}</span>
          </div>
        ) : null}
      </header>

      {orderedSections.length === 0 ? (
        <EmptyState>No logged sets.</EmptyState>
      ) : (
        orderedSections.map((section) => (
          <section key={section.key} className="mb-6">
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
        ))
      )}
    </div>
  );
}
