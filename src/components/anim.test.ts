import { describe, expect, it } from 'vitest';
import { cubicBezier, EASE } from './anim';

// AnimatedNumber's easing replaced Motion's; these pin it to the CSS curve
// `--ease-editorial` (cubic-bezier(0.77, 0, 0.175, 1)) rather than to a look.
describe('cubicBezier', () => {
  it('hits the endpoints exactly', () => {
    expect(cubicBezier(EASE, 0)).toBe(0);
    expect(cubicBezier(EASE, 1)).toBe(1);
  });

  it('is the identity for the linear curve', () => {
    for (const t of [0.1, 0.33, 0.5, 0.9]) expect(cubicBezier([0, 0, 1, 1], t)).toBeCloseTo(t, 4);
  });

  it('matches a brute-force solve of the editorial curve', () => {
    // Reference: sample u in [0, 1] at 200k steps, take the u whose x is
    // nearest t, report its y. The curve is NOT symmetric — x1 0.77 vs
    // 1 − x2 0.825 — so t=0.5 lands well past halfway.
    expect(cubicBezier(EASE, 0.25)).toBeCloseTo(0.0529, 3);
    expect(cubicBezier(EASE, 0.5)).toBeCloseTo(0.596, 3);
    expect(cubicBezier(EASE, 0.75)).toBeCloseTo(0.9563, 3);
  });

  it('eases in and out, and never runs backwards', () => {
    expect(cubicBezier(EASE, 0.1)).toBeLessThan(0.1);
    expect(cubicBezier(EASE, 0.9)).toBeGreaterThan(0.9);
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const y = cubicBezier(EASE, i / 100);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
  });
});
