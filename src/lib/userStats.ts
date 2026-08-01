import { HR_MAX_FROM_AGE, STATS_LIMITS, VOLUME } from '@/app.config';
import type { UserStats } from '@/lib/types';

// Derivations from `user_stats`. They live in one place so no component and no
// metric file re-implements them — and so the "no row yet" answer is identical
// everywhere. Every function here accepts `null`, because the showcase client
// cannot read this table at all (no anon policy) and a signed-in user who has
// never opened Settings has no row either. Absence must fall back, never throw.

/**
 * What one unweighted rep costs, in kg-equivalent.
 *
 * A push-up, a box jump and a plank second are all the lifter moving or
 * supporting their own mass, so pricing them against that mass is the honest
 * reading — a 110kg lifter doing push-ups is doing roughly twice the work of a
 * 55kg one, and the flat `VOLUME.unweightedRepKg` said they were equal.
 *
 * `bodyweightFraction` is one global number, not a per-movement leverage table:
 * see the note in app.config.ts for why that trade was made.
 */
export function unweightedRepKg(stats: UserStats | null): number {
  const kg = stats?.body_weight_kg;
  if (kg == null || !Number.isFinite(kg) || kg <= 0) return VOLUME.unweightedRepKg;
  return kg * VOLUME.bodyweightFraction;
}

/** Age in whole years, or null when no plausible birth year is on file. */
export function ageFrom(stats: UserStats | null, today: Date = new Date()): number | null {
  const year = stats?.birth_year;
  if (year == null || !Number.isInteger(year)) return null;
  if (year < STATS_LIMITS.birthYear.min || year > STATS_LIMITS.birthYear.max) return null;
  const age = today.getUTCFullYear() - year;
  return age > 0 ? age : null;
}

/**
 * The 220−age estimate of maximum heart rate, or null when age is unknown.
 *
 * Only ever a FALLBACK. An hr_max the user has actually hit beats a population
 * formula every time, so callers must place this BELOW `observedHrMax` in the
 * chain — see `AspectMetricOptions.hrMaxFallback` in lib/aspects.ts.
 */
export function hrMaxFromAge(stats: UserStats | null, today: Date = new Date()): number | null {
  const age = ageFrom(stats, today);
  if (age == null) return null;
  return HR_MAX_FROM_AGE.base - age;
}

/**
 * A lift as a multiple of bodyweight, or null when bodyweight is unknown. The
 * direct reading of "use weight as a reference for weight moved" — a 140kg
 * squat means something different at 60kg than at 100kg.
 */
export function bodyweightMultiple(kg: number, stats: UserStats | null): number | null {
  const bw = stats?.body_weight_kg;
  if (bw == null || !Number.isFinite(bw) || bw <= 0) return null;
  if (!Number.isFinite(kg) || kg <= 0) return null;
  return kg / bw;
}
