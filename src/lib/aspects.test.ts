import { describe, expect, it } from 'vitest';
import { ASPECT_ABSOLUTE_ANCHORS, ASPECT_MIN_BASELINE, ASPECT_SCALE, ASPECT_WINDOW_DAYS } from '@/app.config';
import {
  applyAssessmentOverride,
  aspectWindows,
  buildBaselines,
  buildSnapshots,
  completedMonthEnds,
  computeAspectMetrics,
  daysBetween,
  logsInWindow,
  scoreAgainstBaseline,
  scoreAspects,
  windowEndingOn,
} from '@/lib/aspects';
import type { FitnessAssessment, VibeCheck, WorkoutLog } from '@/lib/types';

const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const spanDays = (a: string, b: string) =>
  Math.round((day(b).getTime() - day(a).getTime()) / 86_400_000) + 1; // inclusive

// These pin the rolling behaviour, which is the whole point of the change: the
// radar's legend read a fixed "Jun 21 (now)" for weeks because nothing tied the
// window to the day being rendered.
describe('aspectWindows', () => {
  it('ends the current window on the given day', () => {
    expect(aspectWindows(day('2026-07-30')).current.end).toBe('2026-07-30');
  });

  it('spans exactly ASPECT_WINDOW_DAYS, inclusive', () => {
    const { current, prior } = aspectWindows(day('2026-07-30'));
    expect(spanDays(current.start, current.end)).toBe(ASPECT_WINDOW_DAYS);
    expect(spanDays(prior.start, prior.end)).toBe(ASPECT_WINDOW_DAYS);
  });

  it('places prior immediately before current, with no overlap or gap', () => {
    const { current, prior } = aspectWindows(day('2026-07-30'));
    expect(prior.end < current.start).toBe(true);
    expect(spanDays(prior.end, current.start)).toBe(2); // adjacent days
  });

  it('moves with the day it is given', () => {
    const a = aspectWindows(day('2026-07-30'));
    const b = aspectWindows(day('2026-07-31'));
    expect(b.current.end).not.toBe(a.current.end);
    expect(b.current.start).not.toBe(a.current.start);
    expect(b.prior.start).not.toBe(a.prior.start);
  });

  it('crosses month boundaries and a 28-day February', () => {
    const { current } = aspectWindows(day('2026-03-01'), 60);
    expect(current.start).toBe('2026-01-01');
    expect(current.end).toBe('2026-03-01');
  });

  it('crosses a year boundary', () => {
    const { current, prior } = aspectWindows(day('2026-01-15'), 30);
    expect(current.start).toBe('2025-12-17');
    expect(prior.start).toBe('2025-11-17');
    expect(prior.end).toBe('2025-12-16');
  });

  it('honours an explicit window length', () => {
    const { current } = aspectWindows(day('2026-07-30'), 7);
    expect(current.start).toBe('2026-07-24');
    expect(spanDays(current.start, current.end)).toBe(7);
  });
});

describe('logsInWindow', () => {
  const log = (log_date: string) => ({ log_date }) as WorkoutLog;

  it('includes both bounds and excludes outside', () => {
    const w = { start: '2026-06-01', end: '2026-06-30' };
    const kept = logsInWindow(
      [log('2026-05-31'), log('2026-06-01'), log('2026-06-15'), log('2026-06-30'), log('2026-07-01')],
      w,
    );
    expect(kept.map((l) => l.log_date)).toEqual(['2026-06-01', '2026-06-15', '2026-06-30']);
  });

  it('tolerates a timestamp-shaped log_date', () => {
    const w = { start: '2026-06-01', end: '2026-06-30' };
    expect(logsInWindow([log('2026-06-15T09:30:00Z')], w)).toHaveLength(1);
  });

  it('splits a fetched range into two disjoint blocks that lose nothing', () => {
    const { current, prior } = aspectWindows(day('2026-07-30'));
    const all = [prior.start, prior.end, current.start, current.end].map(log);
    const a = logsInWindow(all, prior);
    const b = logsInWindow(all, current);
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    expect(a.length + b.length).toBe(all.length);
  });
});

describe('windowEndingOn / daysBetween', () => {
  it('builds an inclusive window of the requested length', () => {
    expect(windowEndingOn('2026-07-30', 7)).toEqual({ start: '2026-07-24', end: '2026-07-30' });
  });

  it('counts whole days, signed', () => {
    expect(daysBetween('2026-07-24', '2026-07-30')).toBe(6);
    expect(daysBetween('2026-07-30', '2026-07-24')).toBe(-6);
    expect(daysBetween('2026-07-30T09:00:00Z', '2026-07-30')).toBe(0);
  });
});

// ---- fixtures ----
//
// Every fixture below sits mid-scale and is then perturbed on ONE input, per the
// lesson in docs/LESSONS.md: a fixture that starts saturated cannot show a score
// changing, so a passing assertion against it proves nothing. These assert on
// the raw metrics (unbounded) rather than the scores wherever the question is
// "does this input move this axis", which keeps the ceiling out of it entirely.

type SetSpec = {
  weight?: number;
  reps?: number;
  time?: number;
  distance?: number;
  completed?: boolean;
};
type ItemSpec = { movement: string; metric?: string; section?: string; sets: SetSpec[] };
type LogOpts = { hr_avg?: number; hr_max?: number; vibe?: VibeCheck; status?: string };

let seq = 0;
function log(date: string, items: ItemSpec[], opts: LogOpts = {}): WorkoutLog {
  seq += 1;
  return {
    id: `log-${seq}`,
    log_date: date,
    status: opts.status ?? 'done',
    hr_avg: opts.hr_avg ?? null,
    hr_max: opts.hr_max ?? null,
    data: {
      sections: items.map((it, i) => ({
        key: it.section ?? 'primary',
        groups: [
          {
            id: `g${i}`,
            kind: 'single',
            items: [
              {
                id: `i${i}`,
                movement: it.movement,
                primaryMetric: it.metric ?? 'weight',
                sets: it.sets.map((s) => ({
                  planned: null,
                  notations: [],
                  actual: {
                    weight: s.weight,
                    reps: s.reps,
                    time: s.time,
                    distance: s.distance,
                    completed: s.completed ?? true,
                    prefilled: false,
                  },
                })),
              },
            ],
          },
        ],
      })),
      ...(opts.vibe ? { session: { vibe: opts.vibe } } : {}),
    },
  } as unknown as WorkoutLog;
}

const END = '2026-07-30';
const metrics = (logs: WorkoutLog[]) => computeAspectMetrics(logs, { end: END });

const squatSets = (n: number, weight = 100) =>
  Array.from({ length: n }, () => ({ weight, reps: 5 }));

describe('computeAspectMetrics', () => {
  it('measures nothing without a completed session', () => {
    expect(metrics([])).toEqual({});
    expect(metrics([log('2026-07-20', [{ movement: 'Back Squat', sets: squatSets(3) }], { status: 'in_progress' })])).toEqual({});
  });

  it('reports a genuine zero rather than omitting the axis', () => {
    // Strength-only window: no plyometric work happened. That is a measurement,
    // and it has to be distinguishable from "we could not tell".
    const m = metrics([log('2026-07-20', [{ movement: 'Back Squat', sets: squatSets(4) }])]);
    expect(m.power).toBe(0);
    expect(m.mobility).toBe(0);
    expect(m.strength).toBeGreaterThan(0);
  });

  it('strength rises with load', () => {
    const light = metrics([log('2026-07-20', [{ movement: 'Back Squat', sets: squatSets(4, 100) }])]);
    const heavy = metrics([log('2026-07-20', [{ movement: 'Back Squat', sets: squatSets(4, 110) }])]);
    expect(heavy.strength!).toBeGreaterThan(light.strength!);
  });

  it('swapping the main lift does not crater strength', () => {
    // The old model took a GLOBAL max e1RM per half-window, so dropping a lift
    // read as a strength collapse. Weighting per movement means the lift you
    // stopped doing simply stops contributing.
    const allSquat = metrics([log('2026-07-20', [{ movement: 'Back Squat', sets: squatSets(6, 100) }])]);
    const swapped = metrics([
      log('2026-07-20', [
        { movement: 'Back Squat', sets: squatSets(3, 100) },
        { movement: 'Front Squat', sets: squatSets(3, 90) },
      ]),
    ]);
    expect(swapped.strength!).toBeGreaterThan(allSquat.strength! * 0.9);
  });

  it('endurance weights aerobic minutes by heart rate', () => {
    const hard = metrics([
      log('2026-07-20', [{ movement: 'Rower Interval', metric: 'time', sets: [{ time: 1800 }] }], { hr_avg: 170, hr_max: 180 }),
    ]);
    const easy = metrics([
      log('2026-07-20', [{ movement: 'Rower Interval', metric: 'time', sets: [{ time: 1800 }] }], { hr_avg: 120, hr_max: 180 }),
    ]);
    expect(hard.endurance!).toBeGreaterThan(easy.endurance!);
  });

  it('endurance rises with aerobic volume', () => {
    const short = metrics([
      log('2026-07-20', [{ movement: 'Rower Interval', metric: 'time', sets: [{ time: 900 }] }], { hr_avg: 150, hr_max: 180 }),
    ]);
    const long = metrics([
      log('2026-07-20', [{ movement: 'Rower Interval', metric: 'time', sets: [{ time: 2700 }] }], { hr_avg: 150, hr_max: 180 }),
    ]);
    expect(long.endurance!).toBeGreaterThan(short.endurance!);
  });

  it('power rises with plyometric minutes', () => {
    const some = metrics([log('2026-07-20', [{ movement: 'Box Jump', metric: 'reps', sets: [{ reps: 5 }, { reps: 5 }] }])]);
    const more = metrics([
      log('2026-07-20', [{ movement: 'Box Jump', metric: 'reps', sets: [{ reps: 5 }, { reps: 5 }, { reps: 5 }, { reps: 5 }] }]),
    ]);
    expect(some.power!).toBeGreaterThan(0);
    expect(more.power!).toBeGreaterThan(some.power!);
  });

  it('mobility rewards working outside the sagittal plane', () => {
    const sagittal = metrics([
      log('2026-07-20', [{ movement: 'Couch Stretch', metric: 'time', sets: [{ time: 600 }] }]),
    ]);
    const varied = metrics([
      log('2026-07-20', [{ movement: 'Hip Mobility Flow', metric: 'time', sets: [{ time: 600 }] }]),
    ]);
    expect(varied.mobility!).toBeGreaterThan(sagittal.mobility!);
  });

  it('consistency counts showing up, not just finishing', () => {
    // One immaculate session scored a perfect adherence ratio under the old
    // model. Three days of the same work must beat it.
    const once = metrics([log('2026-07-20', [{ movement: 'Back Squat', sets: squatSets(4) }])]);
    const thrice = metrics([
      log('2026-07-20', [{ movement: 'Back Squat', sets: squatSets(4) }]),
      log('2026-07-22', [{ movement: 'Back Squat', sets: squatSets(4) }]),
      log('2026-07-24', [{ movement: 'Back Squat', sets: squatSets(4) }]),
    ]);
    expect(thrice.consistency!).toBeGreaterThan(once.consistency!);
  });

  it('consistency falls when sets go unfinished', () => {
    const full = metrics([log('2026-07-20', [{ movement: 'Back Squat', sets: squatSets(4) }])]);
    const partial = metrics([
      log('2026-07-20', [
        {
          movement: 'Back Squat',
          sets: [
            { weight: 100, reps: 5 },
            { weight: 100, reps: 5 },
            { weight: 100, reps: 5, completed: false },
            { weight: 100, reps: 5, completed: false },
          ],
        },
      ]),
    ]);
    expect(partial.consistency!).toBeLessThan(full.consistency!);
  });

  it('recovery rises with a better vibe check', () => {
    const rough = metrics([
      log('2026-07-20', [{ movement: 'Back Squat', sets: squatSets(4) }], { vibe: { sleep: 2, energy: 2, soreness: 4 } }),
    ]);
    const rested = metrics([
      log('2026-07-20', [{ movement: 'Back Squat', sets: squatSets(4) }], { vibe: { sleep: 5, energy: 5, soreness: 1 } }),
    ]);
    expect(rested.recovery!).toBeGreaterThan(rough.recovery!);
  });

  it('recovery falls when acute load spikes above chronic', () => {
    const vibe: VibeCheck = { sleep: 4, energy: 4, soreness: 2 };
    const sets = squatSets(5);
    // Steady: the same work spread across the whole 28-day chronic window.
    const steady = metrics(
      ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'].map((d) =>
        log(d, [{ movement: 'Back Squat', sets }], { vibe }),
      ),
    );
    // Spike: identical total work, all of it crammed into the acute 7 days.
    const spike = metrics(
      ['2026-07-25', '2026-07-27', '2026-07-29', '2026-07-30'].map((d) =>
        log(d, [{ movement: 'Back Squat', sets }], { vibe }),
      ),
    );
    expect(spike.recovery!).toBeLessThan(steady.recovery!);
  });

  it('produces finite numbers on every axis it reports', () => {
    const m = metrics([
      log('2026-07-20', [{ movement: 'Back Squat', sets: squatSets(3) }], { vibe: { sleep: 3, energy: 3, soreness: 3 } }),
      log('2026-07-25', [{ movement: 'Box Jump', metric: 'reps', sets: [{ reps: 5 }] }]),
    ]);
    for (const [key, value] of Object.entries(m)) {
      expect(Number.isFinite(value), `${key} = ${value}`).toBe(true);
    }
  });
});

describe('scoreAgainstBaseline', () => {
  const baseline = [10, 20, 30, 40, 50];
  const MID = (ASPECT_SCALE.min + ASPECT_SCALE.max) / 2;

  it('puts the median of your own history exactly mid-scale', () => {
    expect(scoreAgainstBaseline(30, baseline, 999).score).toBe(MID);
  });

  it('moves in the right direction either side of the median', () => {
    expect(scoreAgainstBaseline(45, baseline, 999).score).toBeGreaterThan(MID);
    expect(scoreAgainstBaseline(15, baseline, 999).score).toBeLessThan(MID);
  });

  it('keeps responding where the old clamped model went flat', () => {
    // The failure this rework exists to fix: an absolute clamped score reached
    // ASPECT_SCALE.max at an ordinary value and stopped moving. Here the top of
    // the user's own historical range still leaves headroom, and exceeding it
    // still registers. (Scores are rounded to 1dp for display, so a genuinely
    // absurd outlier does print as 10.0 — that is the asymptote showing up in
    // the rounding, not an ordinary value hitting a ceiling.)
    const atTop = scoreAgainstBaseline(50, baseline, 999).score;
    const beyond = scoreAgainstBaseline(75, baseline, 999).score;
    expect(atTop).toBeLessThan(ASPECT_SCALE.max);
    expect(beyond).toBeGreaterThan(atTop);
  });

  it('stays inside the scale for absurd inputs', () => {
    for (const v of [1e9, -1e9, 0]) {
      const s = scoreAgainstBaseline(v, baseline, 999).score;
      expect(Number.isFinite(s), `${v}`).toBe(true);
      expect(s).toBeGreaterThanOrEqual(ASPECT_SCALE.min);
      expect(s).toBeLessThanOrEqual(ASPECT_SCALE.max);
    }
  });

  it('survives a perfectly flat history without dividing by zero', () => {
    const flat = scoreAgainstBaseline(500, [10, 10, 10, 10, 10], 999);
    expect(Number.isFinite(flat.score)).toBe(true);
    expect(flat.score).toBe(MID);
  });

  it('survives an empty and a single-sample baseline', () => {
    for (const b of [[], [42]]) {
      const r = scoreAgainstBaseline(50, b, 50);
      expect(Number.isFinite(r.score)).toBe(true);
      expect(r.confidence).toBe('low');
    }
  });

  it('falls back to the absolute anchor below the baseline threshold', () => {
    const thin = Array.from({ length: ASPECT_MIN_BASELINE - 1 }, () => 30);
    const r = scoreAgainstBaseline(80, thin, 80);
    expect(r.confidence).toBe('low');
    expect(r.score).toBe(MID); // value === anchor
  });

  it('reports ok confidence once the baseline is thick enough', () => {
    const thick = Array.from({ length: ASPECT_MIN_BASELINE }, (_, i) => 10 + i);
    expect(scoreAgainstBaseline(12, thick, 999).confidence).toBe('ok');
  });

  it('handles a zero value against a positive anchor', () => {
    const r = scoreAgainstBaseline(0, [], 10);
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(ASPECT_SCALE.min);
  });
});

describe('buildBaselines / scoreAspects', () => {
  it('collects one sample per snapshot per axis and skips gaps', () => {
    const b = buildBaselines([
      { metrics: { strength: 100, power: 4 } },
      { metrics: { strength: 110 } },
      { metrics: { strength: 120, power: 6 } },
    ]);
    expect(b.strength).toEqual([100, 110, 120]);
    expect(b.power).toEqual([4, 6]);
    expect(b.recovery).toBeUndefined();
  });

  it('scores only the axes that were measured', () => {
    const { scores, confidence } = scoreAspects({ strength: 100 }, {});
    expect(Object.keys(scores)).toEqual(['strength']);
    expect(confidence.strength).toBe('low'); // no baseline yet
    expect(scores.power).toBeUndefined();
  });

  it('uses the per-axis anchor when there is no baseline', () => {
    const { scores } = scoreAspects({ power: ASPECT_ABSOLUTE_ANCHORS.power }, {});
    expect(scores.power).toBe((ASPECT_SCALE.min + ASPECT_SCALE.max) / 2);
  });

  it('prefers your own history once it exists', () => {
    const baselines = { power: [2, 3, 4, 5, 6] };
    // 6 min/week is at the top of this user's own range but below the anchor,
    // so the relative score must read high where the absolute one reads low.
    const relative = scoreAspects({ power: 6 }, baselines).scores.power!;
    const absolute = scoreAspects({ power: 6 }, {}).scores.power!;
    expect(relative).toBeGreaterThan(absolute);
  });
});

describe('completedMonthEnds', () => {
  it('returns completed months only, oldest first', () => {
    // Mid-July: July is still in progress, so June is the newest completed month.
    expect(completedMonthEnds(day('2026-07-15'), 3)).toEqual([
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
  });

  it('still excludes the current month on its last day', () => {
    expect(completedMonthEnds(day('2026-07-31'), 1)).toEqual(['2026-06-30']);
  });

  it('crosses a year boundary and a leap February', () => {
    expect(completedMonthEnds(day('2028-04-10'), 4)).toEqual([
      '2027-12-31',
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
    ]);
  });

  it('is stable across days within the same month', () => {
    // The upsert key is (owner, period_end, window_days). A period_end that
    // drifted with the current day would mint a new row on every visit.
    expect(completedMonthEnds(day('2026-07-02'), 2)).toEqual(completedMonthEnds(day('2026-07-28'), 2));
  });
});

describe('buildSnapshots', () => {
  const ends = ['2026-05-31', '2026-06-30'];

  it('measures each period and tags it with the window it used', () => {
    const rows = buildSnapshots(
      [
        log('2026-05-20', [{ movement: 'Back Squat', sets: squatSets(4) }]),
        log('2026-06-20', [{ movement: 'Back Squat', sets: squatSets(4, 110) }]),
      ],
      ends,
    );
    expect(rows.map((r) => r.period_end)).toEqual(ends);
    expect(rows[0].window_days).toBe(ASPECT_WINDOW_DAYS);
    expect(rows[1].metrics.strength!).toBeGreaterThan(rows[0].metrics.strength!);
  });

  it('skips a period with no completed sessions', () => {
    const rows = buildSnapshots([log('2026-06-20', [{ movement: 'Back Squat', sets: squatSets(4) }])], [
      '2026-01-31',
      '2026-06-30',
    ]);
    expect(rows.map((r) => r.period_end)).toEqual(['2026-06-30']);
  });

  it('scores progressively, so later periods see the earlier ones', () => {
    // Seeded history plus the first period gives the second something to be
    // relative to; with a bare two-period call there is nothing but the anchor.
    const logs = ends.map((e, i) => log(`${e.slice(0, 7)}-15`, [{ movement: 'Back Squat', sets: squatSets(4, 100 + i * 10) }]));
    const seeded = buildSnapshots(logs, ends, {
      seed: [{ strength: 90 }, { strength: 92 }, { strength: 94 }, { strength: 96 }],
    });
    const bare = buildSnapshots(logs, ends);
    expect(seeded[1].scores.strength).not.toBe(bare[1].scores.strength);
  });

  it('produces rows that round-trip as snapshot input', () => {
    const [row] = buildSnapshots([log('2026-06-20', [{ movement: 'Back Squat', sets: squatSets(4) }])], ['2026-06-30']);
    expect(Object.keys(row).sort()).toEqual(['metrics', 'period_end', 'scores', 'window_days']);
  });
});

describe('applyAssessmentOverride', () => {
  const derived = {
    scores: { strength: 4, power: 4, recovery: 4 },
    confidence: { strength: 'low', power: 'low', recovery: 'low' },
  } as const;
  const assessment = (taken_at: string, scores: Record<string, number>): FitnessAssessment =>
    ({ id: taken_at, owner_user_id: 'u', taken_at, scores, created_at: taken_at }) as FitnessAssessment;

  it('lets a fresh check-in speak for the axes it rated', () => {
    const out = applyAssessmentOverride({ ...derived }, [assessment('2026-07-25', { strength: 9 })], END);
    expect(out.scores.strength).toBe(9);
    expect(out.scores.power).toBe(4); // unrated axis keeps the derived value
    expect(out.confidence.strength).toBe('ok');
  });

  it('stops trusting a stale check-in', () => {
    const out = applyAssessmentOverride({ ...derived }, [assessment('2026-04-25', { strength: 9 })], END);
    expect(out.scores.strength).toBe(4);
    expect(out.confidence.strength).toBe('low');
  });

  it('ignores a check-in taken after the window end', () => {
    const out = applyAssessmentOverride(
      { ...derived },
      [assessment('2026-08-20', { strength: 9 }), assessment('2026-07-28', { strength: 7 })],
      END,
    );
    expect(out.scores.strength).toBe(7);
  });

  it('does not mutate the scoring it was given', () => {
    const input = { scores: { strength: 4 }, confidence: { strength: 'low' as const } };
    applyAssessmentOverride(input, [assessment('2026-07-29', { strength: 9 })], END);
    expect(input.scores.strength).toBe(4);
  });
});
