import { describe, expect, it } from 'vitest';
import { SPRITES, SPRITE_KEYS, rasterize, spriteFrame, tonePath, PALETTE } from '@/lib/coachSprites';

describe('coach sprites', () => {
  it('every beat names a pose that exists, and every frame is N×N in the palette', () => {
    for (const k of SPRITE_KEYS) {
      for (const beat of SPRITES[k].beats) {
        for (const n of [16, 32, 48]) {
          const rows = spriteFrame(k, beat, n);
          expect(rows).toHaveLength(n);
          for (const row of rows) {
            expect(row).toHaveLength(n);
            for (const c of row) expect(c === '.' || c in PALETTE).toBe(true);
          }
        }
      }
    }
  });

  it('outlines a shape and leaves the far corner empty', () => {
    const rows = rasterize([{ k: 'r', c: 'K', x: 0.25, y: 0.25, w: 0.5, h: 0.5 }], 8);
    expect(rows[2]).toBe('.OKKKKO.');
    expect(rows[1]).toBe('..OOOO..');
    expect(rows[0]).toBe('........');
  });

  it('wraps a horizontal offset, so a full lap lands back where it started', () => {
    const still = spriteFrame('hedgehog', { pose: 'runA', ms: 1 }, 16);
    expect(spriteFrame('hedgehog', { pose: 'runA', ms: 1, dx: 1 }, 16)).toEqual(still);
    const half = spriteFrame('hedgehog', { pose: 'runA', ms: 1, dx: 0.5 }, 16);
    expect(half[8]).toBe(still[8].slice(8) + still[8].slice(0, 8));
  });

  it('merges a horizontal run into one subpath per tone', () => {
    expect(tonePath(['.KK.', '.FF.'], 1)).toBe('M1 0h2v1h-2z');
    expect(tonePath(['.KK.', '.FF.'], 2)).toBe('M1 1h2v1h-2z');
  });
});
