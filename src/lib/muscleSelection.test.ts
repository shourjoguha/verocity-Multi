import { describe, expect, it } from 'vitest';
import {
  MUSCLE_SHARES,
  nearestWithin,
  roleOf,
  selectionFromProfile,
  splitReadout,
  toggleMuscle,
  weightsFromSelection,
} from '@/lib/muscleSelection';
import { applyOverride, EMPTY_PROFILE } from '@/lib/movementTaxonomy';

const sum = (w: Record<string, number | undefined>) =>
  Object.values(w).reduce<number>((a, b) => a + (b ?? 0), 0);

describe('toggleMuscle', () => {
  it('first tap is primary, later taps are helpers, a repeat tap removes', () => {
    let s = toggleMuscle([], 'quads');
    expect(roleOf(s, 'quads')).toBe('primary');
    s = toggleMuscle(s, 'gluteMax');
    expect(roleOf(s, 'gluteMax')).toBe('helper');
    s = toggleMuscle(s, 'gluteMax');
    expect(s).toEqual(['quads']);
  });

  it('removing the primary promotes the first helper', () => {
    const s = toggleMuscle(['quads', 'gluteMax', 'adductors'], 'quads');
    expect(s).toEqual(['gluteMax', 'adductors']);
    expect(roleOf(s, 'gluteMax')).toBe('primary');
  });
});

describe('weightsFromSelection', () => {
  it('nothing selected is nothing', () => {
    expect(weightsFromSelection([])).toEqual({});
  });

  it('a primary alone is 1.0', () => {
    expect(weightsFromSelection(['pecs'])).toEqual({ pecs: 1 });
  });

  it('primary + 1 is 65/35', () => {
    expect(weightsFromSelection(['quads', 'gluteMax'])).toEqual({
      quads: MUSCLE_SHARES.primary,
      gluteMax: MUSCLE_SHARES.helpers,
    });
  });

  it('primary + 3 splits the helper share equally and sums to 1', () => {
    const w = weightsFromSelection(['lats', 'biceps', 'rearDelts', 'forearms']);
    expect(w.lats).toBe(0.65);
    for (const h of ['biceps', 'rearDelts', 'forearms'] as const) expect(w[h]).toBeCloseTo(0.35 / 3);
    expect(sum(w)).toBeCloseTo(1);
  });
});

describe('selectionFromProfile', () => {
  it('a region-only override expands through the default split', () => {
    // quads → quads 0.9 / adductors 0.1; glutes → gluteMax 0.8 / gluteMed 0.2.
    // At 65/35: quads .585, gluteMax .28, gluteMed .07, adductors .065.
    expect(selectionFromProfile({ regions: { quads: 0.65, glutes: 0.35 } })).toEqual(['quads', 'gluteMax']);
  });

  it('a single-region override keeps every split muscle at or above the floor', () => {
    expect(selectionFromProfile({ regions: { shoulders: 1 } })).toEqual(['frontDelts', 'sideDelts', 'rearDelts']);
  });

  it('authored muscles reopen as written, heaviest first, none dropped', () => {
    const w = weightsFromSelection(['lats', 'biceps', 'rearDelts', 'forearms', 'traps']);
    const s = selectionFromProfile({ muscles: w });
    expect(s[0]).toBe('lats');
    expect(new Set(s)).toEqual(new Set(['lats', 'biceps', 'rearDelts', 'forearms', 'traps']));
  });

  it('an override with neither map preselects nothing', () => {
    expect(selectionFromProfile({ modality: 'mobility' })).toEqual([]);
    expect(selectionFromProfile(null)).toEqual([]);
  });

  it('what the editor saves resolves as authored muscles', () => {
    const p = applyOverride(EMPTY_PROFILE, { muscles: weightsFromSelection(['quads', 'gluteMax']) });
    expect(p.muscleSource).toBe('authored');
    expect(p.regions.quads).toBeCloseTo(0.65);
    expect(p.regions.glutes).toBeCloseTo(0.35);
  });
});

describe('splitReadout', () => {
  it('reads whole percentages that sum to 100', () => {
    expect(splitReadout(['quads', 'gluteMax', 'adductors'])).toBe('Quads 65 · Glute max 18 · Adductors 17');
    expect(splitReadout(['pecs'])).toBe('Pecs 100');
  });
});

describe('nearestWithin', () => {
  const cands = [
    { key: 'tibialis' as const, points: [{ x: 10, y: 0 }] },
    { key: 'calves' as const, points: [{ x: 30, y: 0 }] },
  ];
  it('picks the nearest outline inside the radius', () => {
    expect(nearestWithin({ x: 18, y: 0 }, cands, 22)).toBe('tibialis');
    expect(nearestWithin({ x: 22, y: 0 }, cands, 22)).toBe('calves');
  });
  it('returns null outside the radius', () => {
    expect(nearestWithin({ x: 100, y: 100 }, cands, 22)).toBeNull();
  });
});
