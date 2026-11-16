import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { createSession, deleteLog, getLogById, getLogsInRange } from '@/lib/queries';
import { frameFromLogDocument } from '@/lib/logBuilder';
import { toast } from '@/lib/toast';
import type { WorkoutLog } from '@/lib/types';
import { tagColor } from '@/lib/tags';
import { formatDate, formatDuration, formatSetActual } from '@/lib/format';
import { SECTIONS, type SectionKey } from '@/app.config';
import {
  attributeSoreness,
  lagWindow,
  likelySources,
  soreLabel,
  type SorenessCandidate,
} from '@/lib/soreness';
import { Button, EmptyState, LoadingScreen, SectionHeader, Tag } from '@/components/ui/primitives';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
import { SessionDetailsSheet } from '@/components/SessionDetailsSheet';
import { Modal } from '@/components/ui/Modal';
import { PencilGlyph, ShareGlyph } from '@/components/ui/icons';
import { ArmedDelete } from '@/components/ui/SheetActions';
import { localTimeOf } from '@/lib/logWhen';
import { LogShareControl } from '@/components/LogShareControl';
import { SendToSheet } from '@/components/friends/SendToSheet';
import { InfoPopover } from '@/components/ui/InfoPopover';
import { Item, PageStagger } from '@/components/anim';
import { clientFor, hrefFor, isReadOnly, type Surface } from '@/lib/surface';
import { notationLabel } from '@/lib/notations';

const sectionLabel = (k: SectionKey) => k.charAt(0).toUpperCase() + k.slice(1);
// Header actions: a 44px hit box around a 32px visible chip.
const ACTION_HIT = 'group -mx-0.5 flex h-11 w-11 items-center justify-center';
const ACTION_CHIP =
  'flex h-8 w-8 items-center justify-center rounded-control bg-tappable text-fg transition-colors group-hover:bg-tappable-hover';

export default function SessionDetail({ mode = 'app' }: { mode?: Surface }) {
  // A session is a read surface, so the showcase opens it in full — only the
  // controls that mutate the row drop out.
  const readOnly = isReadOnly(mode);
  const [loading, setLoading] = useState(true);
  const [log, setLog] = useState<WorkoutLog | null>(null);
  const [savingSession, setSavingSession] = useState(false);
  const [savedAsSession, setSavedAsSession] = useState(false);
  const [soreFrom, setSoreFrom] = useState<SorenessCandidate[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  // The details sheet saved: refresh the "likely from" attribution only when
  // the sore areas could have changed.
  async function onDetailsSaved(next: WorkoutLog, vibeChanged: boolean) {
    setLog(next);
    setDetailsOpen(false);
    if (!vibeChanged) return;
    if (next.data?.session?.vibe?.sore?.length) {
      const { from, to } = lagWindow(next.log_date);
      const prior = await getLogsInRange(from, to, clientFor(mode));
      setSoreFrom(likelySources(attributeSoreness(next, prior)));
    } else {
      setSoreFrom([]);
    }
  }

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
      // The showcase has no session by design; the guard would bounce every
      // visitor to /login.
      if (!readOnly) {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          window.location.href = '/login';
          return;
        }
      }
      const id = new URLSearchParams(window.location.search).get('id');
      if (!id) {
        setLoading(false);
        return;
      }
      const found = await getLogById(id, clientFor(mode));
      setLog(found);
      setLoading(false);
      // Only worth a second read when the athlete said where it is sore.
      if (found?.data?.session?.vibe?.sore?.length) {
        const { from, to } = lagWindow(found.log_date);
        const prior = await getLogsInRange(from, to, clientFor(mode));
        setSoreFrom(likelySources(attributeSoreness(found, prior)));
      }
    })();
  }, []);

  if (loading) return <LoadingScreen />;

  if (!log) {
    return (
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8">
        <EmptyState>Session not found.</EmptyState>
      </div>
    );
  }

  const vibe = log.data?.session?.vibe;
  const orderedSections = (log.data?.sections ?? [])
    .slice()
    .sort((a, b) => SECTIONS.indexOf(a.key) - SECTIONS.indexOf(b.key));

  return (
    <PageStagger className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
      <Item>
        <header className="mb-8">
          {/* The title and its actions share one row. Icons in the order
              Edit · Share · Save as session · Delete; each is a 32px chip
              inside a 44px hit box (negative margins give the extra back),
              so the row stays slim beside the title. Every one writes, so
              the showcase gets the title alone. */}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <EchoText text={log.activity_type ?? 'Session'} as="h1" className={`min-w-0 ${ECHO_APP_TITLE}`} />
            {!readOnly ? (
              <div className="flex shrink-0 items-center">
                <a href={`/app/log?logId=${log.id}&edit=1`} className={ACTION_HIT} aria-label="Edit sets" title="Edit sets">
                  <span className={ACTION_CHIP}>
                    <PencilGlyph className="h-4 w-4" />
                  </span>
                </a>
                {log.status !== 'needs_review' ? (
                  // A needs_review row is a friend's numbers, not yours: never
                  // published by link nor passed on.
                  <button type="button" onClick={() => setShareOpen(true)} className={ACTION_HIT} aria-label="Share" title="Share">
                    <span className={ACTION_CHIP}>
                      <ShareGlyph className="h-4 w-4" />
                    </span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => saveAsSession(log)}
                  disabled={savingSession}
                  className="group flex h-11 items-center px-0.5 disabled:opacity-40"
                >
                  <span className="flex h-8 items-center rounded-control bg-tappable px-2 text-xs text-fg transition-colors group-hover:bg-tappable-hover">
                    Save as session
                  </span>
                </button>
                <ArmedDelete
                  compact
                  label="Delete session"
                  name="this session"
                  onConfirm={async () => {
                    const ok = await deleteLog(log.id);
                    if (!ok) {
                      toast('Could not delete session', 'error');
                      return false;
                    }
                    toast('Session deleted', 'success');
                    window.location.href = '/app';
                    return true;
                  }}
                />
              </div>
            ) : null}
          </div>
          {log.day_key || log.status !== 'done' ? (
            <p className="mt-1 text-xs text-muted">
              {[log.day_key ? `Day ${log.day_key}` : null, log.status === 'needs_review' ? 'Needs review' : log.status === 'done' ? null : log.status]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : null}
          {/* Every detail in one compact block with ONE edit: when, how long,
              heart rate, readiness and soreness. Each used to carry its own
              "edit" word and its own row. */}
          <div className="mt-4 flex items-start gap-2 rounded-card border border-outline bg-surface px-3 py-2.5">
            <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm tabular-nums text-muted">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {log.tags.map((t) => (
                  <Tag key={t} label={t} color={tagColor(t)} />
                ))}
                <span className="text-fg">
                  {formatDate(log.log_date)}
                  {localTimeOf(log.started_at) ? ` · ${localTimeOf(log.started_at)}` : ''}
                </span>
                <span>· {formatDuration(log.total_seconds ?? 0)}</span>
                {log.hr_avg != null || log.hr_max != null ? (
                  <span>
                    · <span aria-hidden="true">♥</span> {log.hr_avg ?? '—'}
                    {log.hr_max != null ? ` / ${log.hr_max}` : ''}
                  </span>
                ) : null}
              </div>
              {vibe ? (
                <div>
                  Sleep {vibe.sleep} · Energy {vibe.energy} · Soreness {vibe.soreness}
                </div>
              ) : null}
              {vibe?.sore?.length ? (
                <div className="text-xs">
                  Sore: {vibe.sore.map(soreLabel).join(', ')}
                  {soreFrom.length ? (
                    <>
                      {' · likely from '}
                      {soreFrom.map((c, i) => (
                        <span key={c.log.id}>
                          {i > 0 ? ' or ' : ''}
                          <a
                            href={`${hrefFor('/app/session', mode)}?id=${c.log.id}`}
                            className="text-fg underline decoration-border underline-offset-2 hover:decoration-fg"
                          >
                            {c.log.activity_type ?? (c.log.day_key ? `Day ${c.log.day_key}` : 'Session')}
                          </a>{' '}
                          ({c.daysBefore}d before)
                        </span>
                      ))}
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
            {!readOnly ? (
              <button
                type="button"
                onClick={() => setDetailsOpen(true)}
                className="-my-1.5 -mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center text-muted transition-colors hover:text-fg"
                aria-label="Edit session details"
                title="Edit session details"
              >
                <PencilGlyph className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          {!readOnly && log.status === 'needs_review' ? (
            <div className="mt-3">
              <a
                href={`/app/log?logId=${log.id}&edit=1`}
                className="flex min-h-11 items-center t-control text-fg underline underline-offset-2"
              >
                Review this workout
              </a>
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
                  <div key={group.id} className="lift rounded-card border border-outline bg-surface">
                    {group.kind !== 'single' ? (
                      <div className="border-b border-border-soft px-3 py-1 t-control text-muted">
                        {group.kind}
                      </div>
                    ) : null}
                    {group.items.map((item, itemIndex) => (
                      <div
                        key={item.id}
                        className={`px-3 py-2 ${itemIndex === 0 ? '' : 'border-t border-border-soft'}`}
                      >
                        {/* Notes are a paragraph of prescription per movement, and
                            printing them all made the session unreadable — the sets,
                            which are what you came for, sat below a wall of text. They
                            move behind the "!" and are one tap away. */}
                        <div className="mb-1 flex items-center gap-2">
                          <span className="min-w-0 flex-1 capitalize text-fg">{item.movement}</span>
                          {item.notes ? (
                            <InfoPopover label={`Notes for ${item.movement}`}>
                              <span className="whitespace-pre-wrap">{item.notes}</span>
                            </InfoPopover>
                          ) : null}
                        </div>
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
                                {set.notations.map(notationLabel).join(' ')}
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
      {!readOnly ? <SendToSheet open={sendOpen} onClose={() => setSendOpen(false)} logIds={[log.id]} /> : null}
      {!readOnly ? (
        <SessionDetailsSheet log={log} open={detailsOpen} onClose={() => setDetailsOpen(false)} onSaved={onDetailsSaved} />
      ) : null}
      {!readOnly && log.status !== 'needs_review' ? (
        // Share holds both ways out: a read-only link, and (for a finished
        // session) sending a copy to a friend.
        <Modal open={shareOpen} onClose={() => setShareOpen(false)} title="Share">
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <LogShareControl
              bare
              logId={log.id}
              defaultLabel={[log.day_key ? `Day ${log.day_key}` : log.activity_type, formatDate(log.log_date)]
                .filter(Boolean)
                .join(' · ')}
            />
            {log.status === 'done' ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setShareOpen(false);
                  setSendOpen(true);
                }}
              >
                Send to a friend
              </Button>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </PageStagger>
  );
}
