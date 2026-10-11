import { describe, expect, it } from 'vitest';
import {
  BODY_SHADE_BANDS,
  BODY_SHADE_LABELS,
  PLATE_BASE_TINT,
  plateOpacity,
  shadeBand,
  shadePosition,
  type BodyMapInk,
} from '@/lib/bodyMapShade';

describe('shadeBand', () => {
  it.each([
    [0, 0],
    [0.0001, 1],
    [0.0499, 1],
    [0.05, 2],
    [0.0999, 2],
    [0.1, 3],
    [0.1999, 3],
    [0.2, 4],
    [0.4, 5],
    [0.6999, 5],
    [0.7, 6],
    [1, 6],
    [7, 6],
    [-1, 0],
    [NaN, 0],
  ])('%s -> band %s', (i, band) => {
    expect(shadeBand(i)).toBe(band);
  });
});

describe('shadePosition / legend', () => {
  it('is 0 for untrained and strictly rising after', () => {
    expect(shadePosition(0)).toBe(0);
    for (let b = 1; b < BODY_SHADE_BANDS; b++) expect(shadePosition(b)).toBeGreaterThan(shadePosition(b - 1));
    expect(shadePosition(6)).toBeLessThanOrEqual(1);
  });
  it('has one label per band', () => {
    expect(BODY_SHADE_LABELS).toEqual(['0', '5', '10', '20', '40', '70', '100']);
    expect(BODY_SHADE_LABELS).toHaveLength(BODY_SHADE_BANDS);
  });
});

describe('plateOpacity', () => {
  for (const ink of ['mono', 'colour'] as const) {
    it(`${ink}: strictly monotonic with a clear jump off untrained`, () => {
      for (let b = 1; b < BODY_SHADE_BANDS; b++) expect(plateOpacity(b, ink)).toBeGreaterThan(plateOpacity(b - 1, ink));
      expect(plateOpacity(1, ink) - plateOpacity(0, ink)).toBeGreaterThan(0.15);
      expect(plateOpacity(6, ink)).toBeLessThanOrEqual(1);
    });
  }
});

// ---- Contrast, computed from the real token values -------------------------
// KEEP IN SYNC with src/styles/global.css: --color-surface, --color-fg, --bm-mango
// in :root and html[data-theme='dark']. [h, s%, l%].
type Hsl = [number, number, number];
const TOKENS: Record<'light' | 'dark', { surface: Hsl; fg: Hsl; mango: Hsl }> = {
  light: { surface: [0, 0, 100], fg: [0, 0, 7], mango: [28, 90, 32] },
  dark: { surface: [0, 0, 8], fg: [0, 0, 100], mango: [36, 92, 58] },
};
type Rgb = [number, number, number];

function hslToRgb([h, s, l]: Hsl): Rgb {
  const sat = s / 100;
  const lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
const mix = (base: Rgb, ink: Rgb, a: number): Rgb => base.map((v, i) => v * (1 - a) + ink[i]! * a) as Rgb;
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (c: Rgb) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
function ratio(a: Rgb, b: Rgb): number {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function shades(theme: 'light' | 'dark', ink: BodyMapInk): Rgb[] {
  const t = TOKENS[theme];
  const surface = hslToRgb(t.surface);
  const base = mix(surface, hslToRgb(t.fg), PLATE_BASE_TINT);
  const inkRgb = hslToRgb(ink === 'mono' ? t.fg : t.mango);
  return Array.from({ length: BODY_SHADE_BANDS }, (_, b) => mix(base, inkRgb, plateOpacity(b, ink)));
}

describe('plate contrast (WCAG ratio over --color-surface)', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const ink of ['mono', 'colour'] as const) {
      it(`${theme} ${ink}`, () => {
        const s = shades(theme, ink);
        expect(ratio(s[0]!, s[1]!)).toBeGreaterThanOrEqual(1.5);
        const min = ink === 'mono' ? 1.2 : 1.15;
        for (let b = 2; b < BODY_SHADE_BANDS; b++) expect(ratio(s[b - 1]!, s[b]!)).toBeGreaterThanOrEqual(min);
      });
    }
  }
});
