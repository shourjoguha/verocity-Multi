// Home's way into /app/coach: a folder tab growing out of the Active plan
// card's top hairline, carrying the live-finding count and a 16×16 pixel
// runner. The runner stands 2s and rolls 1s, on loop, ONLY while a finding is
// unseen (lib/coachSignal.ts) — once you open Coach it stands still, and the
// count stays until the findings stop being true.
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

export function CoachTab({ live, unseen }: { live: number; unseen: number }) {
  const label =
    live === 0 ? 'Coach' : `Coach, ${live} open finding${live === 1 ? '' : 's'}${unseen > 0 ? `, ${unseen} new` : ''}`;
  return (
    // The anchor is the 44px hit box (TOUCH.minTargetPx); the bordered span is
    // the 36px tab you see. Its extra 8px sits above the tab, over empty page.
    // -mb-px lays the tab's surface over the card's top hairline so the two
    // read as one outline.
    <a href="/app/coach" aria-label={label} className="group relative z-[1] -mb-px mr-3 inline-flex h-11 items-end">
      <span className="t-eyebrow flex h-9 items-center gap-2 rounded-t-card border border-b-0 border-border bg-surface pl-2 pr-2.5 text-fg transition-colors group-hover:bg-elevated">
        <svg
          viewBox="0 0 16 16"
          aria-hidden
          shapeRendering="crispEdges"
          className={`h-[22px] w-[22px] shrink-0 overflow-hidden ${live === 0 ? 'text-muted' : ''}`}
        >
          <path d={STRIP_PATH} fill="currentColor" className={unseen > 0 ? 'coach-run' : undefined} />
        </svg>
        Coach
        {live > 0 ? (
          <span className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-control bg-fg px-1 font-display text-[10px] leading-none tracking-normal text-bg tabular-nums">
            {live}
          </span>
        ) : null}
        <span aria-hidden className="text-muted">→</span>
      </span>
    </a>
  );
}
