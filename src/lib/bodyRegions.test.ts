import { describe, expect, it } from 'vitest';
import {
  BODY_FACES,
  BODY_MUSCLE_SHAPES,
  BODY_MUSCLE_SILHOUETTE,
  BODY_VIEWBOX,
  facesForMuscle,
} from '@/lib/bodyRegions';
import { MUSCLES, MUSCLE_KEYS, MUSCLE_REGION_KEYS, type MuscleKey } from '@/app.config';

// The lockstep check. Regions own no geometry any more — a region is drawn as
// the union of its muscles — so the region-level guarantee is that every
// taxonomy region has at least one drawn muscle on some face. A region whose
// muscles were all undrawn would shade nothing and throw nothing.
describe('every taxonomy region is drawn through its muscles', () => {
  it('draws at least one muscle of every region', () => {
    for (const region of MUSCLE_REGION_KEYS) {
      const drawn = MUSCLE_KEYS.filter(
        (m) => MUSCLES[m].region === region && facesForMuscle(m).length > 0,
      );
      expect(drawn.length, region).toBeGreaterThan(0);
    }
  });
});

describe('muscle geometry stays in lockstep with the muscle taxonomy', () => {
  it('draws every muscle on at least one face', () => {
    for (const muscle of MUSCLE_KEYS) {
      expect(facesForMuscle(muscle).length, muscle).toBeGreaterThan(0);
    }
  });

  it('has no geometry for a muscle the taxonomy does not define', () => {
    for (const face of BODY_FACES) {
      for (const key of Object.keys(BODY_MUSCLE_SHAPES[face])) {
        expect(MUSCLE_KEYS).toContain(key as MuscleKey);
      }
    }
  });

  it('gives every muscle shape a closed path inside the viewBox and a fibre angle', () => {
    const [, , w, h] = BODY_VIEWBOX.split(' ').map(Number);
    for (const face of BODY_FACES) {
      for (const shapes of Object.values(BODY_MUSCLE_SHAPES[face])) {
        for (const shape of shapes ?? []) {
          expect(shape.d).toMatch(/^M/);
          expect(shape.d.trim().endsWith('Z')).toBe(true);
          expect(typeof shape.angle).toBe('number');
          const coords = (shape.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
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

  it('keeps mirrored muscle shapes on one side of the midline', () => {
    for (const face of BODY_FACES) {
      for (const shapes of Object.values(BODY_MUSCLE_SHAPES[face])) {
        for (const shape of shapes ?? []) {
          const coords = (shape.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
          const xs = coords.filter((_, i) => i % 2 === 0);
          expect(Math.max(...xs)).toBeLessThanOrEqual(50);
        }
      }
    }
  });

  it('draws the new shapes where they belong', () => {
    expect(facesForMuscle('hipFlexors')).toEqual(['front']);
    expect(facesForMuscle('sideDelts')).toEqual(['front', 'back']);
    expect(BODY_MUSCLE_SHAPES.front.quads).toHaveLength(3);
  });

  it('has a muscle silhouette for both faces', () => {
    for (const face of BODY_FACES) {
      expect(BODY_MUSCLE_SILHOUETTE[face]).toMatch(/^M/);
      expect(BODY_MUSCLE_SILHOUETTE[face].length).toBeGreaterThan(20);
    }
  });

  // Phase F2: the F1 port drew rearDelts as a sliver with sideDelts covering
  // most of the posterior cap. Rear delts own the inner two-thirds of the back
  // of the shoulder; side delts only the outer edge.
  it('gives rear delts most of the back of the shoulder', () => {
    const width = (d: string) => {
      const xs = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 0);
      return Math.max(...xs) - Math.min(...xs);
    };
    const rear = width(BODY_MUSCLE_SHAPES.back.rearDelts![0].d);
    const side = width(BODY_MUSCLE_SHAPES.back.sideDelts![0].d);
    expect(rear).toBeGreaterThan(side * 1.5);
  });
});
