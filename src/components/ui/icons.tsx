// Inline glyphs for icon-only controls.
//
// Same contract as `VideoGlyph` in MovementDemo.tsx, which these were factored
// alongside: a 24x24 viewBox, `stroke="currentColor"` so the glyph inherits the
// button's text colour (and therefore every theme override for free), and
// `aria-hidden` because the BUTTON carries the accessible name. An icon-only
// control without an `aria-label` on its button is a control with no name —
// these components cannot supply one for you.
//
// No icon library: adding one for eleven glyphs would ship a dependency to
// state what 60 lines of path data already say, and every icon set has its own
// stroke weight and optical sizing to reconcile with `--color-*` and the 2px
// hairline identity.

type GlyphProps = { className?: string };

// Shared frame. strokeWidth 2 at 24px matches VideoGlyph, which is what these
// sit beside in the Logger's movement header.
function Glyph({ className = '', children }: GlyphProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

/* ---- metric glyphs, one per MetricKey in app.config.ts ---- */

export function WeightGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <path d="M6.5 6.5v11M3 9.5v5M17.5 6.5v11M21 9.5v5M6.5 12h11" />
    </Glyph>
  );
}

export function RepsGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <path d="M10 3.5L8 20.5M16.5 3.5l-2 17M4 9h16M3.5 15h16" />
    </Glyph>
  );
}

export function TimeGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 13.5V9.75M9.5 2.5h5" />
    </Glyph>
  );
}

export function DistanceGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <path d="M3 12h18M6.5 8.5L3 12l3.5 3.5M17.5 8.5L21 12l-3.5 3.5" />
    </Glyph>
  );
}

export function CalGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <path d="M12 2.7c.6 3 2.2 4 3.6 5.6A6.4 6.4 0 0 1 17.4 13a5.4 5.4 0 0 1-10.8 0c0-1.6.6-3 1.7-4.2.2 1 .8 1.7 1.6 1.7 1.1 0 1.8-.9 1.6-2.2-.2-1.4-.3-3.4.5-5.6z" />
    </Glyph>
  );
}

export function RpeGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <path d="M4 17.5a8.5 8.5 0 0 1 16 0" />
      <path d="M12 17.5l3.5-4.5" />
    </Glyph>
  );
}

/* ---- action glyphs ---- */

export function VoiceGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <rect x="9.25" y="2.5" width="5.5" height="11" rx="2.75" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5" />
    </Glyph>
  );
}

export function PlusGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <path d="M12 5v14M5 12h14" />
    </Glyph>
  );
}

// Chain link — "superset this movement with the next one".
export function LinkGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <path d="M9.5 14.5l5-5" />
      <path d="M13.25 6.75L14.75 5.25a3.9 3.9 0 0 1 5.5 5.5L18.75 12.25" />
      <path d="M10.75 17.25L9.25 18.75a3.9 3.9 0 0 1-5.5-5.5L5.25 11.75" />
    </Glyph>
  );
}

export function TrashGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <path d="M4 6.5h16M9.5 6.5v-2h5v2M6.75 6.5l.9 13.5h8.7l.9-13.5M10.25 10.5v6M13.75 10.5v6" />
    </Glyph>
  );
}

// Three dots. Filled rather than stroked — at 1.15rem a stroked 1px circle
// reads as a ring, not a dot.
export function MoreGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  );
}
