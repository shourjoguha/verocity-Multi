import { describe, expect, it } from 'vitest';
import { hypertrophyVolumeShort } from '@/lib/coach/rules/training';
import type { TrainingSignals } from '@/lib/coach/signals';
import type { UserStats } from '@/lib/types';

const stats = { goals: [{ id: 'hypertrophy', label: 'Hypertrophy', weight: 40 }] } as unknown as UserStats;
const zeroOutside = { minutesPerWeek: 0, sources: [] as string[] };

const signals = (outside: Partial<TrainingSignals['regionOutsideSets']>): TrainingSignals =>
  ({
    windowDays: 56,
    coverage: 0.9,
    regionSetsPerWeek: {
      value: { quads: 6, glutes: 12, hamstrings: 11, back: 14, chest: 12, shoulders: 11, arms: 12, core: 13, calves: 10 },
      samples: 20,
      sufficiency: 'ok',
    },
    regionOutsideSets: {
      quads: zeroOutside, glutes: zeroOutside, hamstrings: zeroOutside, back: zeroOutside, chest: zeroOutside,
      shoulders: zeroOutside, arms: zeroOutside, core: zeroOutside, calves: zeroOutside,
      ...outside,
    },
  }) as unknown as TrainingSignals;

describe('set-floor finding and work outside sets', () => {
  it('names the conditioning and activity work on a short region, and ramps the advice', () => {
    const f = hypertrophyVolumeShort(
      signals({ quads: { minutesPerWeek: 23.6, sources: ['Sled push', 'Padel'] } }),
      stats,
      '2026-W45',
    )!;
    expect(f.ruleId).toBe('training.hypertrophy.region-volume-short');
    expect(f.body).toContain('quads ~24 min/week (Sled push, Padel)');
    expect(f.body).toContain('does not count toward the floor');
    expect(f.action).toContain('over the next two or three weeks');
    // A minute never becomes a set: the measured shortfall is unchanged.
    expect(f.observed?.lowestSetsPerWeek).toBe(6);
  });

  it('says nothing extra when the short region did no other work', () => {
    const f = hypertrophyVolumeShort(signals({}), stats, '2026-W45')!;
    expect(f.body).not.toContain('Outside those sets');
    expect(f.action).not.toContain('two or three weeks');
  });
});
