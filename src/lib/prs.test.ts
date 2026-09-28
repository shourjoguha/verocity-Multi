import { describe, expect, it } from 'vitest';
import { bestE1rmByMovement, bestE1rmByTrack, e1rmOf, isPrSet } from '@/lib/prs';
import type { SetActual, WorkoutLog } from '@/lib/types';

function log(movement: string, sets: Partial<SetActual>[], notations: string[] = []): WorkoutLog {
  return {
    data: {
      sections: [
        {
          groups: [
            {
              items: [
                {
                  movement,
                  sets: sets.map((a) => ({ actual: { completed: true, ...a }, notations })),
                },
              ],
            },
          ],
        },
      ],
    },
  } as unknown as WorkoutLog;
}

describe('prs', () => {
  it('e1rmOf needs both weight and reps', () => {
    expect(e1rmOf({ weight: 100, reps: 5 })).toBeGreaterThan(100);
    expect(e1rmOf({ weight: 100, reps: undefined })).toBeNull();
    expect(e1rmOf({ weight: undefined, reps: 5 })).toBeNull();
  });

  it('bestE1rmByMovement takes the max completed e1RM per movement', () => {
    const logs = [
      log('squat', [{ weight: 100, reps: 5 }, { weight: 120, reps: 3 }]),
      log('squat', [{ weight: 110, reps: 5 }]),
      log('bench', [{ weight: 80, reps: 5 }]),
    ];
    const best = bestE1rmByMovement(logs);
    // squat best is the heavier of 120x3 vs 110x5
    expect(best.get('squat')).toBe(Math.max(e1rmOf({ weight: 120, reps: 3 })!, e1rmOf({ weight: 110, reps: 5 })!));
    expect(best.get('bench')).toBe(e1rmOf({ weight: 80, reps: 5 }));
  });

  it('ignores incomplete sets', () => {
    const logs = [log('squat', [{ weight: 200, reps: 5, completed: false }, { weight: 100, reps: 5 }])];
    expect(bestE1rmByMovement(logs).get('squat')).toBe(e1rmOf({ weight: 100, reps: 5 }));
  });

  it('isPrSet beats the prior best, never on a first attempt', () => {
    const prior = e1rmOf({ weight: 100, reps: 5 })!;
    expect(isPrSet({ completed: true, weight: 110, reps: 5 } as SetActual, prior)).toBe(true);
    expect(isPrSet({ completed: true, weight: 90, reps: 5 } as SetActual, prior)).toBe(false);
    expect(isPrSet({ completed: false, weight: 200, reps: 5 } as SetActual, prior)).toBe(false);
    expect(isPrSet({ completed: true, weight: 200, reps: 5 } as SetActual, null)).toBe(false); // no prior
  });

  it('bestE1rmByTrack keeps a variation apart and does not credit a pause', () => {
    const logs = [
      log('Back Squat', [{ weight: 100, reps: 5 }]),
      log('Back Squat', [{ weight: 110, reps: 5 }], ['(v)']),
      log('Back Squat', [{ weight: 95, reps: 5 }], ['(p)']),
      log('Back Squat', [{ weight: 105, reps: 5 }], ['v']),
    ];
    const best = bestE1rmByTrack(logs);
    expect(best.get('Back Squat')).toBeCloseTo(e1rmOf({ weight: 100, reps: 5 }) as number, 5);
    expect(best.get('Back Squat (v)')).toBeCloseTo(e1rmOf({ weight: 110, reps: 5 }) as number, 5);
    // The plain lift's record: a heavier variation does not break it...
    expect(isPrSet({ weight: 105, reps: 5, completed: true, prefilled: false }, best.get('Back Squat'))).toBe(true);
    // ...and a paused set is judged on its literal weight × reps.
    expect(isPrSet({ weight: 98, reps: 5, completed: true, prefilled: false }, best.get('Back Squat'))).toBe(false);
  });
});
