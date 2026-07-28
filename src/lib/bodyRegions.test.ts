import { describe, expect, it } from 'vitest';
import {
  BODY_FACES,
  BODY_REGION_SHAPES,
  BODY_SILHOUETTE,
  BODY_VIEWBOX,
  facesForRegion,
} from '@/lib/bodyRegions';
import { MUSCLE_REGION_KEYS, type RegionKey } from '@/app.config';

// The lockstep check. A region added to the taxonomy with no geometry renders
// nothing and throws nothing; geometry for a region that no longer exists is
// dead weight. Only a test can see either.
describe('region geometry stays in lockstep with the taxonomy', () => {
  it('draws every taxonomy region on at least one face', () => {
    for (const region of MUSCLE_REGION_KEYS) {
      expect(facesForRegion(region).length).toBeGreaterThan(0);
    }
  });

  it('has no geometry for a region the taxonomy does not define', () => {
    for (const face of BODY_FACES) {
      for (const key of Object.keys(BODY_REGION_SHAPES[face])) {
        expect(MUSCLE_REGION_KEYS).toContain(key as RegionKey);
      }
    }
  });
});

describe('path data', () => {
  it('has a silhouette for both faces', () => {
    for (const face of BODY_FACES) {
      expect(BODY_SILHOUETTE[face]).toMatch(/^M/);
      expect(BODY_SILHOUETTE[face].length).toBeGreaterThan(20);
    }
  });

  it('gives every region shape a closed, plausible path', () => {
    for (const face of BODY_FACES) {
      for (const shapes of Object.values(BODY_REGION_SHAPES[face])) {
        for (const shape of shapes ?? []) {
          expect(shape.d).toMatch(/^M/);
          expect(shape.d.trim().toUpperCase().endsWith('Z')).toBe(true);
        }
      }
    }
  });

  it('keeps every coordinate inside the viewBox', () => {
    const [, , w, h] = BODY_VIEWBOX.split(' ').map(Number);
    const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    for (const face of BODY_FACES) {
      for (const shapes of Object.values(BODY_REGION_SHAPES[face])) {
        for (const shape of shapes ?? []) {
          const coords = numbers(shape.d);
          for (let i = 0; i < coords.length; i += 2) {
            expect(coords[i]).toBeGreaterThanOrEqual(0);
            expect(coords[i]).toBeLessThanOrEqual(w);
            expect(coords[i + 1]).toBeGreaterThanOrEqual(0);
            expect(coords[i + 1]).toBeLessThanOrEqual(h);
          }
        }
      }
    }
  });

  // Mirrored limb shapes must sit entirely on one side of the midline, or the
  // mirror overlaps the original and the fill doubles up.
  it('keeps mirrored shapes on one side of the midline', () => {
    const [, , w] = BODY_VIEWBOX.split(' ').map(Number);
    const mid = w / 2;
    for (const face of BODY_FACES) {
      for (const shapes of Object.values(BODY_REGION_SHAPES[face])) {
        for (const shape of shapes ?? []) {
          if (!shape.mirrorX) continue;
          const coords = (shape.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
          const xs = coords.filter((_, i) => i % 2 === 0);
          expect(Math.max(...xs)).toBeLessThanOrEqual(mid);
        }
      }
    }
  });
});
