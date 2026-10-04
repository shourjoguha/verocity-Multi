// Home's way into /app/coach: a 16×16 pixel runner standing on the Active plan
// card's top hairline, with the live-finding count as a superscript. No box and
// no word — the card's own edge is the frame. (It was a 150×36 labelled folder
// tab; that read as clunky next to a 10px section label.)
//
// The runner stands 2s and rolls 1s, on loop, ONLY while a finding is unseen
// (lib/coachSignal.ts) — once you open Coach it stands still, and the count
// stays until the findings stop being true.
//
// Motion is CSS: one SVG strip of unique frames, and the `coach-run` keyframes
// in global.css pick one per 100ms. currentColor throughout, so both themes
// come free. The count says everything the motion says, so reduced-motion
// users (where the animation is switched off by name) lose nothing.

const STAND = [
  '................',
  '......XXXX......',
  '.....XXXXXX.....',
  '.....XXX.XX.....',
  '.....XXXXXX.....',
  '......XXXX......',
  '.......XX.......',
  '.....XXXXXX.....',
  '....X.XXXX.X....',
  '....X.XXXX.X....',
  '......XXXX......',
  '......XX.XX.....',
  '......X...X.....',
  '......X...X.....',
  '.....XX...XX....',
  '................',
];
const BLINK = STAND.map((row, y) => (y === 3 ? '.....XXXXXX.....' : row));
const CROUCH = [
  '................',
  '................',
  '................',
  '................',
  '......XXXX......',
  '.....XXXXXX.....',
  '.....XXX.XX.....',
  '.....XXXXXX.....',
  '....XXXXXXXX....',
  '...X.XXXXXX.X...',
  '.....XXXXXX.....',
  '.....XX..XX.....',
  '....XX....XX....',
  '....XX....XX....',
  '................',
  '................',
];

// A filled disc with a wedge cut out at `phase` degrees, so successive frames
// read as spin; `dash` adds speed lines trailing on the left.
function ball(phase: number, dash: boolean): string[] {
  const rows: string[] = [];
  for (let y = 0; y < 16; y++) {
    let row = '';
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - 8.5;
      const dy = y + 0.5 - 9.5;
      const r = Math.hypot(dx, dy);
      let on = r <= 5.6;
      if (on && r > 2.2) {
        const a = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (Math.abs((((a - phase) % 360) + 540) % 360 - 180) < 22) on = false;
      }
      if (!on && dash && x < 3 && (y === 7 || y === 11) && (x + phase / 45) % 2 < 1.2) on = true;
      row += on ? 'X' : '.';
    }
    rows.push(row);
  }
  return rows;
}

// Order matters: global.css's `coach-run` addresses these by index
// (0 stand, 1 blink, 2 crouch, 3–10 roll).
const FRAMES = [
  STAND,
  BLINK,
  CROUCH,
  ball(0, false),
  ball(-60, true),
  ball(-120, true),
  ball(-180, true),
  ball(-240, true),
  ball(-300, true),
  ball(-360, true),
  ball(-420, false),
];

// One path for the whole strip — a rect per pixel would be ~550 nodes.
const STRIP_PATH = FRAMES.flatMap((rows, f) =>
  rows.flatMap((row, y) => [...row].map((c, x) => (c === 'X' ? `M${f * 16 + x} ${y}h1v1h-1z` : ''))),
).join('');

export function CoachRunner({ live, unseen }: { live: number; unseen: number }) {
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
      {/* -mb-px: the 16px frame's bottom row is empty, so this puts the feet
          on the hairline rather than a pixel above it. */}
      <svg viewBox="0 0 16 16" aria-hidden shapeRendering="crispEdges" className="-mb-px h-[18px] w-[18px] shrink-0 overflow-hidden">
        <path d={STRIP_PATH} fill="currentColor" className={unseen > 0 ? 'coach-run' : undefined} />
      </svg>
      {/* A superscript, footnote-style: raised to the runner's head. 9px is the
          floor the type scale allows (.t-nano); Archivo Black holds up there. */}
      {live > 0 ? (
        <span aria-hidden className="mb-[11px] ml-px font-display text-[9px] leading-none text-fg tabular-nums">
          {live}
        </span>
      ) : null}
    </a>
  );
}
