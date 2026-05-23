import { describe, expect, it } from 'vitest';
import { bestE1rm, e1rm } from '@/lib/e1rm';

describe('e1rm', () => {
  it('returns the weight unchanged at 1 rep', () => {
    expect(e1rm(100, 1)).toBe(100);
  });

  it('estimates above the working weight for multi-rep sets', () => {
    // Brzycki: 100 / (1.0278 - 0.0278*5) = 112.51…
    expect(e1rm(100, 5)).toBeCloseTo(112.51, 1);
  });

  it('returns null for non-positive weight', () => {
    expect(e1rm(0, 5)).toBeNull();
  });

  it('returns null for reps below 1 or at/above the Brzycki ceiling', () => {
    expect(e1rm(100, 0)).toBeNull();
    expect(e1rm(100, 37)).toBeNull();
  });

  it('still estimates just under the ceiling', () => {
    expect(e1rm(100, 36)).not.toBeNull();
  });
});

describe('bestE1rm', () => {
  it('returns null for an empty list', () => {
    expect(bestE1rm([])).toBeNull();
  });

  it('skips sets missing weight or reps', () => {
    expect(bestE1rm([{ weight: 100 }, { reps: 5 }])).toBeNull();
  });

  it('returns the maximum estimate across sets', () => {
    // e1rm(110,3) ≈ 116.5 beats e1rm(100,5) ≈ 112.5
    expect(bestE1rm([{ weight: 100, reps: 5 }, { weight: 110, reps: 3 }])).toBeCloseTo(116.48, 1);
  });
});
