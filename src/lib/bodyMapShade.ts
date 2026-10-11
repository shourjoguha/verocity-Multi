// Body map shading: intensity (0..1, relative to the busiest muscle) is
// quantised into seven bands on a curved ramp, so the legend beside the figure
// is true for every style. Presentation, not domain — hence not app.config.ts.
//
// A linear ramp made 10% of the top muscle only 6.5 opacity points darker than
// untrained; the sqrt curve spends its contrast on the low end, where the
// distinction between "barely worked" and "not worked" lives.

// Lower edge inclusive, upper exclusive: 5 <= x < 10 is the third band.
export const BODY_SHADE_EDGES = [0.05, 0.1, 0.2, 0.4, 0.7] as const;
export const BODY_SHADE_BANDS = BODY_SHADE_EDGES.length + 2; // 7: untrained + 6 worked

// Legend tick labels, % of the top muscle, bottom (untrained) to top.
export const BODY_SHADE_LABELS = ['0', ...BODY_SHADE_EDGES.map((e) => String(Math.round(e * 100))), '100'];

// Midpoint of each worked band (band 1..6) as a fraction of the top muscle.
const BAND_MIDPOINTS = [0.025, 0.075, 0.15, 0.3, 0.55, 0.85] as const;

export type BodyMapInk = 'mono' | 'colour';

/** 0 = untrained, 1..6 = worked, heavier is higher. NaN and negatives are 0. */
export function shadeBand(intensity: number): number {
  if (!Number.isFinite(intensity) || intensity <= 0) return 0;
  let band = 1;
  for (const edge of BODY_SHADE_EDGES) {
    if (intensity >= edge) band += 1;
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
