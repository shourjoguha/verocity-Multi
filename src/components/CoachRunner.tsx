// Home's way into /app/coach: the chosen character (Settings → Appearance →
// Coach icon) standing on the Active plan card's top hairline, with the
// live-finding count as a superscript. No box and no word — the card's own
// edge is the frame. Motion follows the setting: always, only while a finding
// is unseen (lib/coachSignal.ts), or never. The count carries the message
// either way.
import { CoachSprite } from '@/components/CoachSprite';
import { useCoachSpritePrefs } from '@/lib/coachSpritePrefs';

export function CoachRunner({ live, unseen }: { live: number; unseen: number }) {
  const prefs = useCoachSpritePrefs();
  const animate = prefs.motion === 'always' || (prefs.motion === 'new' && unseen > 0);

  const label =
    live === 0 ? 'Coach' : `Coach, ${live} open finding${live === 1 ? '' : 's'}${unseen > 0 ? `, ${unseen} new` : ''}`;
  return (
    // Positioned by the caller's `relative` wrapper around the card: the anchor
    // sits on top of the card (bottom-full), right-aligned. It is the 44px hit
    // box (TOUCH.minTargetPx) and grows UPWARD only, so it never covers the
    // card's own View → link below it. No box, no word, no transform.
    <a
      href="/app/coach"
      aria-label={label}
      className={`absolute bottom-full right-2 flex h-11 min-w-11 items-end justify-center transition-colors hover:text-fg ${
        live === 0 ? 'text-muted' : 'text-fg'
      }`}
    >
      {/* -mb-px: every frame's bottom row is outline or empty, so this puts
          the feet on the hairline rather than a pixel above it. */}
      <CoachSprite
        sprite={prefs.sprite}
        grid={prefs.grid}
        ink={prefs.ink}
        size={prefs.size}
        speed={prefs.speed}
        animate={animate}
        className="-mb-px"
      />
      {/* A superscript, footnote-style: raised to the character's head. 9px is
          the floor the type scale allows (.t-nano); Archivo Black holds up there. */}
      {live > 0 ? (
        <span
          aria-hidden
          className="ml-px font-display text-[9px] leading-none text-fg tabular-nums"
          style={{ marginBottom: Math.round(prefs.size * 0.6) }}
        >
          {live}
        </span>
      ) : null}
    </a>
  );
}
