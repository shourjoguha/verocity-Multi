import { describe, expect, it } from 'vitest';
import { measureLoadSteps, parseLoadStep, parseRepRange } from '@/lib/coach/loadStep';
import { loadStepDue } from '@/lib/coach/rules/progression';
import { RULE_IMPACT } from '@/lib/coach/impact';
import { themeOf } from '@/lib/coach/themes';
import type { LogSet, Plan, PlanExercise, UserStats, WorkoutLog } from '@/lib/types';

const RULE = 'training.progression.load-step-due';
const TODAY = new Date('2026-10-20T12:00:00Z');

const ranged = (over: Partial<PlanExercise> = {}): PlanExercise => ({
  movement: 'Incline DB Bench',
  section: 'primary',
  primaryMetric: 'reps',
  plannedByWeek: { 1: '4x8 @30kg RPE8', 2: '4x8-12 RPE8', 3: '4x8-12 RPE8', 4: '4x8-12 RPE8', 5: '2x8 RPE6' },
  notesByWeek: {
    2: 'Hold load; add reps until all 4 sets hit 12 at RPE 8 or less, then +2.5 kg per dumbbell and restart at 8.',
  },
  ...over,
});

const plan = (exercises: PlanExercise[]): Plan =>
  ({
    id: 'p1',
    parsed: {
      title: 't',
      startDate: null,
      endDate: null,
      weeklyTemplate: ['day-b'],
      blocks: [
        { type: 'accumulation', startWeek: 1, endWeek: 4 },
        { type: 'deload', startWeek: 5, endWeek: 5 },
        { type: 'intensification', startWeek: 6, endWeek: 8 },
      ],
      days: [{ dayKey: 'day-b', label: 'B', exercises }],
    },
  }) as unknown as Plan;

const sets = (n: number, weight: number, reps: number, rpe = 8): LogSet[] =>
  Array.from({ length: n }, () => ({
    planned: null,
    notations: [],
    actual: { weight, reps, rpe, completed: true, prefilled: false },
  }));

let seq = 0;
const log = (date: string, movement: string, s: LogSet[]): WorkoutLog =>
  ({
    id: `l${++seq}`,
    plan_id: 'p1',
    day_key: 'day-b',
    status: 'done',
    log_date: date,
    created_at: `${date}T10:00:00Z`,
    data: { sections: [{ key: 'primary', groups: [{ id: 'g', kind: 'single', items: [{ id: 'i', movement, primaryMetric: 'reps', sets: s }] }] }] },
  }) as unknown as WorkoutLog;

const stats = { goals: [{ id: 'strength', label: 'Strength', weight: 35 }] } as unknown as UserStats;

describe('parseRepRange', () => {
  it('reads count, range and RPE cap', () => {
    expect(parseRepRange('5x3-5 RPE8')).toEqual({ sets: 5, low: 3, high: 5, rpeCap: 8 });
    expect(parseRepRange('3x8-12/side RPE7.5')).toEqual({ sets: 3, low: 8, high: 12, rpeCap: 7.5 });
  });

  it('is null for a flat prescription', () => {
    expect(parseRepRange('8x20 RPE8')).toBeNull();
    expect(parseRepRange('4x10 @45kg RPE8')).toBeNull();
    expect(parseRepRange('3x5-5')).toBeNull();
  });
});

describe('parseLoadStep', () => {
  it("lifts the plan's own wording for the step", () => {
    expect(parseLoadStep('Hold load; add reps until all 5 sets hit 5 at RPE 8 or less, then +5 kg and restart at 3.')).toBe('+5 kg');
    expect(parseLoadStep('Deload · easy')).toBeNull();
  });
});

describe('measureLoadSteps', () => {
  it('marks a topped range as due', () => {
    const m = measureLoadSteps([log('2026-10-07', 'Incline DB Bench', sets(4, 30, 12, 8))], plan([ranged()]), TODAY);
    expect(m.value.entries).toHaveLength(1);
    expect(m.value.entries[0].state).toBe('due');
    expect(m.value.entries[0].step).toBe('+2.5 kg per dumbbell');
  });

  it('is quiet while reps are still climbing', () => {
    const m = measureLoadSteps([log('2026-10-07', 'Incline DB Bench', sets(4, 30, 10, 8))], plan([ranged()]), TODAY);
    expect(m.value.entries).toEqual([]);
    expect(m.value.tracked).toBe(1);
  });

  it('does not count a top-of-range set above the effort cap', () => {
    const m = measureLoadSteps([log('2026-10-07', 'Incline DB Bench', sets(4, 30, 12, 9))], plan([ranged()]), TODAY);
    expect(m.value.entries).toEqual([]);
  });

  it('needs every prescribed set', () => {
    const m = measureLoadSteps([log('2026-10-07', 'Incline DB Bench', sets(3, 30, 12, 8))], plan([ranged()]), TODAY);
    expect(m.value.entries).toEqual([]);
  });

  it('marks a held load at the top of the range as missed', () => {
    const m = measureLoadSteps(
      [log('2026-10-07', 'Incline DB Bench', sets(4, 30, 12)), log('2026-10-14', 'Incline DB Bench', sets(4, 30, 12))],
      plan([ranged()]),
      TODAY,
    );
    expect(m.value.entries[0].state).toBe('missed');
  });

  it('accepts the step once taken', () => {
    const m = measureLoadSteps(
      [log('2026-10-07', 'Incline DB Bench', sets(4, 30, 12)), log('2026-10-14', 'Incline DB Bench', sets(4, 32.5, 8))],
      plan([ranged()]),
      TODAY,
    );
    expect(m.value.entries).toEqual([]);
  });

  it('reads a rep drop at the same load as a harder variant, not a miss', () => {
    const m = measureLoadSteps(
      [log('2026-10-07', 'Ab Wheel Rollout', sets(3, 0, 15)), log('2026-10-14', 'Ab Wheel Rollout', sets(3, 0, 10))],
      plan([ranged({ movement: 'Ab Wheel Rollout', plannedByWeek: { 1: '3x10-15 RPE8', 2: '3x10-15 RPE8', 3: '3x10-15 RPE8' } })]),
      TODAY,
    );
    expect(m.value.entries).toEqual([]);
  });

  it('skips deload sessions entirely', () => {
    // Weeks come from logged order: sessions 1-4 build, 5 is the deload, 6 resumes.
    const logs = [
      log('2026-09-01', 'Incline DB Bench', sets(4, 30, 9)),
      log('2026-09-08', 'Incline DB Bench', sets(4, 30, 10)),
      log('2026-09-15', 'Incline DB Bench', sets(4, 30, 11)),
      log('2026-09-22', 'Incline DB Bench', sets(4, 30, 12)),
      log('2026-09-29', 'Incline DB Bench', sets(2, 25, 8, 6)),
      log('2026-10-06', 'Incline DB Bench', sets(4, 32.5, 8)),
    ];
    const ex = ranged({
      plannedByWeek: { 1: '4x8-12 RPE8', 2: '4x8-12 RPE8', 3: '4x8-12 RPE8', 4: '4x8-12 RPE8', 5: '2x8 RPE6', 6: '4x8-12 RPE8' },
    });
    expect(measureLoadSteps(logs, plan([ex]), TODAY).value.entries).toEqual([]);
  });

  it('ignores lifts with no range', () => {
    const sled = ranged({ movement: 'Sled Push', plannedByWeek: { 1: '8x20 RPE8', 2: '8x20 RPE8' } });
    const m = measureLoadSteps([log('2026-10-07', 'Sled Push', sets(10, 115, 20, 7))], plan([sled]), TODAY);
    expect(m.sufficiency).toBe('insufficient');
  });

  it('ignores a timed hold written as a range of seconds', () => {
    const hold = ranged({ movement: 'Copenhagen Plank', primaryMetric: 'time', plannedByWeek: { 1: '3x20-30/side RPE8' } });
    expect(measureLoadSteps([log('2026-10-07', 'Copenhagen Plank', sets(3, 0, 8))], plan([hold]), TODAY).sufficiency).toBe('insufficient');
  });

  it('is insufficient without a plan', () => {
    expect(measureLoadSteps([], null, TODAY).sufficiency).toBe('insufficient');
  });
});

describe('loadStepDue', () => {
  const measured = (logs: WorkoutLog[]) => measureLoadSteps(logs, plan([ranged()]), TODAY);

  it('speaks when a step is due, citing the plan step', () => {
    const f = loadStepDue(measured([log('2026-10-07', 'Incline DB Bench', sets(4, 30, 12))]), stats, '2026-W43');
    expect(f?.ruleId).toBe(RULE);
    expect(f?.tldr.length).toBeLessThanOrEqual(60);
    expect(f?.body).toContain('+2.5 kg per dumbbell');
    expect(f?.claims.length).toBe(2);
  });

  it('stays quiet when neither strength nor hypertrophy is a goal', () => {
    const none = { goals: [{ id: 'endurance', label: 'Endurance', weight: 70 }] } as unknown as UserStats;
    expect(loadStepDue(measured([log('2026-10-07', 'Incline DB Bench', sets(4, 30, 12))]), none, 'k')).toBeNull();
  });

  it('is weighted and themed like every other rule', () => {
    expect(RULE_IMPACT[RULE]).toBeGreaterThan(0);
    expect(themeOf(RULE)?.key).toBe('stimulus');
  });
});
