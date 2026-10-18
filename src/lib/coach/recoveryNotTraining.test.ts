// A session tagged 'recovery' is never training, whatever else it is tagged.
// Operator ruling 2026-10-18: a Yin class tagged recovery + mobility still
// shows up as mobility in the app, but it must not count as a training session
// — not for frequency, not as the load half of the readiness read, and not as a
// "trained day" for the nutrition rules. Its minutes still count as mobility.

import { describe, expect, it } from 'vitest';
import { TRAINING } from '@/lib/coach/knowledge';
import {
  isRecovery,
  measureFuelTiming,
  measureNutrition,
  measureTraining,
} from '@/lib/coach/signals';
import { frequencyBelowTarget } from '@/lib/coach/rules/training';
import type { MealLog, UserStats, WorkoutLog } from '@/lib/types';

const opts = {
  heavyFraction: TRAINING.strengthIntensityModerate.value,
  strengthRepMax: TRAINING.strengthReps.value,
  hypertrophyReps: TRAINING.hypertrophyReps.value,
  nearFailureRpe: TRAINING.hypertrophyProximityToFailure.value,
  allOutRpe: TRAINING.vo2AllOut.value,
  heavyRestSeconds: TRAINING.strengthRest.value,
};

const OCT18 = new Date('2026-10-18T12:00:00Z');

function session(date: string, tags: string[] = [], startedAt: string | null = null): WorkoutLog {
  return {
    started_at: startedAt,
    total_seconds: 75 * 60,
    id: `log-${date}-${tags.join('-')}`,
    owner_user_id: 'u',
    plan_id: null,
    log_date: date,
    status: 'done',
    tags,
    hr_max: null,
    hr_avg: null,
    data: { sections: [] },
  } as unknown as WorkoutLog;
}

/** Eight training sessions over the 28-day window: two a week. */
const TRAINING_LOGS = [
  '2026-09-22', '2026-09-25', '2026-09-29', '2026-10-02',
  '2026-10-06', '2026-10-09', '2026-10-13', '2026-10-16',
].map((d) => session(d));

/** Eight recovery sessions, half of them also tagged mobility. */
const RECOVERY_LOGS = [
  '2026-09-23', '2026-09-26', '2026-09-30', '2026-10-03',
  '2026-10-07', '2026-10-10', '2026-10-14', '2026-10-17',
].map((d, i) => session(d, i % 2 ? ['recovery', 'mobility'] : ['mobility', 'recovery']));

describe('isRecovery', () => {
  it('is true when recovery is any one of the tags', () => {
    expect(isRecovery(session('2026-10-01', ['recovery']))).toBe(true);
    expect(isRecovery(session('2026-10-01', ['mobility', 'recovery']))).toBe(true);
  });

  it('is false without the recovery tag, including mobility alone', () => {
    expect(isRecovery(session('2026-10-01', ['mobility']))).toBe(false);
    expect(isRecovery(session('2026-10-01'))).toBe(false);
  });
});

describe('recovery sessions are not training sessions', () => {
  it('does not count toward sessions or sessions per week', () => {
    const s = measureTraining([...TRAINING_LOGS, ...RECOVERY_LOGS], opts, OCT18);
    expect(s.sessions).toBe(8);
    expect(s.sessionsPerWeek.value).toBe(2);
  });

  it('cannot hide a frequency shortfall', () => {
    const stats = { days_per_week: 4 } as UserStats;
    const s = measureTraining([...TRAINING_LOGS, ...RECOVERY_LOGS], opts, OCT18);
    const f = frequencyBelowTarget(s, stats, '2026-W42');
    expect(f).not.toBeNull();
    expect(f!.observed.sessionsPerWeek).toBe(2);
  });

  it('is not a training day for the run, even when also tagged mobility', () => {
    const logs = [session('2026-10-16'), session('2026-10-17', ['recovery', 'mobility']), session('2026-10-18')];
    expect(measureTraining(logs, opts, OCT18).currentConsecutiveDays).toBe(1);
  });
});

function meal(date: string, time: string): MealLog {
  return { id: `m-${date}-${time}`, log_date: date, eaten_time: time, tags: [] } as unknown as MealLog;
}

describe('recovery sessions are not training days for nutrition', () => {
  it('a day with only a recovery session is not a trained day', () => {
    const logs = [session('2026-10-16'), session('2026-10-17', ['recovery', 'mobility'])];
    const meals = [meal('2026-10-16', '19:00'), meal('2026-10-17', '08:00')];
    expect(measureNutrition(meals, logs, OCT18).trainingDays).toBe(1);
  });

  it('a long recovery session is not an unfed hard session', () => {
    // A 75-minute Yin class before breakfast is not what the fasted-training rule is about.
    const logs = [session('2026-10-17', ['mobility', 'recovery'], '2026-10-17T07:00:00')];
    const meals = [meal('2026-10-17', '10:00')];
    expect(measureFuelTiming(logs, meals, 60, OCT18).pairedDays).toBe(0);
  });
});
