// What the coach may treat as measured: a rated RPE over a seeded one, the
// athlete's own heart rate over any RPE, and the strength line Galpin actually
// gave for the athlete's training age. Each case here was a live false finding
// on a real log before it was a test.

import { describe, expect, it } from 'vitest';
import { ALL_OUT_HR } from '@/app.config';
import { TRAINING } from '@/lib/coach/knowledge';
import { measureTraining, observedPeakHr, setRpeIsRating } from '@/lib/coach/signals';
import {
  heavyFractionFor,
  intervalsNotAllOut,
  loadedTooLight,
  strengthLine,
} from '@/lib/coach/rules/training';
import type { SetActual, UserStats, WorkoutLog } from '@/lib/types';

const TODAY = new Date('2026-10-09T12:00:00Z');

const opts = {
  heavyFraction: TRAINING.strengthIntensity.value,
  strengthRepMax: TRAINING.strengthReps.value,
  hypertrophyReps: TRAINING.hypertrophyReps.value,
  nearFailureRpe: TRAINING.hypertrophyProximityToFailure.value,
  allOutRpe: TRAINING.vo2AllOut.value,
  heavyRestSeconds: TRAINING.strengthRest.value,
};

function bout(actual: Partial<SetActual>) {
  return {
    planned: null,
    notations: [],
    actual: { time: 30, rpe: 7, completed: true, prefilled: true, ...actual } as SetActual,
  };
}

/** One done session holding `n` timed conditioning bouts. */
function intervalLog(day: number, n: number, actual: Partial<SetActual>, hrMax: number | null): WorkoutLog {
  const date = new Date(TODAY.getTime() - day * 86_400_000).toISOString().slice(0, 10);
  return {
    id: `log-${day}`,
    owner_user_id: 'u',
    plan_id: null,
    log_date: date,
    status: 'done',
    hr_max: hrMax,
    hr_avg: null,
    data: {
      sections: [
        {
          key: 'conditioning',
          groups: [
            {
              id: `g-${day}`,
              kind: 'single',
              items: [
                {
                  id: `i-${day}`,
                  movement: 'Assault Bike Sprint',
                  primaryMetric: 'time',
                  sets: Array.from({ length: n }, () => bout(actual)),
                },
              ],
            },
          ],
        },
      ],
    },
  } as unknown as WorkoutLog;
}

/** Two sessions a week for four weeks. */
function block(actual: Partial<SetActual>, hrMax: (i: number) => number | null): WorkoutLog[] {
  return Array.from({ length: 8 }, (_, i) => intervalLog(1 + i * 3, 4, actual, hrMax(i)));
}

const stats = (experience: UserStats['experience'], strength = 35) =>
  ({ experience, goals: [{ id: 'strength', label: 'Strength', weight: strength }] }) as unknown as UserStats;

describe('a seeded RPE is not a rating', () => {
  it('trusts the per-set flag over the session heuristic', () => {
    expect(setRpeIsRating({ rpe: 7, rpeRated: false }, true)).toBe(false);
    expect(setRpeIsRating({ rpe: 9, rpeRated: true }, false)).toBe(true);
  });

  it('falls back to the session heuristic for sets that predate the flag', () => {
    expect(setRpeIsRating({ rpe: 8 }, true)).toBe(true);
    expect(setRpeIsRating({ rpe: 8 }, false)).toBe(false);
    expect(setRpeIsRating({ rpe: null, rpeRated: true }, true)).toBe(false);
  });

  it('leaves seeded bouts out of the interval RPE, so the rule cannot speak on them', () => {
    // Seeded at 8 from last time, never touched: this used to read as
    // "intervals average RPE 8, not all-out" every check-in.
    const t = measureTraining(block({ rpe: 8, rpeRated: false }, () => null), opts, TODAY);
    expect(t.intervals.value.bouts).toBe(32);
    expect(t.intervals.value.ratedBouts).toBe(0);
    expect(t.intervals.value.meanRpe).toBeNull();
    expect(intervalsNotAllOut(t, null, '2026-W41')).toBeNull();
  });

  it('still speaks when the athlete rated the bouts below all-out', () => {
    const t = measureTraining(block({ rpe: 7, rpeRated: true }, () => null), opts, TODAY);
    const f = intervalsNotAllOut(t, null, '2026-W41');
    expect(f?.ruleId).toBe('training.endurance.intervals-not-all-out');
    expect(f?.observed.ratedBouts).toBe(32);
  });
});

describe('heart rate outranks RPE for all-out', () => {
  it('needs enough sessions before the peak is a reference', () => {
    const few = block({}, () => null).slice(0, ALL_OUT_HR.minSessionsForPeak - 1).map((l) => ({ ...l, hr_max: 190 }));
    expect(observedPeakHr(few)).toBeNull();
    expect(observedPeakHr(block({}, (i) => 170 + i))).toBe(177);
  });

  it('stays silent when the strap shows max touched every week, whatever the RPE says', () => {
    // Peak 196; every session reaches 180 (92% of it).
    const logs = block({ rpe: 7, rpeRated: true }, (i) => (i === 0 ? 196 : 180));
    const t = measureTraining(logs, opts, TODAY);
    expect(t.intervals.value.peakHr).toBe(196);
    expect(t.intervals.value.hrAllOutSessions).toBe(8);
    expect(intervalsNotAllOut(t, null, '2026-W41')).toBeNull();
  });

  it('speaks, and cites the measured peak, when neither channel reaches max', () => {
    const logs = block({ rpe: 7, rpeRated: true }, (i) => (i === 0 ? 196 : 150));
    const t = measureTraining(logs, opts, TODAY);
    const f = intervalsNotAllOut(t, null, '2026-W41');
    expect(f).not.toBeNull();
    expect(f?.claims.map((c) => c.id)).toContain(TRAINING.maxHrObserved.id);
    expect(f?.body).toContain('196');
  });
});

describe('the strength line follows the training age Galpin conditioned it on', () => {
  it('maps experience onto his three cases', () => {
    expect(strengthLine(stats('advanced'))).toBe(TRAINING.strengthIntensity);
    expect(strengthLine(stats('intermediate'))).toBe(TRAINING.strengthIntensityModerate);
    expect(strengthLine(stats('beginner'))).toBeNull();
    expect(strengthLine(null)).toBe(TRAINING.strengthIntensity);
    expect(heavyFractionFor(stats('intermediate'))).toBe(0.75);
    expect(heavyFractionFor(stats('beginner'))).toBe(0.85);
  });

  it('keeps the rule silent for a beginner, for whom "everything works"', () => {
    const t = measureTraining(block({}, () => null), opts, TODAY);
    const forced = {
      ...t,
      loadedIntensity: {
        ...t.loadedIntensity,
        sufficiency: 'ok' as const,
        value: { ...t.loadedIntensity.value, share: 0.05, atOrAboveHeavy: 1, total: 20 },
      },
    };
    expect(loadedTooLight(forced, stats('beginner'), '2026-W41')).toBeNull();
    const f = loadedTooLight(forced, stats('intermediate'), '2026-W41');
    expect(f?.claims[0].id).toBe(TRAINING.strengthIntensityModerate.id);
    expect(f?.observed.heavyLine).toBe(0.75);
    expect(f?.tldr).toContain('75%');
  });
});
