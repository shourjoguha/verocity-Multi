import { describe, expect, it } from 'vitest';
import {
  ASPECT_GOOD_BASELINE,
  ASPECT_MIN_BASELINE,
  ASPECT_SCALE,
  ASPECT_WINDOW_DAYS,
} from '@/app.config';
import {
  applyAssessmentOverride,
  aspectWindows,
  baselinesFor,
  buildBaselines,
  buildSnapshots,
  completedWeekEnds,
  computeAspectMetrics,
  daysBetween,
  logsInWindow,
  scoreAgainstBaseline,
  scoreAspects,
  windowEndingOn,
  type AspectScoring,
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
  rpe?: number;
  time?: number;
  distance?: number;
  completed?: boolean;
};
type ItemSpec = {
  movement: string;
  metric?: string;
  section?: string;
  notations?: string[];
  restSeconds?: number;
  sets: SetSpec[];
};
type LogOpts = {
  hr_avg?: number;
  hr_max?: number;
  total_seconds?: number;
  vibe?: VibeCheck;
  status?: string;
};

let seq = 0;
function log(date: string, items: ItemSpec[], opts: LogOpts = {}): WorkoutLog {
  seq += 1;
  return {
    id: `log-${seq}`,
    log_date: date,
    status: opts.status ?? 'done',
    hr_avg: opts.hr_avg ?? null,
    hr_max: opts.hr_max ?? null,
    total_seconds: opts.total_seconds ?? null,
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
                restSeconds: it.restSeconds,
                sets: it.sets.map((s) => ({
                  planned: null,
                  notations: it.notations ?? [],
                  actual: {
                    weight: s.weight,
                    reps: s.reps,
                    rpe: s.rpe,
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

  it('strength counts /side work that used to be invisible', () => {
    // Reps are logged per side and nothing in the app doubled them, so this was
    // real training the metric silently threw away.
    const oneSide = metrics([log('2026-07-20', [{ movement: 'Bulgarian Split Squat', sets: squatSets(4, 60) }])]);
    const perSide = metrics([
      log('2026-07-20', [
        { movement: 'Bulgarian Split Squat', notations: ['/side'], sets: squatSets(4, 60) },
      ]),
    ]);
    expect(perSide.strength!).toBeCloseTo(oneSide.strength! * 2, 5);
  });

  it('strength rises for paused reps and with RPE', () => {
    const plain = metrics([log('2026-07-20', [{ movement: 'Back Squat', sets: squatSets(4) }])]);
    const paused = metrics([
      log('2026-07-20', [{ movement: 'Back Squat', notations: ['(p)'], sets: squatSets(4) }]),
    ]);
    const hard = metrics([
      log('2026-07-20', [
        { movement: 'Back Squat', sets: squatSets(4).map((s) => ({ ...s, rpe: 10 })) },
      ]),
    ]);
    expect(paused.strength!).toBeGreaterThan(plain.strength!);
    expect(hard.strength!).toBeGreaterThan(plain.strength!);
  });

  it('strength rises with volume, not just load', () => {
    const few = metrics([log('2026-07-20', [{ movement: 'Back Squat', sets: squatSets(3) }])]);
    const many = metrics([log('2026-07-20', [{ movement: 'Back Squat', sets: squatSets(9) }])]);
    expect(many.strength!).toBeGreaterThan(few.strength!);
  });

  it('endurance counts dense strength work as conditioning', () => {
    // Identical work; only the wall-clock time it took differs. Short rests are
    // conditioning by any reasonable reading.
    const session = (total_seconds: number) =>
      log('2026-07-20', [{ movement: 'Back Squat', sets: squatSets(8) }], { total_seconds });
    expect(metrics([session(900)]).endurance!).toBeGreaterThan(
      metrics([session(5400)]).endurance!,
    );
  });

  it('endurance rewards a wide heart-rate spread', () => {
    // Same average HR, same duration: only the spread separates an interval
    // session from steady state, and it was being discarded entirely.
    const session = (hr_max: number) =>
      log('2026-07-20', [{ movement: 'Rower Interval', metric: 'time', sets: [{ time: 1800 }] }], {
        hr_avg: 140,
        hr_max,
        total_seconds: 1800,
      });
    expect(metrics([session(185)]).endurance!).toBeGreaterThan(metrics([session(150)]).endurance!);
  });

  it('endurance weights the spread up when a conditioning block was logged', () => {
    const sets = [{ time: 1800 }];
    const withBlock = log(
      '2026-07-20',
      [{ movement: 'Rower Interval', metric: 'time', section: 'conditioning', sets }],
      { hr_avg: 140, hr_max: 185, total_seconds: 1800 },
    );
    const withoutBlock = log(
      '2026-07-20',
      [{ movement: 'Rower Interval', metric: 'time', section: 'primary', sets }],
      { hr_avg: 140, hr_max: 185, total_seconds: 1800 },
    );
    expect(metrics([withBlock]).endurance!).toBeGreaterThan(metrics([withoutBlock]).endurance!);
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
  const thick = (n: number) => Array.from({ length: n }, (_, i) => 10 + i * 10);

  it('puts the median of your own history exactly mid-scale', () => {
    expect(scoreAgainstBaseline(30, baseline)!.score).toBe(MID);
  });

  it('moves in the right direction either side of the median', () => {
    expect(scoreAgainstBaseline(45, baseline)!.score).toBeGreaterThan(MID);
    expect(scoreAgainstBaseline(15, baseline)!.score).toBeLessThan(MID);
  });

  it('keeps responding where the old clamped model went flat', () => {
    // The failure this rework exists to fix: an absolute clamped score reached
    // ASPECT_SCALE.max at an ordinary value and stopped moving. Here the top of
    // the user's own historical range still leaves headroom, and exceeding it
    // still registers. (Scores are rounded to 1dp for display, so a genuinely
    // absurd outlier does print as 10.0 — that is the asymptote showing up in
    // the rounding, not an ordinary value hitting a ceiling.)
    const atTop = scoreAgainstBaseline(50, baseline)!.score;
    const beyond = scoreAgainstBaseline(75, baseline)!.score;
    expect(atTop).toBeLessThan(ASPECT_SCALE.max);
    expect(beyond).toBeGreaterThan(atTop);
  });

  it('stays inside the scale for absurd inputs', () => {
    for (const v of [1e9, -1e9, 0]) {
      const s = scoreAgainstBaseline(v, baseline)!.score;
      expect(Number.isFinite(s), `${v}`).toBe(true);
      expect(s).toBeGreaterThanOrEqual(ASPECT_SCALE.min);
      expect(s).toBeLessThanOrEqual(ASPECT_SCALE.max);
    }
  });

  it('survives a perfectly flat history without dividing by zero', () => {
    const flat = scoreAgainstBaseline(500, [10, 10, 10, 10, 10])!;
    expect(Number.isFinite(flat.score)).toBe(true);
    expect(flat.score).toBe(MID);
  });

  // The heart of this change: no invented reference value, so no score at all
  // rather than a number the data cannot support.
  it('refuses to score below the baseline threshold', () => {
    for (const b of [[], [42], Array.from({ length: ASPECT_MIN_BASELINE - 1 }, () => 30)]) {
      expect(scoreAgainstBaseline(80, b), `${b.length} samples`).toBeNull();
    }
  });

  it('scores as soon as the threshold is met', () => {
    expect(scoreAgainstBaseline(12, thick(ASPECT_MIN_BASELINE))).not.toBeNull();
  });

  it('reports low confidence on a thin baseline and ok on a settled one', () => {
    expect(scoreAgainstBaseline(12, thick(ASPECT_MIN_BASELINE))!.confidence).toBe('low');
    expect(scoreAgainstBaseline(12, thick(ASPECT_GOOD_BASELINE))!.confidence).toBe('ok');
  });

  it('ignores non-finite samples when counting the baseline', () => {
    const dirty = [...thick(ASPECT_MIN_BASELINE - 1), NaN, Infinity];
    expect(scoreAgainstBaseline(50, dirty)).toBeNull();
  });
});

describe('buildBaselines / baselinesFor / scoreAspects', () => {
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

  it('never mixes window lengths', () => {
    // Load-bearing: scoring a 28-day reading against 60-day samples would be
    // badly wrong on every axis with nothing on screen to give it away.
    const snapshots = [
      { window_days: 28, metrics: { strength: 10 } },
      { window_days: 60, metrics: { strength: 99 } },
      { window_days: 28, metrics: { strength: 12 } },
    ];
    expect(baselinesFor(snapshots, 28).strength).toEqual([10, 12]);
    expect(baselinesFor(snapshots, 60).strength).toEqual([99]);
    expect(baselinesFor(snapshots, 90).strength).toBeUndefined();
  });

  it('leaves an axis unscored when there is no baseline, but keeps its metric', () => {
    const { metrics, scores, confidence } = scoreAspects({ strength: 100 }, {});
    expect(scores.strength).toBeUndefined();
    expect(confidence.strength).toBeUndefined();
    // The raw measurement survives — it is what the chart draws instead.
    expect(metrics.strength).toBe(100);
  });

  it('scores only the axes whose baseline is thick enough', () => {
    const baselines = { power: [2, 3, 4, 5], strength: [100] };
    const { scores } = scoreAspects({ power: 6, strength: 120 }, baselines);
    expect(scores.power).toBeDefined();
    expect(scores.strength).toBeUndefined();
  });

  it('places a value at the top of your own range above mid-scale', () => {
    const relative = scoreAspects({ power: 6 }, { power: [2, 3, 4, 5, 6] }).scores.power!;
    expect(relative).toBeGreaterThan((ASPECT_SCALE.min + ASPECT_SCALE.max) / 2);
  });
});

describe('completedWeekEnds', () => {
  // 2026-07-31 is a Friday, so the last completed week ended Sunday 2026-07-26.
  it('returns completed weeks only, oldest first, ending Sunday', () => {
    expect(completedWeekEnds(day('2026-07-31'), 3)).toEqual([
      '2026-07-12',
      '2026-07-19',
      '2026-07-26',
    ]);
  });

  it('excludes the in-progress week even on its final day', () => {
    // Sunday 2026-08-02 closes its own week, but that week is only complete at
    // the moment it ends — treating it as done would make the key drift.
    expect(completedWeekEnds(day('2026-08-02'), 1)).toEqual(['2026-07-26']);
  });

  it('is stable across days within the same week', () => {
    // The upsert key is (owner, period_end, window_days). A period_end that
    // drifted with the current day would mint a new row on every visit.
    expect(completedWeekEnds(day('2026-07-27'), 2)).toEqual(
      completedWeekEnds(day('2026-08-02'), 2),
    );
  });

  it('crosses a year boundary', () => {
    expect(completedWeekEnds(day('2026-01-07'), 2)).toEqual(['2025-12-28', '2026-01-04']);
  });

  it('reaches a usable baseline in weeks, not months', () => {
    const ends = completedWeekEnds(day('2026-07-31'), ASPECT_MIN_BASELINE);
    expect(ends).toHaveLength(ASPECT_MIN_BASELINE);
    expect(daysBetween(ends[0], ends[ends.length - 1])).toBe((ASPECT_MIN_BASELINE - 1) * 7);
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
    // Seeded history gives the later period something to be relative to. With a
    // bare call there is no baseline at all, so nothing is scored — which is the
    // point of removing the invented reference.
    const logs = ends.map((e, i) => log(`${e.slice(0, 7)}-15`, [{ movement: 'Back Squat', sets: squatSets(4, 100 + i * 10) }]));
    const seeded = buildSnapshots(logs, ends, {
      seed: [{ strength: 90 }, { strength: 92 }, { strength: 94 }, { strength: 96 }],
    });
    const bare = buildSnapshots(logs, ends);
    expect(seeded[1].scores.strength).toBeDefined();
    expect(bare[1].scores.strength).toBeUndefined();
  });

  it('records the window length it was built for', () => {
    const logs = [log('2026-06-20', [{ movement: 'Back Squat', sets: squatSets(4) }])];
    const short = buildSnapshots(logs, ['2026-06-30'], { windowDays: 28 });
    expect(short[0].window_days).toBe(28);
    // Two series over the same period must be distinguishable, or the upsert key
    // (owner, period_end, window_days) collapses them onto one row.
    const long = buildSnapshots(logs, ['2026-06-30'], { windowDays: 60 });
    expect(long[0].window_days).toBe(60);
    expect(short[0].period_end).toBe(long[0].period_end);
  });

  it('produces rows that round-trip as snapshot input', () => {
    const [row] = buildSnapshots([log('2026-06-20', [{ movement: 'Back Squat', sets: squatSets(4) }])], ['2026-06-30']);
    expect(Object.keys(row).sort()).toEqual(['metrics', 'period_end', 'scores', 'window_days']);
  });
});

describe('applyAssessmentOverride', () => {
  const derived = (): AspectScoring => ({
    metrics: { strength: 110, power: 5, recovery: 0.6 },
    scores: { strength: 4, power: 4, recovery: 4 },
    confidence: { strength: 'low', power: 'low', recovery: 'low' },
  });
  const assessment = (taken_at: string, scores: Record<string, number>): FitnessAssessment =>
    ({ id: taken_at, owner_user_id: 'u', taken_at, scores, created_at: taken_at }) as FitnessAssessment;

  it('lets a fresh check-in speak for the axes it rated', () => {
    const out = applyAssessmentOverride(derived(), [assessment('2026-07-25', { strength: 9 })], END);
    expect(out.scores.strength).toBe(9);
    expect(out.scores.power).toBe(4); // unrated axis keeps the derived value
    expect(out.confidence.strength).toBe('ok');
  });

  it('stops trusting a stale check-in', () => {
    const out = applyAssessmentOverride(derived(), [assessment('2026-04-25', { strength: 9 })], END);
    expect(out.scores.strength).toBe(4);
    expect(out.confidence.strength).toBe('low');
  });

  it('ignores a check-in taken after the window end', () => {
    const out = applyAssessmentOverride(
      derived(),
      [assessment('2026-08-20', { strength: 9 }), assessment('2026-07-28', { strength: 7 })],
      END,
    );
    expect(out.scores.strength).toBe(7);
  });

  it('carries the raw metrics through untouched', () => {
    // A rating changes what the axis SCORES, never what was measured — the
    // snapshot history has to stay a record of the training, not the self-image.
    const out = applyAssessmentOverride(derived(), [assessment('2026-07-29', { strength: 9 })], END);
    expect(out.metrics).toEqual(derived().metrics);
  });

  it('does not mutate the scoring it was given', () => {
    const input = derived();
    applyAssessmentOverride(input, [assessment('2026-07-29', { strength: 9 })], END);
    expect(input.scores.strength).toBe(4);
  });
});
