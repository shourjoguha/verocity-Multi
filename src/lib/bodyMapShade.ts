// Body map shading: each muscle's SHARE of the period's total (0..1) is
// quantised into seven bands on a curved ramp, so the legend beside the figure
// is true for every style. Presentation, not domain — hence not app.config.ts.
//
// Share of TOTAL, not of the busiest muscle: one dominant muscle must not wash
// the others out, and map, legend, callouts and list all read the same unit.
// The edges are fixed and gently log-spaced (<1%, 1-2.5, 2.5-5, 5-8, 8-12, 12%+):
// with ~22 muscles an even split is ~4.5%, which lands mid-scale.
//
// The sqrt curve spends the ramp's contrast on the low end, where the
// distinction between "barely worked" and "not worked" lives.

// Lower edge inclusive, upper exclusive: 0.025 <= x < 0.05 is the third band.
export const BODY_SHADE_EDGES = [0.01, 0.025, 0.05, 0.08, 0.12] as const;
export const BODY_SHADE_BANDS = BODY_SHADE_EDGES.length + 2; // 7: untrained + 6 worked

// Legend tick labels, % of total, one per edge: 0 sits above the untrained cell
// and the last labels the start of the top cell ("12+").
export const BODY_SHADE_LABELS = [
  '0',
  ...BODY_SHADE_EDGES.map((e) => String(e * 100)),
].map((l, i, all) => (i === all.length - 1 ? `${l}+` : l));

// Midpoint of each worked band (band 1..6) as a fraction of the top muscle.
const BAND_MIDPOINTS = [0.025, 0.075, 0.15, 0.3, 0.55, 0.85] as const;

export type BodyMapInk = 'mono' | 'colour';

/** Input is a muscle's share of the total (0..1).
 * 0 = untrained, 1..6 = worked, heavier is higher. NaN and negatives are 0. */
export function shadeBand(share: number): number {
  if (!Number.isFinite(share) || share <= 0) return 0;
  let band = 1;
  for (const edge of BODY_SHADE_EDGES) {
    if (share >= edge) band += 1;
  }
  return band;
}

/** Position on the curve, 0..1. Untrained is its own shade, not on the curve. */
export function shadePosition(band: number): number {
  if (band <= 0) return 0;
  const mid = BAND_MIDPOINTS[Math.min(band, BODY_SHADE_BANDS - 1) - 1];
  return Math.sqrt(mid);
}

export const PLATE_UNTRAINED_OPACITY = 0.045;
// The tinted base drawn under every muscle (Plates), also under untrained ones.
export const PLATE_BASE_TINT = 0.025;
// Worked-band opacity is FLOOR + (CEIL - FLOOR) * position. Colour ink needs a
// taller range: mango is lighter than the greyscale ink on white, so the same
// steps buy less luminance contrast. Tuned against the contrast test.
const PLATE_RAMP: Record<BodyMapInk, { floor: number; ceil: number }> = {
  mono: { floor: 0.18, ceil: 0.9 },
  colour: { floor: 0.2, ceil: 1 },
};

export function plateOpacity(band: number, ink: BodyMapInk = 'mono'): number {
  if (band <= 0) return PLATE_UNTRAINED_OPACITY;
  const { floor, ceil } = PLATE_RAMP[ink];
  return floor + (ceil - floor) * shadePosition(band);
}
