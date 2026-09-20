import { describe, expect, it } from 'vitest';
import { computePlanAdherence } from '@/lib/planAdherence';
import type { LogDocument, ParsedPlan, PlanExercise, WorkoutLog } from '@/lib/types';

const TODAY = new Date('2026-03-01T12:00:00Z');

function ex(movement: string, planned: string, weeks = [1, 2, 3, 4]): PlanExercise {
  return {
    movement,
    section: 'primary',
    primaryMetric: 'reps',
    plannedByWeek: Object.fromEntries(weeks.map((w) => [w, planned])),
  };
}

function plan(days: { dayKey: string; label: string; exercises: PlanExercise[] }[]): ParsedPlan {
  return {
    title: 'Test Plan',
    startDate: null,
    endDate: null,
    blocks: [{ type: 'accumulation', startWeek: 1, endWeek: 4 }],
    weeklyTemplate: days.map((d) => d.dayKey),
    days,
  };
}

/** A done log carrying `movement → completed set count`. */
function log(
  id: string,
  date: string,
  dayKey: string | null,
  work: [string, number][],
  opts: { planId?: string | null } = {},
): WorkoutLog {
  const data: LogDocument = {
    sections: [
      {
        key: 'primary',
        groups: work.map(([movement, sets], i) => ({
          id: `${id}-g${i}`,
          kind: 'single',
          items: [
            {
              id: `${id}-i${i}`,
              movement,
              primaryMetric: 'reps',
              sets: Array.from({ length: sets }, () => ({
                planned: null,
                actual: { completed: true, prefilled: false },
                notations: [],
              })),
            },
          ],
        })),
      },
    ],
  };
  return {
    id,
    owner_user_id: 'u1',
    plan_id: opts.planId === undefined ? 'p1' : opts.planId,
    session_id: null,
    log_date: date,
    day_key: dayKey,
    week_number: null,
    status: 'done',
    started_at: null,
    ended_at: null,
    total_seconds: 3600,
    hr_avg: null,
    hr_max: null,
    notes: null,
    activity_type: null,
    tags: [],
    data,
    source: 'manual',
    garmin_activity_id: null,
    created_at: `${date}T10:00:00Z`,
  } as WorkoutLog;
}

const MON = { dayKey: 'mon', label: 'Monday — Lower', exercises: [ex('Back Squat', '3x5')] };
const FRI = { dayKey: 'fri', label: 'Friday — Upper', exercises: [ex('Bench Press', '3x8')] };

const run = (p: ParsedPlan, logs: WorkoutLog[]) =>
  computePlanAdherence('p1', p, logs, TODAY);

describe('computePlanAdherence', () => {
  it('returns null before the plan has been logged at all', () => {
    expect(run(plan([MON]), [])).toBeNull();
    // An in-progress session is not evidence of anything yet.
    const started = { ...log('l1', '2026-01-05', 'mon', []), status: 'in_progress' as const };
    expect(run(plan([MON]), [started])).toBeNull();
  });

  it('scores a perfectly followed week at 100', () => {
    const a = run(plan([MON]), [log('l1', '2026-01-05', 'mon', [['Back Squat', 3]])]);
    expect(a).not.toBeNull();
    expect(a!.pct).toBe(100);
    expect(a!.exactSets).toBe(3);
    expect(a!.missedSets).toBe(0);
    expect(a!.prescribedSets).toBe(3);
  });

  it('does not penalise extra sets, and does not credit them either', () => {
    // Six sets against a prescribed three: the row is met, the surplus is
    // reported separately, and the percentage stays at 100 rather than 200.
    const a = run(plan([MON]), [log('l1', '2026-01-05', 'mon', [['Back Squat', 6]])])!;
    expect(a.pct).toBe(100);
    expect(a.exactSets).toBe(3);
    expect(a.extraSets).toBe(3);
  });

  it('never lets overshoot on one movement pay for a skip on another', () => {
    // Ten sets of squat, nothing pressed. Without the per-exercise cap the
    // numerator would cover both rows and report 100%.
    const p = plan([{ dayKey: 'mon', label: 'Mon', exercises: [ex('Back Squat', '3x5'), ex('Bench Press', '3x8')] }]);
    const a = run(p, [log('l1', '2026-01-05', 'mon', [['Back Squat', 10]])])!;
    expect(a.prescribedSets).toBe(6);
    expect(a.exactSets).toBe(3);
    expect(a.missedSets).toBe(3);
    expect(a.pct).toBe(50);
  });

  it('surfaces a training day that was quietly abandoned', () => {
    // THE CASE A PER-DAY CURSOR HIDES. Monday logged four times, Friday never.
    // The denominator has to grow for Friday anyway, or dropping a whole day of
    // the week costs nothing at all.
    const a = run(plan([MON, FRI]), [
      log('l1', '2026-01-05', 'mon', [['Back Squat', 3]]),
      log('l2', '2026-01-12', 'mon', [['Back Squat', 3]]),
      log('l3', '2026-01-19', 'mon', [['Back Squat', 3]]),
      log('l4', '2026-01-26', 'mon', [['Back Squat', 3]]),
    ])!;
    expect(a.elapsedWeeks).toBe(4);
    // 12 squat sets over four weeks, plus Friday's bench for weeks 1-3 only:
    // week 4 is in flight, and its Friday has not come round yet. The
    // abandoned day still reads as abandoned — it is just never charged for
    // the week currently in progress.
    expect(a.prescribedSets).toBe(21);
    expect(a.exactSets).toBe(12);
    expect(a.missedSets).toBe(9);
    expect(a.pct).toBe(57);
    const fri = a.rows.find((r) => r.dayKey === 'fri')!;
    expect(fri.pct).toBe(0);
    expect(fri.missedSets).toBe(9);
  });

  it('does not charge for a week that took longer than seven days', () => {
    // Same four sessions as a clean month, just spread over nine weeks. Program
    // week is paced by logging, so this is still 100%...
    const a = run(plan([MON]), [
      log('l1', '2026-01-01', 'mon', [['Back Squat', 3]]),
      log('l2', '2026-01-15', 'mon', [['Back Squat', 3]]),
      log('l3', '2026-02-05', 'mon', [['Back Squat', 3]]),
      log('l4', '2026-02-26', 'mon', [['Back Squat', 3]]),
    ])!;
    expect(a.pct).toBe(100);
    expect(a.elapsedWeeks).toBe(4);
    // ...with the drift visible as its own number rather than inside the score.
    expect(a.calendarWeeks).toBe(9);
  });

  it('does not count the in-flight week against days not yet due', () => {
    // Monday of week 2 is logged; Friday of week 2 has not come round yet and
    // must not read as a miss on Monday evening.
    const a = run(plan([MON, FRI]), [
      log('l1', '2026-01-05', 'mon', [['Back Squat', 3]]),
      log('l2', '2026-01-09', 'fri', [['Bench Press', 3]]),
      log('l3', '2026-01-12', 'mon', [['Back Squat', 3]]),
    ])!;
    expect(a.elapsedWeeks).toBe(2);
    // Week 1: squat + bench. Week 2: squat only (Friday not logged yet).
    expect(a.prescribedSets).toBe(9);
    expect(a.pct).toBe(100);
  });

  it('counts a minor swap as following the plan', () => {
    const p = plan([{ dayKey: 'mon', label: 'Mon', exercises: [ex('Pull-up', '3x8')] }]);
    const a = run(p, [log('l1', '2026-01-05', 'mon', [['Lat Pulldown', 3]])])!;
    expect(a.pct).toBe(100);
    expect(a.swapSets).toBe(3);
    expect(a.exactSets).toBe(0);
    // Still visible as a substitution — counted, not hidden.
    expect(a.rows[0].substitutions).toEqual([
      { movement: 'Lat Pulldown', sets: 3, verdict: 'minor' },
    ]);
  });

  it('does not count a major swap', () => {
    const p = plan([{ dayKey: 'mon', label: 'Mon', exercises: [ex('Bench Press', '3x5')] }]);
    const a = run(p, [log('l1', '2026-01-05', 'mon', [['Overhead Press', 3]])])!;
    expect(a.pct).toBe(0);
    expect(a.missedSets).toBe(3);
    // The pressing you did do is surplus against this plan, not adherence.
    expect(a.extraSets).toBe(3);
  });

  it('settles exact names before spending them on a swap', () => {
    // Both prescriptions accept the other's movement as a minor swap. Crediting
    // greedily in listed order would spend the Lat Pulldown sets on the Pull-up
    // row and report Lat Pulldown — the thing actually done — as missed.
    const p = plan([
      { dayKey: 'mon', label: 'Mon', exercises: [ex('Pull-up', '3x8'), ex('Lat Pulldown', '3x10')] },
    ]);
    const a = run(p, [log('l1', '2026-01-05', 'mon', [['Lat Pulldown', 3], ['Pull-up', 3]])])!;
    expect(a.exactSets).toBe(6);
    expect(a.swapSets).toBe(0);
    expect(a.pct).toBe(100);
  });

  it('credits work made up in a later session', () => {
    // Skipped the bench on Friday, went back on Sunday and did it in an
    // off-plan session. That still counts.
    const a = run(plan([FRI]), [
      log('l1', '2026-01-09', 'fri', []),
      log('l2', '2026-01-11', null, [['Bench Press', 3]], { planId: null }),
    ])!;
    expect(a.pct).toBe(100);
    expect(a.makeUpSets).toBe(3);
    expect(a.missedSets).toBe(0);
  });

  it('does not treat an unrelated off-plan session as this plan’s overshoot', () => {
    const a = run(plan([MON]), [
      log('l1', '2026-01-05', 'mon', [['Back Squat', 3]]),
      log('l2', '2026-01-07', null, [['Bicep Curl', 4]], { planId: null }),
    ])!;
    expect(a.pct).toBe(100);
    expect(a.extraSets).toBe(0);
  });

  it('counts a mini-trimmed session as the skip it is', () => {
    // `reduceLogDocument` drops supporting work from the log document itself.
    // The old tile lost those sets from its own denominator and stayed at 100.
    const p = plan([
      { dayKey: 'mon', label: 'Mon', exercises: [ex('Back Squat', '3x5'), ex('Leg Press', '3x12')] },
    ]);
    const a = run(p, [log('l1', '2026-01-05', 'mon', [['Back Squat', 3]])])!;
    expect(a.prescribedSets).toBe(6);
    expect(a.pct).toBe(50);
  });

  it('ignores unticked sets', () => {
    const doc = log('l1', '2026-01-05', 'mon', [['Back Squat', 3]]);
    doc.data.sections[0].groups[0].items[0].sets[2].actual.completed = false;
    const a = run(plan([MON]), [doc])!;
    expect(a.exactSets).toBe(2);
    expect(a.missedSets).toBe(1);
  });

  it('excludes subroutines from the prescription', () => {
    const p = plan([
      {
        dayKey: 'mon',
        label: 'Mon',
        exercises: [
          ex('Back Squat', '3x5'),
          {
            movement: 'Read this first',
            section: 'primary',
            primaryMetric: 'reps',
            plannedByWeek: {},
            kind: 'subroutine',
            description: 'Warm up properly.',
          },
        ],
      },
    ]);
    const a = run(p, [log('l1', '2026-01-05', 'mon', [['Back Squat', 3]])])!;
    expect(a.prescribedSets).toBe(3);
    expect(a.rows).toHaveLength(1);
  });

  it('only counts weeks the plan actually programmes', () => {
    // A movement dropped after week 2 is not owed in weeks 3 and 4.
    const p = plan([
      { dayKey: 'mon', label: 'Mon', exercises: [ex('Back Squat', '3x5'), ex('Leg Press', '3x12', [1, 2])] },
    ]);
    const a = run(p, [
      log('l1', '2026-01-05', 'mon', [['Back Squat', 3], ['Leg Press', 3]]),
      log('l2', '2026-01-12', 'mon', [['Back Squat', 3], ['Leg Press', 3]]),
      log('l3', '2026-01-19', 'mon', [['Back Squat', 3]]),
    ])!;
    expect(a.prescribedSets).toBe(15);
    expect(a.pct).toBe(100);
  });

  it('ranks the rows worst-first', () => {
    const p = plan([
      { dayKey: 'mon', label: 'Mon', exercises: [ex('Back Squat', '3x5'), ex('Bench Press', '3x8')] },
    ]);
    const a = run(p, [log('l1', '2026-01-05', 'mon', [['Back Squat', 3]])])!;
    expect(a.rows.map((r) => r.movement)).toEqual(['Bench Press', 'Back Squat']);
    expect(a.rows.map((r) => r.pct)).toEqual([0, 100]);
  });

  it('ignores logs belonging to another plan', () => {
    const other = log('l2', '2026-01-06', 'mon', [['Back Squat', 3]], { planId: 'p2' });
    const a = run(plan([MON]), [log('l1', '2026-01-05', 'mon', [['Back Squat', 3]]), other])!;
    expect(a.exactSets).toBe(3);
    expect(a.extraSets).toBe(0);
  });
});
