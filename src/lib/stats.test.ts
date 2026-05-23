import { describe, expect, it } from 'vitest';
import { familyOf, flattenSets, sessionVolume } from '@/lib/stats';
import type { WorkoutLog } from '@/lib/types';

function log(sets: { weight?: number; reps?: number; rpe?: number; completed?: boolean }[]): WorkoutLog {
  return {
    data: {
      sections: [
        {
          key: 'primary',
          groups: [
            {
              id: 'g1',
              kind: 'single',
              items: [
                {
                  id: 'i1',
                  movement: 'Back Squat',
                  primaryMetric: 'weight',
                  sets: sets.map((s) => ({
                    planned: null,
                    notations: [],
                    actual: {
                      weight: s.weight,
                      reps: s.reps,
                      rpe: s.rpe,
                      completed: s.completed ?? true,
                      prefilled: false,
                    },
                  })),
                },
              ],
            },
          ],
        },
      ],
    },
  } as unknown as WorkoutLog;
}

describe('flattenSets', () => {
  it('flattens nested sections/groups/items into per-set rows', () => {
    const flat = flattenSets(log([{ weight: 100, reps: 5, rpe: 8 }]));
    expect(flat).toHaveLength(1);
    expect(flat[0]).toMatchObject({ movement: 'Back Squat', weight: 100, reps: 5, rpe: 8, completed: true });
  });

  it('returns an empty array when there is no log data', () => {
    expect(flattenSets({} as WorkoutLog)).toEqual([]);
  });
});

describe('sessionVolume', () => {
  it('sums weight × reps across sets', () => {
    expect(sessionVolume(log([{ weight: 100, reps: 5 }, { weight: 100, reps: 5 }]))).toBe(1000);
  });

  it('treats missing weight or reps as zero contribution', () => {
    expect(sessionVolume(log([{ reps: 5 }, { weight: 100, reps: 3 }]))).toBe(300);
  });
});

describe('familyOf', () => {
  it('maps movements to their family by substring, case-insensitively', () => {
    expect(familyOf('Back Squat')).toBe('squat');
    expect(familyOf('Bench Press')).toBe('press');
    expect(familyOf('DEADLIFT')).toBe('hinge');
  });

  it('returns null for unknown movements', () => {
    expect(familyOf('Bicep Curl')).toBeNull();
  });
});
