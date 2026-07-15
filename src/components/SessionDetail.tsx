import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { createSession, getLogById } from '@/lib/queries';
import { frameFromLogDocument } from '@/lib/logBuilder';
import { toast } from '@/lib/toast';
import type { WorkoutLog } from '@/lib/types';
import { tagColor } from '@/lib/tags';
import { formatDate, formatSetActual } from '@/lib/format';
import { SECTIONS, type SectionKey } from '@/app.config';
import { EmptyState, LoadingScreen, SectionHeader, Tag } from '@/components/ui/primitives';
import { EchoText } from '@/components/EchoText';
import { SessionTime } from '@/components/SessionTime';
import { HeartRate } from '@/components/HeartRate';
import { DeleteLogButton } from '@/components/DeleteLogButton';
import { Item, PageStagger } from '@/components/anim';

const sectionLabel = (k: SectionKey) => k.charAt(0).toUpperCase() + k.slice(1);

export default function SessionDetail() {
  const [loading, setLoading] = useState(true);
  const [log, setLog] = useState<WorkoutLog | null>(null);
  const [savingSession, setSavingSession] = useState(false);
  const [savedAsSession, setSavedAsSession] = useState(false);

  async function saveAsSession(current: WorkoutLog) {
    if (savingSession || savedAsSession) return;
    const frame = frameFromLogDocument(current.data ?? { sections: [] });
    if (frame.exercises.length === 0) {
      toast('Nothing to save — no logged movements', 'error');
      return;
    }
    setSavingSession(true);
    const created = await createSession({
      name: `${current.activity_type ?? 'Session'} · ${formatDate(current.log_date)}`,
      tags: current.tags,
      frame,
    });
    setSavingSession(false);
    if (created) setSavedAsSession(true);
    toast(created ? 'Saved to sessions' : 'Could not save session', created ? 'success' : 'error');
  }

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

  if (loading) return <LoadingScreen />;

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
          <div className="flex items-center justify-between gap-4">
            <p className="t-eyebrow text-muted">
              {formatDate(log.log_date)} · {log.status}
            </p>
            <div className="flex items-center gap-3">
              <a
                href={`/app/log?logId=${log.id}&edit=1`}
                className="t-control text-muted transition-colors hover:text-fg"
              >
                Edit
              </a>
              <button
                type="button"
                onClick={() => saveAsSession(log)}
                disabled={savingSession}
                className="t-control text-muted transition-colors hover:text-fg disabled:opacity-40"
              >
                Save as session
              </button>
              <DeleteLogButton id={log.id} onDeleted={() => (window.location.href = '/app/calendar')} />
            </div>
          </div>
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
            <HeartRate log={log} onUpdate={(hr) => setLog({ ...log, ...hr })} />
          </div>
          {vibe ? (
            <div className="mt-3 flex gap-4 t-control text-muted">
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
                      <div className="border-b border-border px-3 py-1 t-control text-muted">
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
                                {formatSetActual(set.actual)}
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
