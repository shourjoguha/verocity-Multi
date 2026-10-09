import { Modal } from '@/components/ui/Modal';
import { demoGifUrl, demoThumbUrl, getMovementDemo } from '@/lib/movementDemos';

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

// A video-camera glyph — reads as "there's a clip here" next to a movement name.
function VideoGlyph({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="2.5" y="6.5" width="12" height="11" rx="2" />
      <path d="M14.5 10.5l6-3v9l-6-3z" />
    </svg>
  );
}

/**
 * Inline video-icon button placed next to a movement name (the Logger header).
 * Renders nothing when the movement has no demo, so the icon only appears where
 * there's something to show. A 44px hit box holds a small glyph, pulled in with
 * a negative margin so it sits snug against the name without a vertical offset.
 */
export function DemoIconButton({
  name,
  onOpen,
  className = '',
}: {
  name: string;
  onOpen: () => void;
  className?: string;
}) {
  if (!getMovementDemo(name)) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`View ${name} demo`}
      className={`-mx-1.5 flex h-11 w-11 shrink-0 items-center justify-center text-muted transition-colors hover:text-fg ${className}`}
    >
      <VideoGlyph className="h-[1.15rem] w-[1.15rem]" />
    </button>
  );
}

// The animation itself, capped so the 180x180 asset never upscales into mush.
// `note` surfaces the "closest match" caveat for the ~29 movements mapped to a
// variation.
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
      {note ? <figcaption className="text-center t-label text-faint">{note}</figcaption> : null}
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

/**
 * A 28px decorative tile for a one-line Library row: the demo's still when one
 * exists, the initials monogram when not. Not a control — the whole row is the
 * target, and the demo plays in the movement sheet it opens.
 */
export function MovementTile({ name }: { name: string }) {
  const demo = getMovementDemo(name);
  return (
    <span
      aria-hidden="true"
      className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-chip border border-border bg-elevated"
    >
      {demo ? (
        <img
          src={demoThumbUrl(demo.asset)}
          alt=""
          loading="lazy"
          decoding="async"
          width={28}
          height={28}
          className="block h-full w-full object-cover"
        />
      ) : (
        <span className="font-display text-[0.6rem] text-faint">{initials(name)}</span>
      )}
    </span>
  );
}
