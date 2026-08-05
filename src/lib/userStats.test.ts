import { describe, expect, it } from 'vitest';
import { HR_MAX_FROM_AGE, VOLUME } from '@/app.config';
import { ageFrom, bodyweightMultiple, hrMaxFromAge, unweightedRepKg } from '@/lib/userStats';
import type { UserStats } from '@/lib/types';

const stats = (patch: Partial<UserStats> = {}): UserStats => ({
  owner_user_id: 'u1',
  body_weight_kg: null,
  height_cm: null,
  birth_year: null,
  gender: null,
  body_type: null,
  injuries: [],
  goals: [],
  experience: null,
  days_per_week: null,
  equipment: [],
  preferred_plan_weeks: null,
  disciplines: [],
  onboarded_at: null,
  updated_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  ...patch,
});

const today = new Date('2026-08-01T00:00:00Z');

describe('unweightedRepKg', () => {
  it('falls back to the flat constant with no stats row at all', () => {
    expect(unweightedRepKg(null)).toBe(VOLUME.unweightedRepKg);
  });

  it('falls back when the row exists but bodyweight was never entered', () => {
    expect(unweightedRepKg(stats())).toBe(VOLUME.unweightedRepKg);
  });

  it('prices against the owner mass when bodyweight is known', () => {
    expect(unweightedRepKg(stats({ body_weight_kg: 80 }))).toBeCloseTo(
      80 * VOLUME.bodyweightFraction,
      5,
    );
  });

  it('makes a heavier lifter cost more per unweighted rep', () => {
    const light = unweightedRepKg(stats({ body_weight_kg: 55 }));
    const heavy = unweightedRepKg(stats({ body_weight_kg: 110 }));
    expect(heavy).toBeCloseTo(light * 2, 5);
  });

  it('rejects nonsense rather than pricing work at zero', () => {
    for (const kg of [0, -80, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(unweightedRepKg(stats({ body_weight_kg: kg }))).toBe(VOLUME.unweightedRepKg);
    }
  });
});

describe('ageFrom', () => {
  it('reads whole years off the birth year', () => {
    expect(ageFrom(stats({ birth_year: 1990 }), today)).toBe(36);
  });

  it('is null with no birth year', () => {
    expect(ageFrom(null, today)).toBeNull();
    expect(ageFrom(stats(), today)).toBeNull();
  });

  it('is null for years outside the plausible range, not a wild age', () => {
    expect(ageFrom(stats({ birth_year: 1200 }), today)).toBeNull();
    expect(ageFrom(stats({ birth_year: 2099 }), today)).toBeNull();
  });
});

describe('hrMaxFromAge', () => {
  it('is 220 − age when the birth year is known', () => {
    expect(hrMaxFromAge(stats({ birth_year: 1990 }), today)).toBe(HR_MAX_FROM_AGE.base - 36);
  });

  it('is null rather than a default when age is unknown', () => {
    // Null, NOT HR.maxFallback: the caller places this below observedHrMax in
    // the fallback chain, and returning a number here would let the estimate
    // outrank an hr_max the user actually hit.
    expect(hrMaxFromAge(null, today)).toBeNull();
    expect(hrMaxFromAge(stats(), today)).toBeNull();
  });

  it('gives an older lifter a lower ceiling', () => {
    const young = hrMaxFromAge(stats({ birth_year: 2000 }), today)!;
    const older = hrMaxFromAge(stats({ birth_year: 1970 }), today)!;
    expect(older).toBeLessThan(young);
  });
});

describe('bodyweightMultiple', () => {
  it('expresses a lift as a multiple of the owner mass', () => {
    expect(bodyweightMultiple(140, stats({ body_weight_kg: 70 }))).toBeCloseTo(2, 5);
  });

  it('is null when either side is missing, so the UI can render nothing', () => {
    expect(bodyweightMultiple(140, null)).toBeNull();
    expect(bodyweightMultiple(140, stats())).toBeNull();
    expect(bodyweightMultiple(0, stats({ body_weight_kg: 70 }))).toBeNull();
  });
});
