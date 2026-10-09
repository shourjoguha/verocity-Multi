import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Tag } from '@/components/ui/primitives';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { PencilGlyph, PlayGlyph, TrashGlyph } from '@/components/ui/icons';
import { ACTIVITY_TAGS, SECTIONS, type ActivityTagKey, type SectionKey } from '@/app.config';
import { tagColor } from '@/lib/tags';
import { formatSessionMeta } from '@/lib/sessionMeta';
import { availableLevels, selectVariant } from '@/lib/logBuilder';
import type { ScalingLevel, Session, SessionExercise, SessionGroup, SessionVariant } from '@/lib/types';

// Read-only preview of a saved session. Opens as a bottom drawer on mobile,
// centered card on desktop, via the shared Modal primitive (already handles
// scroll lock, focus trap, ESC, and the sheet-panel styling). Rendered by
// SessionsView with `session` set to the selected row (or null to close).
//
// The sheet is where a session's actions live; the list row carries none. The
// row buttons were 12–24px tall, and Start/Edit duplicated this footer anyway.
// Footer: destructive on the left behind a confirm, Edit + Start on the right
// with Start outermost. Edit/Delete only exist for owned rows and only when
// the caller passes them (the showcase passes neither).
export function SessionSheet({
  session,
  onClose,
  onEdit,
  onDelete,
}: {
  session: Session | null;
  onClose: () => void;
  onEdit?: (s: Session) => void;
  onDelete?: (s: Session) => Promise<boolean>;
}) {
  return (
    <Modal open={!!session} onClose={onClose} title={session?.name}>
      {session ? (
        <SheetBody key={session.id} session={session} onEdit={onEdit} onDelete={onDelete} />
      ) : null}
    </Modal>
  );
}

// How long the armed trash waits for its second tap before disarming.
const CONFIRM_MS = 4000;

const ICON_BTN =
  'hill-btn flex h-11 w-11 shrink-0 items-center justify-center border border-border bg-surface transition-colors';
const GLYPH = 'h-[1.15rem] w-[1.15rem]';

function SheetBody({
  session,
  onEdit,
  onDelete,
}: {
  session: Session;
  onEdit?: (s: Session) => void;
  onDelete?: (s: Session) => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = window.setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => window.clearTimeout(t);
  }, [confirming]);
  const meta = formatSessionMeta(session);
  const isShared = session.owner_user_id === null;
  const levels = availableLevels(session.frame);
  const [level, setLevel] = useState<ScalingLevel>('rx');
  const variant = levels.length > 0 ? selectVariant(session.frame, level) : null;
  const blocks = normalizeGroups(session, variant);
  const instructions = variant?.instructions ?? session.instructions;

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {(meta || session.tags.length > 0 || isShared) && (
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            {meta ? <span className="t-control text-muted">{meta}</span> : null}
            {session.tags.map((t) => (
              <Tag
                key={t}
                label={ACTIVITY_TAGS[t as ActivityTagKey]?.label ?? t}
                color={tagColor(t)}
              />
            ))}
            {isShared ? <Tag label="Shared" color="hsl(210 9% 55%)" /> : null}
          </div>
        )}

        {instructions ? (
          <p className="mb-5 text-sm leading-relaxed text-muted">{instructions}</p>
        ) : null}

        {levels.length > 0 ? (
          <div className="mb-4">
            <SegmentedTabs
              tabs={levels.map((l) => ({
                key: l,
                label: session.frame.variants?.find((v) => v.level === l)?.label ?? levelLabel(l),
              }))}
              active={level}
              onChange={(k) => setLevel(k as ScalingLevel)}
              ariaLabel="Scaling level"
            />
          </div>
        ) : null}

        {blocks.length === 0 ? (
          <p className="text-sm text-muted">No movements.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {blocks.map((b, i) => (
              <BlockCard key={i} block={b} />
            ))}
          </div>
        )}

        {session.source_text ? (
          <details className="mt-5 border border-border">
            <summary className="cursor-pointer px-3 py-2 t-control text-muted hover:text-fg">
              Source{session.source ? ` · ${session.source}` : ''}
            </summary>
            <pre className="whitespace-pre-wrap px-3 py-2 text-xs text-muted">
              {session.source_text}
            </pre>
          </details>
        ) : null}
      </div>

      <div className="pb-safe flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3">
        <div className="flex items-center gap-2">
          {!isShared && onDelete ? (
            confirming ? (
              <>
                <span className="t-control text-muted">Delete?</span>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={async () => {
                    setDeleting(true);
                    const ok = await onDelete(session);
                    // On success the sheet closes and this body unmounts.
                    if (!ok) {
                      setDeleting(false);
                      setConfirming(false);
                    }
                  }}
                  className="hill-btn flex h-11 items-center border border-danger bg-surface px-3 t-control text-danger transition-colors disabled:opacity-40"
                  aria-label={`Confirm delete ${session.name}`}
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className={`${ICON_BTN} text-danger hover:border-danger`}
                aria-label="Delete session"
                title="Delete session"
              >
                <TrashGlyph className={GLYPH} />
              </button>
            )
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {!isShared && onEdit ? (
            <button
              type="button"
              onClick={() => onEdit(session)}
              className={`${ICON_BTN} text-fg hover:border-fg`}
              aria-label="Edit session"
              title="Edit session"
            >
              <PencilGlyph className={GLYPH} />
            </button>
          ) : null}
          <a
            href={`/app/log?session=${encodeURIComponent(session.id)}${
              levels.length > 0 ? `&level=${level}` : ''
            }`}
            className="hill-btn flex h-11 items-center gap-2 border border-fg bg-surface px-4 t-control text-fg"
          >
            <PlayGlyph className={GLYPH} />
            Start
          </a>
        </div>
      </div>
    </>
  );
}

type Block = {
  section: SectionKey;
  kind: 'single' | 'superset' | 'circuit';
  rounds?: number;
  restSeconds?: number;
  label?: string;
  items: SessionExercise[];
};

// Prefer the selected variant's groups when the session has scaling variants,
// then frame.groups, then fall back to the flat exercises[] list, bucketing by
// section into single-kind blocks so the renderer has one uniform shape.
function normalizeGroups(session: Session, variant: SessionVariant | null): Block[] {
  const groups = variant?.groups ?? session.frame.groups;
  if (groups && groups.length > 0) {
    return groups.map<Block>((g: SessionGroup) => ({
      section: g.section,
      kind: g.kind,
      rounds: g.rounds,
      restSeconds: g.restSeconds,
      label: g.label,
      items: g.items,
    }));
  }
  const bySection = new Map<SectionKey, SessionExercise[]>();
  for (const ex of session.frame.exercises ?? []) {
    bySection.set(ex.section, [...(bySection.get(ex.section) ?? []), ex]);
  }
  return SECTIONS.filter((k) => bySection.has(k)).map((section) => ({
    section,
    kind: 'single',
    items: bySection.get(section) ?? [],
  }));
}

function BlockCard({ block }: { block: Block }) {
  const meta: string[] = [];
  if (block.rounds && block.rounds > 1) meta.push(`${block.rounds} rounds`);
  if (block.kind !== 'single') meta.push(block.kind);
  if (block.restSeconds) meta.push(`${block.restSeconds}s rest`);

  return (
    <div className="border border-border">
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="t-eyebrow text-muted">
            {block.label ?? sectionLabel(block.section)}
          </div>
          {meta.length > 0 ? (
            <div className="mt-0.5 t-control text-muted">{meta.join(' · ')}</div>
          ) : null}
        </div>
      </div>
      <ul>
        {block.items.map((it, i) => (
          <li
            key={i}
            className="flex items-baseline gap-3 border-b border-border px-3 py-2 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-fg">{it.movement}</div>
              {it.notes ? (
                <div className="mt-0.5 text-xs text-muted">{it.notes}</div>
              ) : null}
            </div>
            {it.planned ? (
              <div className="shrink-0 tabular-nums text-sm text-muted">{it.planned}</div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function sectionLabel(k: SectionKey): string {
  return k.charAt(0).toUpperCase() + k.slice(1);
}

function levelLabel(l: ScalingLevel): string {
  return l.charAt(0).toUpperCase() + l.slice(1);
}
