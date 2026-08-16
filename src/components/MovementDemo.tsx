import { Modal } from '@/components/ui/Modal';
import {
  DEMO_ATTRIBUTION,
  demoGifUrl,
  demoThumbUrl,
  getMovementDemo,
} from '@/lib/movementDemos';

// Two-letter monogram for the placeholder, skipping connective words so
// "Toes-to-Bar" reads "TB" rather than "TT".
const STOP = new Set(['to', 'and', 'the', 'a', 'of', 'on', 'with', 'over']);
function initials(name: string): string {
  const words = name
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w && !STOP.has(w.toLowerCase()));
  const take = words.length ? words : name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return take
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';
}

// A small play-triangle in a rounded frame — the "there's a demo here" cue.
function PlayGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

/** The inline play/video affordance used in the Logger's movement header. */
export function DemoTrigger({
  onClick,
  expanded,
  className = '',
}: {
  onClick: () => void;
  expanded: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className={`-my-2 flex min-h-11 items-center gap-1.5 t-control text-muted transition-colors hover:text-fg ${className}`}
    >
      <PlayGlyph className="h-3.5 w-3.5" />
      {expanded ? 'Hide demo' : 'View demo'}
    </button>
  );
}

// The animation itself, capped so the 180x180 asset never upscales into mush,
// plus the attribution the Gym Visual license requires. `note` surfaces the
// "closest match" caveat for the ~29 movements mapped to a variation.
function DemoMedia({ asset, note }: { asset: string; note?: string }) {
  return (
    <figure className="mx-auto flex max-w-[220px] flex-col gap-2">
      <div className="overflow-hidden rounded-card border border-border bg-surface">
        <img
          src={demoGifUrl(asset)}
          alt=""
          loading="lazy"
          decoding="async"
          width={220}
          height={220}
          className="block aspect-square w-full object-contain"
        />
      </div>
      <figcaption className="flex items-center justify-between gap-2 t-label text-faint">
        <span>{DEMO_ATTRIBUTION}</span>
        {note ? <span>{note}</span> : null}
      </figcaption>
    </figure>
  );
}

// Monochrome initials tile for movements with no usable GIF, sized like the
// media so a mixed list doesn't jump.
function DemoPlaceholder({ name, label }: { name: string; label?: string }) {
  return (
    <figure className="mx-auto flex max-w-[220px] flex-col gap-2">
      <div className="grid aspect-square w-full place-items-center rounded-card border border-border bg-elevated">
        <span className="font-display text-2xl text-muted">{initials(name)}</span>
      </div>
      {label ? <figcaption className="text-center t-label text-faint">{label}</figcaption> : null}
    </figure>
  );
}

/**
 * The demo media for a movement: the animation + attribution when one is
 * mapped, otherwise an initials placeholder. Used inline in the Logger and
 * inside the Library sheet.
 */
export function MovementDemo({ name }: { name: string }) {
  const demo = getMovementDemo(name);
  if (!demo) return <DemoPlaceholder name={name} label="No demo yet" />;
  return <DemoMedia asset={demo.asset} note={demo.exact ? undefined : 'closest match'} />;
}

/**
 * A small square trigger for a Library row. Renders the still thumbnail when a
 * demo exists (with a play badge) and calls `onOpen`; renders a static initials
 * placeholder, non-interactive, when it does not.
 */
export function MovementDemoThumb({
  name,
  onOpen,
}: {
  name: string;
  onOpen: () => void;
}) {
  const demo = getMovementDemo(name);
  if (!demo) {
    return (
      <div
        aria-hidden="true"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-chip border border-border bg-elevated"
      >
        <span className="font-display text-xs text-faint">{initials(name)}</span>
      </div>
    );
  }
  // 44px hit box (TOUCH.minTargetPx) around a 40px tile, pulled back by -2px so
  // the visual footprint stays 40px and the row doesn't shift — the "bigger hit
  // box, not a bigger glyph" rule from CLAUDE.md.
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`View ${name} demo`}
      className="-m-0.5 grid h-11 w-11 shrink-0 place-items-center"
    >
      <span className="relative block h-10 w-10 overflow-hidden rounded-chip border border-border bg-surface">
        <img
          src={demoThumbUrl(demo.asset)}
          alt=""
          loading="lazy"
          decoding="async"
          width={40}
          height={40}
          className="block h-full w-full object-cover"
        />
        <span className="absolute bottom-0.5 right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full border border-surface bg-accent text-accent-fg">
          <PlayGlyph className="h-2 w-2" />
        </span>
      </span>
    </button>
  );
}

/** The Library's demo sheet — GIF only, on the shared Modal primitive. */
export function MovementDemoSheet({
  name,
  open,
  onClose,
}: {
  name: string | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={name ?? undefined} ariaLabel={name ? `${name} demo` : 'Demo'}>
      <div className="px-4 py-5">{name ? <MovementDemo name={name} /> : null}</div>
    </Modal>
  );
}
