import { describe, expect, it } from 'vitest';
import {
  buildReview,
  effortHeadline,
  frequencyHeadline,
  QUARTER_DAYS,
  reviewWindow,
  staplesHeadline,
  volumeHeadline,
} from '@/lib/review';
import type { LogDocument, ParsedPlan, Plan, UserStats, WorkoutLog } from '@/lib/types';

const TODAY = new Date('2026-09-27T12:00:00Z');

type SetSpec = { weight?: number; reps?: number; rpe?: number };

function log(
  id: string,
  date: string,
  work: [string, SetSpec[]][],
  opts: Partial<Pick<WorkoutLog, 'plan_id' | 'day_key' | 'tags' | 'activity_type' | 'status' | 'total_seconds'>> = {},
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
              sets: sets.map((s) => ({
                planned: null,
                actual: { ...s, completed: true, prefilled: false },
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
    plan_id: opts.plan_id ?? null,
    session_id: null,
    log_date: `${date}T10:00:00Z`,
    day_key: opts.day_key ?? null,
    week_number: null,
    status: opts.status ?? 'done',
    started_at: null,
    ended_at: null,
    total_seconds: opts.total_seconds ?? 3600,
    hr_avg: null,
    hr_max: null,
    notes: null,
    activity_type: opts.activity_type ?? null,
    tags: opts.tags ?? [],
    data,
    source: 'manual',
    garmin_activity_id: null,
    created_at: `${date}T10:00:00Z`,
  };
}

const parsed: ParsedPlan = {
  title: 'Block',
  startDate: '2026-08-03',
  endDate: null,
  blocks: [{ type: 'accumulation', startWeek: 1, endWeek: 4 }],
  weeklyTemplate: ['a', 'b'],
  days: [
    { dayKey: 'a', label: 'Squat', exercises: [{ movement: 'Back Squat', section: 'primary', primaryMetric: 'reps', plannedByWeek: { 1: '3x5' } }] },
    { dayKey: 'b', label: 'Press', exercises: [{ movement: 'Bench Press', section: 'primary', primaryMetric: 'reps', plannedByWeek: { 1: '3x5' } }] },
  ],
};

function plan(id: string, active: boolean, start = '2026-08-03'): Plan {
  return {
    id,
    owner_user_id: 'u1',
    name: `Plan ${id}`,
    start_date: start,
    end_date: null,
    source_markdown: null,
    parsed,
    is_active: active,
    is_public: false,
    created_at: `${start}T00:00:00Z`,
  };
}

const squat = (w: number, rpe = 7): [string, SetSpec[]] => ['Back Squat', [{ weight: w, reps: 5, rpe }, { weight: w, reps: 5, rpe: rpe + 1 }]];

describe('reviewWindow', () => {
  const logs = [
    log('l1', '2026-04-20', [squat(80)]),
    log('l2', '2026-08-04', [squat(90)], { plan_id: 'p1', day_key: 'a' }),
    log('l3', '2026-08-20', [squat(95)], { plan_id: 'p1', day_key: 'a' }),
    log('l4', '2026-09-01', [squat(95)], { status: 'in_progress' }),
  ];
  const plans = [plan('p1', false), plan('p2', true, '2026-09-10')];

  it('all time runs from the first finished session to today', () => {
    const w = reviewWindow({ kind: 'all' }, logs, plans, TODAY)!;
    expect([w.start, w.end]).toEqual(['2026-04-20', '2026-09-27']);
  });

  it('the last quarter is thirteen whole weeks ending today', () => {
    const w = reviewWindow({ kind: 'quarter' }, logs, plans, TODAY)!;
    expect(w.days).toBe(QUARTER_DAYS);
    expect(w.end).toBe('2026-09-27');
  });

  it('a finished plan runs from its first to its last logged session', () => {
    const w = reviewWindow({ kind: 'plan', planId: 'p1' }, logs, plans, TODAY)!;
    expect([w.start, w.end, w.label]).toEqual(['2026-08-04', '2026-08-20', 'Plan p1']);
  });

  it('an active plan with no logs yet runs from its start date to today', () => {
    const w = reviewWindow({ kind: 'plan', planId: 'p2' }, logs, plans, TODAY)!;
    expect([w.start, w.end]).toEqual(['2026-09-10', '2026-09-27']);
  });

  it('is null when there is nothing to review', () => {
    expect(reviewWindow({ kind: 'all' }, [], [], TODAY)).toBeNull();
    expect(reviewWindow({ kind: 'plan', planId: 'nope' }, logs, plans, TODAY)).toBeNull();
  });
});

describe('buildReview', () => {
  const stats = {
    goals: [
      { id: 'mobility', label: 'Mobility', weight: 75 },
      { id: 'strength', label: 'Strength', weight: 35 },
      { id: 'x-1', label: 'Athleticism', weight: 60 },
    ],
  } as UserStats;
  const logs = [
    log('a1', '2026-08-04', [squat(90, 7)], { plan_id: 'p1', day_key: 'a', tags: ['strength'] }),
    log('a2', '2026-08-11', [squat(90, 8)], { plan_id: 'p1', day_key: 'a', tags: ['strength'] }),
    log('a3', '2026-08-18', [squat(95, 8)], { plan_id: 'p1', day_key: 'a', tags: ['strength'] }),
    log('b1', '2026-08-05', [['Bench Press', [{ weight: 60, reps: 8, rpe: 7 }, { weight: 60, reps: 8, rpe: 7 }]]], {
      plan_id: 'p1',
      day_key: 'b',
    }),
    log('y1', '2026-08-06', [['Yoga', [{}]]], { activity_type: 'Yoga', tags: ['mobility'] }),
  ];
  const review = buildReview({ kind: 'plan', planId: 'p1' }, { logs, plans: [plan('p1', false)], stats, today: TODAY })!;

  it('counts sessions, active days and the plan it measures against', () => {
    expect(review.sessions).toBe(5);
    expect(review.activeDays).toBe(5);
    expect(review.plannedLiftsPerWeek).toBe(2);
    expect(frequencyHeadline(review)).toMatch(/against a 2-day plan/);
  });

  it('lays the calendar out in Monday weeks, marking each session with a letter', () => {
    expect(review.calendar[0].start).toBe('2026-08-03');
    const aug4 = review.calendar[0].days[1];
    expect(aug4.date).toBe('2026-08-04');
    expect(aug4.marks).toEqual(['S']);
    expect(aug4.title).toMatch(/Squat/);
    expect(review.calendar[0].days[0].inWindow).toBe(false);
  });

  it('names goals it cannot measure instead of scoring them zero', () => {
    expect(review.goals.map((g) => g.id)).toEqual(['mobility', 'strength']);
    expect(review.unmeasuredGoals).toEqual(['Athleticism']);
  });

  it('leaves sessions that never moved the RPE dial out of the effort share', () => {
    // b1 is all 7s: unrated. a1..a3 each carry a 7 and an 8, a2/a3 an 8 and a 9.
    expect(review.effort.unratedSessions).toBe(1);
    expect(review.effort.ratedSessions).toBe(3);
    expect(review.effort.byGroup.map((g) => g.label)).toEqual(['Squat']);
    expect(effortHeadline(review)).toBe(`${Math.round((5 / 6) * 100)}% of rated sets at RPE 8+`);
  });

  it('tracks a staple lift from its first session to its latest, on estimated 1RM', () => {
    expect(review.staples).toHaveLength(1);
    const sq = review.staples[0];
    expect(sq).toMatchObject({ movement: 'Back Squat', variant: false, sessions: 3, rpeAdjusted: true });
    expect([sq.first.weight, sq.last.weight]).toEqual([90, 95]);
    expect(sq.change).toBeGreaterThan(0);
    expect(staplesHeadline(review)).toBe('Every staple lift moved up');
  });

  it('states the muscles under the set floor', () => {
    expect(volumeHeadline(review)).toBe('No muscle group reaches 10 hard sets a week');
    const regionSets = review.regionSets.map((g, i) => ({ ...g, perWeek: i < 7 ? 12 : 4 }));
    expect(volumeHeadline({ ...review, regionSets })).toBe(
      `${regionSets[7].label} and ${regionSets[8].label} sit under 10 hard sets a week`,
    );
  });

  it('carries plan adherence only for a plan period', () => {
    expect(review.adherence).not.toBeNull();
    // Aug 4 → Aug 18 is the plan's life; today (late September) is not.
    expect(review.adherence!.calendarWeeks).toBeLessThanOrEqual(3);
    const all = buildReview({ kind: 'all' }, { logs, plans: [plan('p1', false)], stats, today: TODAY })!;
    expect(all.adherence).toBeNull();
  });
});

describe('staple lifts — like with like', () => {
  const stats = { goals: [] } as unknown as UserStats;
  const staples = (logs: WorkoutLog[]) => buildReview({ kind: 'all' }, { logs, plans: [], stats, today: TODAY })!.staples;
  // Two sets per session so a session can be rated (see rpeWasRated).
  const s2 = (w: number, reps: number, rpe: number, rpe2 = rpe): SetSpec[] => [
    { weight: w, reps, rpe },
    { weight: w, reps, rpe: rpe2 },
  ];
  const tagged = (l: WorkoutLog, tag: string) => {
    for (const set of l.data.sections[0].groups[0].items[0].sets) set.notations = [tag];
    return l;
  };

  it('does not read identical sets as progress when only the latest session was rated', () => {
    const [s] = staples([
      log('i1', '2026-07-14', [['Incline DB Bench', s2(27.5, 12, 7)]]), // all 7s: unrated
      log('i2', '2026-08-19', [['Incline DB Bench', s2(27.5, 12, 7)]]),
      log('i3', '2026-09-24', [['Incline DB Bench', s2(27.5, 12, 8, 9)]]),
    ]);
    expect(s.rpeAdjusted).toBe(false);
    expect(s.change).toBe(0);
  });

  it('counts reps-in-reserve when both ends were rated: same load at a lower RPE is progress', () => {
    const [s] = staples([
      log('b1', '2026-05-18', [['Back Squat', s2(100, 5, 9, 8)]]),
      log('b2', '2026-06-01', [['Back Squat', s2(100, 5, 9, 8)]]),
      log('b3', '2026-06-15', [['Back Squat', s2(100, 5, 8, 7)]]),
    ]);
    expect(s.rpeAdjusted).toBe(true);
    expect(s.change).toBeGreaterThan(0.02);
  });

  it('credits a tempo set, and counts reps: 90×12 → 82.5×15 (t) is up, not down 7.5 kg', () => {
    const [s] = staples([
      log('c1', '2026-05-08', [['Leg Curl', s2(90, 12, 7)]]),
      log('c2', '2026-07-13', [['Leg Curl', s2(90, 12, 7)]]),
      tagged(log('c3', '2026-09-22', [['Leg Curl', s2(82.5, 15, 7)]]), '(t)'),
    ]);
    expect(s.last.held).not.toBeNull();
    expect(s.change).toBeGreaterThan(0.1);
  });

  it('keeps a variation on its own track instead of pricing it against the plain lift', () => {
    const tracks = staples([
      log('p1', '2026-05-08', [['Back Squat', s2(85, 5, 7)]]),
      log('p2', '2026-05-18', [['Back Squat', s2(100, 5, 7)]]),
      log('p3', '2026-07-27', [['Back Squat', s2(60, 8, 7)]]),
      tagged(log('v1', '2026-08-07', [['Back Squat', s2(90, 6, 7)]]), '(v)'),
      tagged(log('v2', '2026-08-18', [['Back Squat', s2(100, 5, 7)]]), '(v)'),
      tagged(log('v3', '2026-09-02', [['Back Squat', s2(90, 5, 7)]]), '(v)'),
    ]);
    const variant = tracks.find((t) => t.variant)!;
    expect(tracks).toHaveLength(2);
    expect([variant.since, variant.sessions, variant.first.weight]).toEqual(['2026-08-07', 3, 90]);
  });

  it('reads the bare p / t / v spellings older logs carry', () => {
    const [s] = staples([
      log('t1', '2026-05-04', [['Hip Thrust Machine', s2(80, 12, 7)]]),
      log('t2', '2026-05-18', [['Hip Thrust Machine', s2(80, 12, 7)]]),
      tagged(log('t3', '2026-06-01', [['Hip Thrust Machine', s2(80, 12, 7)]]), 't'),
    ]);
    expect(s.last.held).not.toBeNull();
    expect(s.change).toBeCloseTo(0.1, 5);
  });

  it('compares isometric band work on reps, not on the number on the stack', () => {
    const [s] = staples([
      log('f1', '2026-04-23', [['Pallof Press', s2(2, 12, 7)]]),
      log('f2', '2026-07-19', [['Pallof Press', s2(2, 12, 7)]]),
      log('f3', '2026-09-25', [['Pallof Press', s2(5, 12, 7)]]),
    ]);
    expect(s.measure).toBe('reps');
    expect(s.change).toBe(0);
  });

  it('says nothing about a lift done for too many reps to estimate', () => {
    const [s] = staples([
      log('k1', '2026-07-01', [['KB Swing', s2(20, 25, 7)]]),
      log('k2', '2026-08-01', [['KB Swing', s2(20, 25, 7)]]),
      log('k3', '2026-09-01', [['KB Swing', s2(24, 25, 7)]]),
    ]);
    expect(s.change).toBeNull();
  });
});
