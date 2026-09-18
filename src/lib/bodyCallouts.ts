// Vertical slotting for the body-map callouts (BodyView).
//
// The callouts used to take their side from the region's rank in the top-4
// list, which is uncorrelated with where the region sits on the figure: two
// regions at the same height (chest and back are both 26%) could be ranked 0
// and 2 and so both land on the left edge, exactly on top of each other.
// Nothing then pushed them apart, because each `top` is a fixed percentage.
//
// So: order by height, alternate sides going DOWN the figure — which puts the
// two nearest neighbours on opposite edges by construction — then give each
// side its own non-overlapping slots.

export type CalloutSide = 'left' | 'right';

export type CalloutInput = {
  key: string;
  label: string;
  pct: number;
  /** Nominal position down the stage, in percent. */
  top: number;
};

export type PlacedCallout = CalloutInput & { side: CalloutSide };

// A callout is a label line, a value line and a rule: ~38px against a stage
// that is ~500px tall at the 200px max width, so ~8%. 11% leaves air.
const MIN_GAP = 11;
// Top edge stays clear of the card's padding; the bottom stops above the
// Front/Back control, which the side columns would otherwise reach into.
const MIN_TOP = 2;
const MAX_TOP = 80;

/** Push a column of nominal tops into non-overlapping slots, in order. */
function spread(tops: number[]): number[] {
  const out: number[] = [];
  for (const t of tops) {
    const floor = out.length > 0 ? out[out.length - 1] + MIN_GAP : MIN_TOP;
    out.push(Math.max(t, floor));
  }
  // The downward pass can run off the bottom; walk back up from the last slot.
  for (let i = out.length - 1; i >= 0; i--) {
    const ceiling = i === out.length - 1 ? MAX_TOP : out[i + 1] - MIN_GAP;
    out[i] = Math.min(out[i], ceiling);
  }
  return out.map((t) => Math.max(MIN_TOP, t));
}

export function layoutCallouts(rows: CalloutInput[]): PlacedCallout[] {
  // Stable within a tie so the same data always places the same way.
  const byHeight = rows.map((r, i) => ({ r, i })).sort((a, b) => a.r.top - b.r.top || a.i - b.i);

  const columns: Record<CalloutSide, { row: CalloutInput; order: number }[]> = {
    left: [],
    right: [],
  };
  byHeight.forEach(({ r }, i) => {
    columns[i % 2 === 0 ? 'left' : 'right'].push({ row: r, order: i });
  });

  const placed: PlacedCallout[] = [];
  for (const side of ['left', 'right'] as const) {
    const column = columns[side];
    const tops = spread(column.map((c) => c.row.top));
    column.forEach((c, i) => placed.push({ ...c.row, top: tops[i], side }));
  }
  return placed;
}
