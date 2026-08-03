import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Tag } from '@/components/ui/primitives';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { ACTIVITY_TAGS, SECTIONS, type ActivityTagKey, type SectionKey } from '@/app.config';
import { tagColor } from '@/lib/tags';
import { formatSessionMeta } from '@/lib/sessionMeta';
import { availableLevels, selectVariant } from '@/lib/logBuilder';
import type { ScalingLevel, Session, SessionExercise, SessionGroup, SessionVariant } from '@/lib/types';

// Read-only preview of a saved session. Opens as a bottom drawer on mobile,
// centered card on desktop, via the shared Modal primitive (already handles
// scroll lock, focus trap, ESC, and the sheet-panel styling). Rendered by
// SessionsView with `session` set to the selected row (or null to close).
export function SessionSheet({
  session,
  onClose,
  onEdit,
}: {
  session: Session | null;
  onClose: () => void;
  onEdit?: (s: Session) => void;
}) {
  return (
    <Modal open={!!session} onClose={onClose} title={session?.name}>
      {session ? <SheetBody session={session} onClose={onClose} onEdit={onEdit} /> : null}
    </Modal>
  );
}

function SheetBody({
  session,
  onClose,
  onEdit,
}: {
  session: Session;
  onClose: () => void;
  onEdit?: (s: Session) => void;
}) {
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
        <button
          type="button"
          onClick={onClose}
          className="t-control text-muted transition-colors hover:text-fg"
        >
          Close
        </button>
        <div className="flex items-center gap-2">
          {!isShared && onEdit ? (
            <button
              type="button"
              onClick={() => onEdit(session)}
              className="hill-btn border border-border bg-surface px-3 py-2 t-control text-fg transition-colors hover:border-fg"
            >
              Edit
            </button>
          ) : null}
          <a
            href={`/app/log?session=${encodeURIComponent(session.id)}${
              levels.length > 0 ? `&level=${level}` : ''
            }`}
            className="hill-btn border border-fg bg-surface px-3 py-2 t-control text-fg"
          >
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
