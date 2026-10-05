// Home's way into /app/coach: the chosen character (Settings → Appearance)
// standing on the Active plan card's top hairline, with the live-finding count
// as a superscript. No box and no word — the card's own edge is the frame.
//
// It animates ONLY while a finding is unseen (lib/coachSignal.ts) — once you
// open Coach it holds its first pose, and the count stays until the findings
// stop being true. The count says everything the motion says, so reduced-motion
// users lose nothing.
import { useEffect, useState } from 'react';
import { CoachSprite } from '@/components/CoachSprite';
import {
  COACH_SPRITE_DEFAULTS,
  COACH_SPRITE_EVENT,
  getCoachSpritePrefs,
  type CoachSpritePrefs,
} from '@/lib/coachSpritePrefs';

export function CoachRunner({ live, unseen }: { live: number; unseen: number }) {
  const [prefs, setPrefs] = useState<CoachSpritePrefs>(COACH_SPRITE_DEFAULTS);
  useEffect(() => {
    setPrefs(getCoachSpritePrefs());
    const on = () => setPrefs(getCoachSpritePrefs());
    window.addEventListener(COACH_SPRITE_EVENT, on);
    return () => window.removeEventListener(COACH_SPRITE_EVENT, on);
  }, []);

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
      <CoachSprite sprite={prefs.sprite} size={prefs.size} speed={prefs.speed} animate={unseen > 0} className="-mb-px" />
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
