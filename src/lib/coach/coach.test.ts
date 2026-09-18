import { describe, expect, it } from 'vitest';
import logsFixture from './__fixtures__/logs.json';
import mealsFixture from './__fixtures__/meals.json';
import statsFixture from './__fixtures__/userStats.json';
import {
  DECISION_EXPIRY_DAYS,
  MIN_SILENCE_DAYS,
  isSuppressed,
  runCoach,
} from '@/lib/coach/evaluate';
import {
  REGRESSION_DELTA,
  RESPEAK_DAYS,
  RESPEAK_SESSIONS,
  resolvedRuleId,
} from '@/lib/coach/recurrence';
import { byImpact, impactScore, impactWeight } from '@/lib/coach/impact';
import {
  COACH_WINDOW_DAYS,
  measureFuelTiming,
  measureGoals,
  rpeWasRated,
  measureNutrition,
  measureTraining,
} from '@/lib/coach/signals';
import { CLAIMS, KNOWLEDGE_PACK_VERSION, NUTRITION, SOURCES, TRAINING } from '@/lib/coach/knowledge';
import { MODALITY_KEYS, RPE, RPE_LADDER } from '@/app.config';
import {
  carbSourceConcentration,
  carbTimingWindow,
  longSessionUnfed,
} from '@/lib/coach/rules/nutrition';
import { readinessAndLoad, rpeCalibration } from '@/lib/coach/rules/training';
import type {
  CoachObservation,
  MealLog,
  Recommendation,
  UserStats,
  WorkoutLog,
} from '@/lib/types';

// Anchored one day after the newest fixture row so the 28-day window is stable.
const TODAY = new Date('2026-08-21T00:00:00Z');
const LOGS = logsFixture as unknown as WorkoutLog[];
const MEALS = mealsFixture as unknown as MealLog[];
const STATS = statsFixture as unknown as UserStats;

const base = { logs: LOGS, meals: MEALS, stats: STATS, existing: [], today: TODAY };

const trainingOpts = {
  heavyFraction: TRAINING.strengthIntensity.value,
  strengthRepMax: TRAINING.strengthReps.value,
  hypertrophyReps: TRAINING.hypertrophyReps.value,
  nearFailureRpe: TRAINING.hypertrophyProximityToFailure.value,
  allOutRpe: TRAINING.vo2AllOut.value,
  heavyRestSeconds: TRAINING.strengthRest.value,
};

/** A `coach_observations` row, for trajectory fixtures. */
function obs(
  rule_id: string,
  observed_on: string,
  drift: number,
  fired: boolean,
): CoachObservation {
  return {
    id: crypto.randomUUID(),
    owner_user_id: 'u',
    rule_id,
    observed_on,
    drift,
    confidence: 0.6,
    sufficiency: 'ok',
    fired,
    sessions: 12,
    observed: null,
    created_at: `${observed_on}T00:00:00Z`,
  };
}

function rec(over: Partial<Recommendation>): Recommendation {
  return {
    id: crypto.randomUUID(),
    owner_user_id: 'u',
    status: 'open',
    drift_score: 0,
    confidence: 0,
    tldr: null,
    action: null,
    body_md: null,
    disposition: null,
    disposition_note: null,
    linked_log_id: null,
    snooze_until: null,
    created_at: TODAY.toISOString(),
    rule_id: null,
    period_key: null,
    pack_version: null,
    evidence: null,
    ...over,
  };
}

describe('knowledge pack', () => {
  it('attributes every claim to a person, never to "research"', () => {
    for (const claim of Object.values(CLAIMS)) {
      const src = SOURCES[claim.source];
      expect(src, `${claim.id} has no source`).toBeTruthy();
      expect(src.speaker).not.toMatch(/research|stud(y|ies)|science/i);
      expect(src.url).toMatch(/^https:\/\//);
      expect(src.vaultPath).toMatch(/\.md$/);
    }
  });

  it('gives every claim a non-empty verbatim quote', () => {
    for (const claim of Object.values(CLAIMS)) {
      expect(claim.quote.length, `${claim.id} has no quote`).toBeGreaterThan(10);
      // A quote is pasted, not written. Ellipsis is the tell that it was edited.
      expect(claim.quote).not.toContain('…');
    }
  });

  it('has unique claim ids', () => {
    const ids = Object.values(CLAIMS).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('signals', () => {
  const training = measureTraining(LOGS, trainingOpts, TODAY);

  it('measures training time as elapsed minutes, not time under tension', () => {
    // The bug this engine shipped with once: an hour of lifting scored ~20
    // minutes because resistance was priced at reps x LOAD.repSeconds while
    // endurance was priced at its real duration, and the modality mix read 51%
    // endurance for an athlete who mostly lifts. Elapsed allocation now happens
    // inside summarizeBodyLoad, so this asserts the fixture's resistance time
    // is in the same unit as its wall clock rather than a fraction of it.
    const minutes = training.sessionMinutesPerWeek.value;
    const done = LOGS.filter((l) => l.status === 'done');
    const clockPerWeek =
      done.reduce((a, l) => a + (l.total_seconds ?? 0) / 60, 0) / (COACH_WINDOW_DAYS / 7);
    const total = MODALITY_KEYS.reduce((a, k) => a + minutes[k], 0);
    expect(total).toBeGreaterThan(clockPerWeek * 0.5);
    expect(minutes.resistance).toBeGreaterThan(minutes.endurance);
  });

  it('reads loaded work from every resistance section, not just `primary`', () => {
    // The bug this replaced: filtering to the `primary` section found 4 usable
    // sets and went permanently silent, while `accessory` and `secondary` held
    // 142 more — including the athlete's actual heavy lift.
    expect(training.loadedIntensity.samples).toBeGreaterThan(100);
    expect(training.loadedIntensity.sufficiency).toBe('ok');
    expect(training.loadedIntensity.value.topMovement).toBeTruthy();
    expect(training.loadedIntensity.value.topMovementBestKg).toBeGreaterThan(0);
  });

  it('measures effort and prescribed rest, which real logs actually carry', () => {
    expect(training.hypertrophyEffort.samples).toBeGreaterThan(25);
    expect(training.hypertrophyEffort.value.meanRpe).toBeGreaterThan(5);
    expect(training.hypertrophyEffort.value.meanRpe).toBeLessThanOrEqual(10);
    // Rest is PRESCRIBED, never timed — absent rest must not read as zero.
    expect(training.heavyRest.value.meanSeconds).not.toBeNaN();
  });

  it('reports insufficiency instead of guessing when a signal really is thin', () => {
    const thin = measureTraining(LOGS.slice(0, 1), trainingOpts, TODAY);
    expect(thin.sessionsPerWeek.sufficiency).toBe('insufficient');
    expect(thin.sessionsPerWeek.shortfall).toBeTruthy();
  });

  it('keeps goal shares summing to one so over- and under-service are one fact', () => {
    const shares = measureGoals(STATS, training).value;
    const sum = shares.reduce((s, g) => s + g.actual, 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(shares.reduce((s, g) => s + g.intent, 0)).toBeCloseTo(1, 5);
    // `skill` is ranked 0 and has no modality — it must not appear as neglected.
    expect(shares.map((g) => g.id)).not.toContain('skill');
  });

  it('counts nutrition timing from wall clock and never from portion size', () => {
    const n = measureNutrition(MEALS, LOGS, TODAY);
    expect(n.firstMealHour.value).toBeGreaterThan(6);
    expect(n.lastMealHour.value).toBeGreaterThan(n.firstMealHour.value);
    expect(n.meanHungerBefore.value).toBeGreaterThanOrEqual(1);
    expect(n.meanHungerBefore.value).toBeLessThanOrEqual(5);
  });
});

describe('RPE is a prefill before it is a measurement', () => {
  const training = measureTraining(LOGS, trainingOpts, TODAY);

  it('does not mistake the logger default for a rating', () => {
    // RPE.default is 7 and the logger fills it in, so 72.6% of sets in this real
    // log read exactly 7.0 whether or not anyone rated them. A session that
    // never moved the dial is missing data, not easy training.
    const allDefault = LOGS.find((l) => !rpeWasRated(l));
    expect(allDefault, 'fixture should contain an unrated session').toBeTruthy();
    expect(training.hypertrophyEffort.value.unratedSessions).toBeGreaterThan(0);
    expect(training.rpeCalibration.value.defaultShare).toBeGreaterThan(0.5);
  });

  it('counts a session that moved the dial even once as rated', () => {
    const rated = LOGS.find((l) => rpeWasRated(l));
    expect(rated).toBeTruthy();
    expect(training.rpeCalibration.value.ratedSessions).toBeGreaterThan(0);
  });

  it('judges only the last movement to hit each muscle group', () => {
    // Stacking several movements on one region forces the earlier ones to be
    // held back so the later ones stay performable. The unit is now one reading
    // per region per rated session, so it must be far smaller than the raw set
    // count while still being enough to reason from.
    const e = training.hypertrophyEffort.value;
    expect(e.total).toBeGreaterThan(10);
    expect(e.total).toBeLessThan(training.repBands.value.hypertrophy);
  });

  it('answers whether the RPE is low or merely unlogged, using soreness', () => {
    const f = rpeCalibration(training, '2026-W34');
    expect(f).toBeTruthy();
    const o = f!.observed;
    expect(o.sorenessAfterRated).not.toBeNull();
    expect(o.sorenessAfterUnrated).not.toBeNull();
    // On this athlete the rated sessions are followed by MORE soreness, which
    // means the dial is honest. The rule must report that direction rather than
    // collapsing it into "about the same" — the bug the first version had.
    expect(o.sorenessAfterRated as number).toBeGreaterThan(o.sorenessAfterUnrated as number);
    expect(f!.body).toContain('tracking honestly');
    expect(f!.body).not.toContain('cannot currently be read');
  });

  it('never tells this athlete to chase RPE 9', () => {
    // Their own calibration: 9 is almost-failure and deliberately avoided.
    // Chasing it would be coaching against their stated practice.
    for (const f of runCoach(base).findings) {
      if (f.ruleId.startsWith('training.hypertrophy')) {
        expect(f.action, f.ruleId).not.toMatch(/RPE 9|RPE 9\.5|RPE 10/);
      }
    }
    expect(RPE_LADDER.nearFailure).toBeLessThan(RPE_LADDER.allOut);
    expect(RPE.default).toBeLessThan(RPE_LADDER.nearFailure);
  });
});

describe('conditioning and vibe', () => {
  const training = measureTraining(LOGS, trainingOpts, TODAY);

  it('separates interval work from steady state, and reads how hard it went', () => {
    const iv = training.intervals.value;
    // 30-second Ski-Erg bouts. Counting minutes alone would read these as
    // VO2max work; the RPE is what says they are not.
    expect(iv.bouts).toBeGreaterThan(10);
    expect(iv.meanBoutSeconds).toBeLessThan(120);
    expect(iv.meanRpe).toBeLessThan(TRAINING.vo2AllOut.value);
    expect(iv.allOutBouts).toBe(0);
  });

  it('does not count a 45-minute ride as an interval bout', () => {
    const iv = training.intervals.value;
    // Every bout must be under the cap; a steady-state block logged as one
    // timed set would blow boutMinutes up on its own.
    expect(iv.boutMinutes).toBeLessThan(iv.bouts * 5);
  });

  it('reads every metric the conditioning block recorded', () => {
    const c = training.conditioning;
    expect(c.sets).toBeGreaterThan(20);
    expect(c.minutes).toBeGreaterThan(0);
    expect(c.distanceMeters).toBeGreaterThan(0);
    // Sets that recorded nothing are counted, not silently dropped.
    expect(c.bareSets).toBeGreaterThanOrEqual(0);
  });

  it('reads the vibe check and reports how much of the window it covers', () => {
    const r = training.readiness.value;
    expect(r.rated).toBeGreaterThan(5);
    expect(r.coverage).toBeGreaterThan(0);
    expect(r.coverage).toBeLessThanOrEqual(1);
    for (const v of [r.meanSleep, r.meanEnergy, r.meanSoreness]) {
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(5);
    }
  });

  it('will not call symptoms overreaching without a load signal agreeing', () => {
    // Galpin wants three concurrent signals. This app has two channels at best,
    // so a symptom on its own must stay silent.
    expect(readinessAndLoad(training, STATS, '2026-W34')).toBeNull();

    const loaded = { ...training, longestConsecutiveDays: 6 };
    const symptomatic = {
      ...loaded,
      readiness: {
        ...training.readiness,
        value: { ...training.readiness.value, lowSleepSessions: 3, highSorenessSessions: 2 },
      },
    };
    const f = readinessAndLoad(symptomatic, STATS, '2026-W34');
    expect(f).toBeTruthy();
    // It must name the signal it does not have rather than implying three.
    expect(f!.body).toContain('biomarker');
    expect(f!.confidence).toBeLessThan(0.6);
  });
});

describe('workout and meal timing', () => {
  it('compares session start to meals in local clock hours', () => {
    const fuel = measureFuelTiming(LOGS, MEALS, 60, TODAY);
    expect(fuel.pairedDays).toBeGreaterThan(0);
    expect(fuel.meanStartHour).toBeGreaterThan(6);
    expect(fuel.meanStartHour).toBeLessThan(23);
  });

  it('treats a training day with no meals logged as absent data, not a fast', () => {
    const fuel = measureFuelTiming(LOGS, [], 60, TODAY);
    expect(fuel.pairedDays).toBe(0);
    expect(fuel.unfedSessions).toBe(0);
    expect(longSessionUnfed(fuel, STATS, '2026-W34')).toBeNull();
  });

  it('stays quiet when the athlete does eat before training', () => {
    const fuel = measureFuelTiming(LOGS, MEALS, 60, TODAY);
    expect(fuel.unfedLongSessions).toBe(0);
    expect(longSessionUnfed(fuel, STATS, '2026-W34')).toBeNull();
  });
});

describe('meal free text', () => {
  const base34 = (note: string, i: number) => ({
    ...(MEALS[i % MEALS.length] as MealLog),
    note,
  });

  it('mirrors a concentrated carb source without calling it wrong', () => {
    const meals = Array.from({ length: 20 }, (_, i) =>
      base34(i < 15 ? 'Fish and rice' : 'Eggs and toast', i),
    );
    const n = measureNutrition(meals, LOGS, TODAY);
    const f = carbSourceConcentration(n, '2026-08');
    expect(f).toBeTruthy();
    expect(f!.observed.topSource).toBe('rice');
    // No corpus claim ranks carbohydrate sources, so it must not imply one.
    expect(f!.claims).toHaveLength(0);
    expect(f!.body).toContain('mirror, not a verdict');
  });

  it('says nothing when most meals were never described', () => {
    const meals = (MEALS as MealLog[]).map((m) => ({ ...m, note: null }));
    const n = measureNutrition(meals, LOGS, TODAY);
    expect(n.text.described).toBe(0);
    expect(carbSourceConcentration(n, '2026-08')).toBeNull();
  });

  it('reports tag_mix coverage without turning a percentage into a gram', () => {
    const n = measureNutrition(MEALS, LOGS, TODAY);
    expect(n.mixCoverage).toBeGreaterThan(0);
    expect(n.mixCoverage).toBeLessThanOrEqual(1);
    if (n.meanProteinMixPct != null) {
      expect(n.meanProteinMixPct).toBeGreaterThanOrEqual(0);
      expect(n.meanProteinMixPct).toBeLessThanOrEqual(100);
    }
  });
});

describe('runCoach', () => {
  it('is deterministic — same input, same rows', () => {
    const a = runCoach(base);
    const b = runCoach(base);
    expect(JSON.stringify(a.write)).toBe(JSON.stringify(b.write));
  });

  it('writes every true finding rather than destroying the ones past a cap', () => {
    // The old cap of four was applied at the write, so a fifth true finding got
    // no row, no history and no way to be seen. Volume control moved to the
    // page (SURFACED_LIMIT in CoachView); the engine now persists all of them.
    const out = runCoach(base);
    expect(out.write.length).toBe(out.findings.length - out.suppressed.length);
    expect(out.write.length).toBeGreaterThan(4);
  });

  it('orders the write set by impact, not by whichever drift normalised larger', () => {
    const write = runCoach(base).write;
    const scores = write.map((r) =>
      impactScore({ ruleId: r.rule_id, drift: r.drift_score, confidence: r.confidence }),
    );
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('puts a structural finding above a cosmetic one at equal drift and confidence', () => {
    const structural = { ruleId: 'training.frequency.below-target', drift: 0.3, confidence: 0.6 };
    const cosmetic = { ruleId: 'training.endurance.interval-ordering', drift: 0.3, confidence: 0.6 };
    expect(impactScore(structural)).toBeGreaterThan(impactScore(cosmetic));
  });

  it('does not let a large miss on a trivial rule outrank a small one on a serious rule', () => {
    // The inversion the drift floor exists to prevent.
    const serious = { ruleId: 'training.hypertrophy.total-volume-short', drift: 0.05, confidence: 0.6 };
    const trivial = { ruleId: 'nutrition.timing.arriving-hungry', drift: 1, confidence: 0.5 };
    expect(byImpact(serious, trivial)).toBeLessThan(0);
  });

  it('weights a per-goal rule without needing a table row per goal', () => {
    expect(impactWeight('goal.underserved.endurance')).toBe(impactWeight('goal.underserved.mobility'));
    expect(impactWeight('goal.underserved.endurance')).toBeGreaterThan(0.5);
  });

  it('stamps every row with a rule id, a period and the pack version', () => {
    for (const row of runCoach(base).write) {
      expect(row.rule_id).toMatch(/^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/);
      expect(row.period_key).toMatch(/^\d{4}(-W\d{2}|-\d{2})$/);
      expect(row.pack_version).toBe(KNOWLEDGE_PACK_VERSION);
    }
  });

  it('freezes resolved citations into evidence rather than referencing them', () => {
    const cited = runCoach(base).write.filter((r) => r.evidence.claims.length > 0);
    expect(cited.length).toBeGreaterThan(0);
    for (const row of cited) {
      for (const c of row.evidence.claims) {
        // Resolved: the row can render itself after the pack moves on.
        expect(c.quote.length).toBeGreaterThan(10);
        expect(c.speaker.length).toBeGreaterThan(0);
        expect(c.url).toMatch(/^https:\/\//);
      }
    }
  });

  it('quotes the number it fired on inside the body', () => {
    for (const row of runCoach(base).write) {
      expect(row.body_md.length).toBeGreaterThan(80);
      expect(row.tldr.length).toBeLessThanOrEqual(200);
      expect(/\d/.test(row.body_md), `${row.rule_id} body has no numbers`).toBe(true);
    }
  });

  it('finds the effort problem the rep range alone would hide', () => {
    const f = runCoach(base).findings.find(
      (x) => x.ruleId === 'training.hypertrophy.effort-low',
    );
    expect(f).toBeTruthy();
    expect(f!.observed.meanTerminalRpe).toBeLessThan(RPE_LADDER.nearFailure);
    // Judged against the athlete's own ladder — 8 is their last good rep — and
    // NOT 9, which they avoid by design.
    expect(f!.observed.mark).toBe(8);
    expect(f!.body).toContain('not 9');
  });

  it('finds under-loading now that it reads every resistance section', () => {
    const f = runCoach(base).findings.find(
      (x) => x.ruleId === 'training.intent.loaded-too-light',
    );
    expect(f).toBeTruthy();
    expect(f!.observed.loadedSets).toBeGreaterThan(100);
  });

  it('does not promote the highest e1RM to "your main lift"', () => {
    // A hip-thrust machine outranks a back squat on raw e1RM. Calling it the
    // main lift would be a programming claim the number cannot support.
    const bodies = runCoach(base).findings.map((f) => f.body).join(' ');
    expect(bodies).not.toMatch(/your (heaviest|main) lift/i);
  });

  it('ranks by consequence and distance, not by how sure it is', () => {
    // The standing protein target is the most certain thing the coach knows and
    // also drift 0. It must never head the page ahead of a measured problem.
    const write = runCoach(base).write;
    expect(write[0].drift_score).toBeGreaterThan(0);
    expect(write[0].rule_id).not.toBe('nutrition.dose.protein-target');
    expect(write[write.length - 1].rule_id).toBe('nutrition.dose.protein-target');
  });

  it('covers every family it claims to look at', () => {
    // The family cap that used to live here was compensating for the write cap:
    // training rules are the most numerous and best measured, so uncapped they
    // filled all four slots and nutrition never appeared. With nothing dropped
    // at the write, coverage is a property of the output rather than a quota,
    // and the cap survives only on the surfaced rows (CoachView).
    const counts = new Map<string, number>();
    for (const r of runCoach(base).write) {
      const fam = r.rule_id.split('.')[0];
      counts.set(fam, (counts.get(fam) ?? 0) + 1);
    }
    expect(counts.size).toBeGreaterThanOrEqual(3);
  });

  it('says something about training AND about nutrition', () => {
    const ids = runCoach(base).write.map((r) => r.rule_id);
    expect(ids.some((i) => i.startsWith('training.') || i.startsWith('goal.'))).toBe(true);
    expect(ids.some((i) => i.startsWith('nutrition.'))).toBe(true);
  });

  it('stays silent on a rule whose inputs are too thin, without erroring', () => {
    const oneLog = runCoach({ ...base, logs: LOGS.slice(0, 1) });
    expect(oneLog.findings.map((f) => f.ruleId)).not.toContain(
      'training.frequency.below-target',
    );
  });
});

describe('caveat gates', () => {
  it('will not raise carb timing below the training frequency its source names', () => {
    const training = measureTraining(LOGS, trainingOpts, TODAY);
    const nutrition = measureNutrition(MEALS, LOGS, TODAY);
    expect(training.sessionsPerWeek.value).toBeLessThan(
      NUTRITION.carbTimingPrecondition.value,
    );
    expect(carbTimingWindow(nutrition, training, STATS, '2026-W34')).toBeNull();
  });

  it('raises it once training frequency clears the precondition', () => {
    const training = measureTraining(LOGS, trainingOpts, TODAY);
    const daily = {
      ...training,
      sessionsPerWeek: { value: 8, samples: 32, sufficiency: 'ok' as const },
    };
    const nutrition = {
      ...measureNutrition(MEALS, LOGS, TODAY),
      trainingDays: 10,
      trainingDaysFuelled: 4,
    };
    const f = carbTimingWindow(nutrition, daily, STATS, '2026-W34');
    expect(f?.ruleId).toBe('nutrition.timing.carb-window');
    // The gate itself must be visible to the athlete, not just enforced in code.
    expect(f?.body).toContain('precondition');
  });

  it('never derives a gram from a logged meal', () => {
    // The only rule allowed to name grams is the standing target, and it must
    // reach them from bodyweight — never from size or tag_mix.
    const out = runCoach(base);
    const gramRules = out.findings.filter((f) => /\d+\s?g\b|grams/.test(f.body));
    for (const f of gramRules) {
      expect(f.ruleId).toBe('nutrition.dose.protein-target');
      expect(f.observed.bodyWeightKg).toBe(86);
      expect(f.body).toContain('records no grams');
    }
  });
});

describe('observations', () => {
  const ago = (d: number) => new Date(TODAY.getTime() - d * 86_400_000).toISOString();

  it('records a reading for every rule that fired', () => {
    const out = runCoach(base);
    const ids = new Set(out.observations.map((o) => o.rule_id));
    for (const f of out.findings) expect(ids.has(f.ruleId)).toBe(true);
  });

  it('stamps every reading with the same day', () => {
    const out = runCoach(base);
    const days = new Set(out.observations.map((o) => o.observed_on));
    expect(days.size).toBe(1);
    expect([...days][0]).toBe(TODAY.toISOString().slice(0, 10));
  });

  it('records a clean zero for a rule with history that has stopped firing', () => {
    // The whole point of the table: without a reading between two decisions
    // there is no trajectory, and improvement is invisible.
    const quietRule = 'training.strength.rest-too-short';
    const fired = new Set(runCoach(base).findings.map((f) => f.ruleId));
    expect(fired.has(quietRule)).toBe(false);

    const out = runCoach({
      ...base,
      existing: [rec({ rule_id: quietRule, status: 'acted', created_at: ago(30) })],
    });
    const reading = out.observations.find((o) => o.rule_id === quietRule);
    expect(reading).toBeDefined();
    expect(reading!.drift).toBe(0);
    expect(reading!.fired).toBe(false);
  });

  it('writes NO reading rather than a zero when there was nothing to look at', () => {
    // "We do not know" and "you are fine" must never share a value — a
    // fortnight off training would otherwise clear every open finding at once.
    const quietRule = 'training.strength.rest-too-short';
    const out = runCoach({
      ...base,
      logs: [],
      meals: [],
      existing: [rec({ rule_id: quietRule, status: 'acted', created_at: ago(30) })],
    });
    expect(out.observations.find((o) => o.rule_id === quietRule)).toBeUndefined();
  });

  it('never records a reading for a closing finding', () => {
    // `outcome.resolved.*` is the end of a story, not a measurement in one.
    const out = runCoach({
      ...base,
      existing: [rec({ rule_id: 'outcome.resolved.training.x.y', status: 'open' })],
    });
    expect(out.observations.some((o) => o.rule_id.startsWith('outcome.'))).toBe(false);
  });

  it('carries the rule numbers so a trajectory can be explained, not only scored', () => {
    const out = runCoach(base);
    const fired = out.observations.filter((o) => o.fired);
    expect(fired.length).toBeGreaterThan(0);
    for (const o of fired) expect(o.observed).not.toBeNull();
  });
});

describe('closing the loop', () => {
  const ago = (d: number) => new Date(TODAY.getTime() - d * 86_400_000).toISOString();
  const day = (d: number) => ago(d).slice(0, 10);
  const RULE = 'training.strength.rest-too-short';

  /** Acted at a real problem, then three readings walking it down to nothing. */
  const fixedUp = () => ({
    ...base,
    existing: [
      rec({
        rule_id: RULE,
        status: 'acted',
        disposition: 'acted_as_prescribed',
        created_at: ago(30),
        drift_score: 0.8,
        tldr: 'Heavy sets are getting 70s of rest',
      }),
    ],
    observations: [
      obs(RULE, day(21), 0.5, true),
      obs(RULE, day(14), 0.2, true),
      obs(RULE, day(7), 0.05, false),
    ],
  });

  it('tells the athlete when advice they took actually worked', () => {
    const out = runCoach(fixedUp());
    expect(out.resolved).toContain(RULE);
    const row = out.write.find((r) => r.rule_id === `outcome.resolved.${RULE}`);
    expect(row).toBeDefined();
    expect(row!.tldr).toContain('Heavy sets are getting 70s of rest');
  });

  it('reports the current reading as drift, not the size of the win', () => {
    // `drift_score` means "distance past the threshold" on every other row.
    // Overloading it here would make rank() read a big win as a big problem.
    const row = runCoach(fixedUp()).write.find((r) => r.rule_id.startsWith('outcome.'))!;
    expect(row.drift_score).toBeLessThanOrEqual(0.1);
    // The rule does not fire on this fixture, so the current reading is a clean
    // 0 and the improvement is the whole of the 0.80 it was decided at.
    expect(row.evidence.observed.improvementPoints).toBe(80);
  });

  it('says it once', () => {
    const first = fixedUp();
    const already = {
      ...first,
      existing: [
        ...first.existing,
        rec({ rule_id: `outcome.resolved.${RULE}`, status: 'open', created_at: ago(1) }),
      ],
    };
    expect(runCoach(already).resolved).toEqual([]);
  });

  it('does not close a loop the athlete refused to enter', () => {
    const first = fixedUp();
    const dismissed = {
      ...first,
      existing: [rec({ ...first.existing[0], status: 'dismissed' })],
    };
    expect(runCoach(dismissed).resolved).toEqual([]);
  });

  it('never renders "cleared: X" directly above X', () => {
    // Resolution needs the last readings under the floor, and a rule can sit a
    // fraction past its own threshold and still be inside that floor. Without
    // the guard the page carries the closing row and the complaint together.
    const RPE = 'training.effort.rpe-calibration';
    const fired = runCoach(base).findings.find((f) => f.ruleId === RPE);
    expect(fired).toBeDefined();

    const out = runCoach({
      ...base,
      existing: [
        rec({
          rule_id: RPE,
          status: 'acted',
          disposition: 'acted_as_prescribed',
          created_at: ago(30),
          drift_score: 0.9,
          tldr: 'The RPE dial is not being moved',
        }),
      ],
      observations: [
        obs(RPE, day(21), 0.05, false),
        obs(RPE, day(14), 0.04, false),
        obs(RPE, day(7), 0.03, false),
      ],
    });
    // Whether or not it resolves on this fixture, the two must never co-exist.
    const ids = out.write.map((r) => r.rule_id);
    if (ids.includes(`outcome.resolved.${RPE}`)) expect(ids).not.toContain(RPE);
  });

  it('counts a closing finding separately from a new problem', () => {
    const out = runCoach(fixedUp());
    // The surface subtracts `resolved` from `write` to report "N new", so a
    // closing row counted as a discovery is a lie the athlete catches at once.
    expect(out.write.length - out.refreshed.length - out.resolved.length).toBeGreaterThanOrEqual(0);
  });
});

describe('suppression', () => {
  const ruleId = 'training.endurance.zone2-short';
  const ago = (d: number) => new Date(TODAY.getTime() - d * 86_400_000).toISOString();
  /** Enough new training and enough movement to clear both halves of the gate. */
  const moved = { newSessions: 99, drift: 1 };

  it('lets a rule update its own open row inside the same period', () => {
    const existing = [rec({ rule_id: ruleId, period_key: '2026-W34', status: 'open' })];
    expect(isSuppressed(ruleId, '2026-W34', existing, TODAY)).toBeNull();
  });

  it('refreshes an open row from an earlier period instead of muting the rule', () => {
    // THE BUG. An open row from last week used to suppress its own rule
    // outright, so an unaddressed finding froze at the numbers it first fired
    // on and silenced itself thereafter. Enough of those and every check-in
    // reported "nothing new" to an athlete who had trained all week.
    const existing = [rec({ rule_id: ruleId, period_key: '2026-W33', status: 'open' })];
    expect(isSuppressed(ruleId, '2026-W34', existing, TODAY)).toBeNull();
  });

  it('writes the refreshed numbers onto the open row rather than minting a second', () => {
    const first = runCoach(base);
    const target = first.write[0];
    const openRow = rec({
      rule_id: target.rule_id,
      period_key: '2026-W01',
      status: 'open',
      created_at: ago(30),
      drift_score: target.drift_score,
    });
    const out = runCoach({ ...base, existing: [openRow] });
    const again = out.write.filter((r) => r.rule_id === target.rule_id);
    expect(again).toHaveLength(1);
    // Same row, by conflict target — not a new weekly one alongside it.
    expect(again[0].period_key).toBe('2026-W01');
    expect(out.refreshed).toContain(target.rule_id);
  });

  it('honours a decision for a short floor no matter what lands', () => {
    const justNow = rec({ rule_id: ruleId, status: 'dismissed', created_at: ago(1) });
    expect(isSuppressed(ruleId, '2026-W34', [justNow], TODAY, moved)).toBe('too-soon');
  });

  it('re-speaks on a problem that has simply persisted, without it getting worse', () => {
    // THE BUG THIS REPLACES. The gate asked for drift 0.15 WORSE than the
    // decision, so standing still bought silence and the athlete never heard
    // about anything they had failed to fix. Persisting is now its own reason.
    const dismissed = rec({
      rule_id: ruleId,
      status: 'dismissed',
      created_at: ago(MIN_SILENCE_DAYS.dismissed + 1),
      drift_score: 0.6,
    });
    const enough = RESPEAK_SESSIONS.dismissed;
    expect(
      isSuppressed(ruleId, '2026-W34', [dismissed], TODAY, { newSessions: enough, drift: 0.6 }),
    ).toBeNull();
  });

  it('cannot be gagged by a decision taken at the top of the scale', () => {
    // Drift is clamped 0..1 everywhere in impact.ts, so `drift + 0.15` was
    // unreachable for anything decided at 1.0 — one real account had a rule
    // locked until DECISION_EXPIRY_DAYS on exactly this.
    const acted = rec({
      rule_id: ruleId,
      status: 'acted',
      disposition: 'acted_as_prescribed',
      created_at: ago(20),
      drift_score: 1,
    });
    expect(
      isSuppressed(ruleId, '2026-W34', [acted], TODAY, { newSessions: 9, drift: 1 }),
    ).toBeNull();
  });

  it('holds its tongue until enough has happened, in days or in sessions', () => {
    const dismissed = rec({
      rule_id: ruleId,
      status: 'dismissed',
      created_at: ago(MIN_SILENCE_DAYS.dismissed + 1),
      drift_score: 0.6,
    });
    // One session, and 11 of the 28 days: short on both, so still quiet.
    expect(
      isSuppressed(ruleId, '2026-W34', [dismissed], TODAY, { newSessions: 1, drift: 0.6 }),
    ).toBe('no-new-training');
    // Days alone are enough — the athlete who trains twice a week must not wait
    // longest to hear about the frequency rule aimed at them.
    const old = rec({
      rule_id: ruleId,
      status: 'dismissed',
      created_at: ago(RESPEAK_DAYS.dismissed + 1),
      drift_score: 0.6,
    });
    expect(
      isSuppressed(ruleId, '2026-W34', [old], TODAY, { newSessions: 1, drift: 0.6 }),
    ).toBeNull();
  });

  it('sees a relapse off the athletes own best, not off the decision', () => {
    // 0.9 -> 0.1 -> 0.8 is a total relapse, and the old gate read it as
    // "unchanged" because 0.8 is below the 0.9 it was decided at.
    const acted = rec({
      rule_id: ruleId,
      status: 'acted',
      disposition: 'acted_as_prescribed',
      created_at: ago(40),
      drift_score: 0.9,
    });
    const since = [
      { observedOn: '2026-08-01', drift: 0.4, fired: true },
      { observedOn: '2026-08-08', drift: 0.1, fired: false },
      { observedOn: '2026-08-15', drift: 0.12, fired: false },
    ];
    expect(
      isSuppressed(ruleId, '2026-W34', [acted], TODAY, {
        newSessions: 12,
        drift: 0.1 + REGRESSION_DELTA + 0.01,
        since,
      }),
    ).toBeNull();
  });

  it('stays quiet on a finding that is genuinely coming down', () => {
    const dismissed = rec({
      rule_id: ruleId,
      status: 'dismissed',
      created_at: ago(30),
      drift_score: 0.8,
    });
    expect(
      isSuppressed(ruleId, '2026-W34', [dismissed], TODAY, { newSessions: 40, drift: 0.4 }),
    ).toBe('improving');
  });

  it('retires a decision once the rule has been reported as cleared', () => {
    const acted = rec({
      rule_id: ruleId,
      status: 'acted',
      disposition: 'acted_as_prescribed',
      created_at: ago(40),
      drift_score: 0.8,
    });
    const closed = rec({
      rule_id: resolvedRuleId(ruleId),
      status: 'open',
      created_at: ago(10),
    });
    // Back over threshold after being cleared: graded as a new event, not
    // against the pre-fix anchor.
    expect(
      isSuppressed(ruleId, '2026-W34', [acted, closed], TODAY, { newSessions: 0, drift: 0.5 }),
    ).toBeNull();
  });

  it('gives acted-on advice fewer sessions to land than a rejection buys', () => {
    expect(RESPEAK_SESSIONS.acted).toBeLessThan(RESPEAK_SESSIONS.dismissed);
    const acted = rec({
      rule_id: ruleId,
      status: 'acted',
      disposition: 'acted_as_prescribed',
      created_at: ago(1),
    });
    expect(isSuppressed(ruleId, '2026-W34', [acted], TODAY, moved)).toBe('too-soon');
  });

  it('expires a decision that would otherwise buy silence forever', () => {
    // The mirror of the bug it replaced: a rule decided once, on a measurement
    // that is stable by nature, must not be gagged permanently by an evidence
    // gate it can never satisfy.
    const ancient = rec({
      rule_id: ruleId,
      status: 'dismissed',
      created_at: ago(DECISION_EXPIRY_DAYS + 1),
      drift_score: 0.9,
    });
    expect(isSuppressed(ruleId, '2026-W34', [ancient], TODAY, { newSessions: 0, drift: 0.9 })).toBeNull();
  });

  it('respects an unexpired snooze and releases an expired one', () => {
    const future = rec({
      rule_id: ruleId,
      status: 'snoozed',
      snooze_until: new Date(TODAY.getTime() + 2 * 86_400_000).toISOString(),
    });
    expect(isSuppressed(ruleId, '2026-W34', [future], TODAY, moved)).toBe('snoozed');

    const past = rec({
      rule_id: ruleId,
      status: 'snoozed',
      snooze_until: ago(1),
    });
    expect(isSuppressed(ruleId, '2026-W34', [past], TODAY, moved)).toBeNull();
  });

  it('reads only the newest decision for a rule', () => {
    const existing = [
      rec({ rule_id: ruleId, status: 'dismissed', created_at: ago(90) }),
      rec({ rule_id: ruleId, status: 'acted', created_at: ago(2) }),
    ];
    // The dismissal has long expired; the recent action is still inside its floor.
    expect(isSuppressed(ruleId, '2026-W34', existing, TODAY, moved)).toBe('too-soon');
  });

  it('runs both halves of the gate over real logs, not just in isolation', () => {
    // The fixture carries 7 completed sessions in the 11 days before TODAY, so
    // a decision dated 11 days back clears the session half outright. What
    // decides the outcome is then the number itself — which is the behaviour
    // the calendar cooldowns never had.
    const decided = (driftAtDecision: (d: number) => number) =>
      runCoach(base).findings.map((f) =>
        rec({
          rule_id: f.ruleId,
          status: 'dismissed',
          created_at: ago(MIN_SILENCE_DAYS.dismissed + 1),
          drift_score: driftAtDecision(f.drift),
        }),
      );

    // Every rule was decided on a WORSE number than it reads today: each one is
    // improving, so none of them re-opens.
    const quiet = runCoach({ ...base, existing: decided((d) => d + 1) });
    expect(quiet.write).toHaveLength(0);
    expect(quiet.suppressed.every((s) => s.reason === 'improving')).toBe(true);

    // Same decisions, same dates, but each was made on a clean number and the
    // measurement has since drifted out. The training that landed in between is
    // what buys the right to speak.
    const spoke = runCoach({ ...base, existing: decided(() => 0) });
    expect(spoke.write.length).toBeGreaterThan(0);
  });

  it('drops suppressed findings from the write set and reports why', () => {
    const dismissAll = runCoach(base).findings.map((f) =>
      rec({ rule_id: f.ruleId, period_key: '2026-W33', status: 'dismissed', created_at: ago(1) }),
    );
    const out = runCoach({ ...base, existing: dismissAll });
    expect(out.write).toHaveLength(0);
    expect(out.suppressed.length).toBe(out.findings.length);
    expect(out.suppressed.every((s) => s.reason === 'too-soon')).toBe(true);
  });
});

describe('cold start', () => {
  it('says nothing at all rather than guessing from no data', () => {
    const out = runCoach({ logs: [], meals: [], stats: null, existing: [], today: TODAY });
    expect(out.write).toHaveLength(0);
  });

  it('does not invent a protein target without a bodyweight', () => {
    const noWeight = { ...STATS, body_weight_kg: null };
    const ids = runCoach({ ...base, stats: noWeight }).findings.map((f) => f.ruleId);
    expect(ids).not.toContain('nutrition.dose.protein-target');
  });

  it('does not accuse an athlete of neglecting a goal they never set', () => {
    const noGoals = { ...STATS, goals: [] };
    const ids = runCoach({ ...base, stats: noGoals }).findings.map((f) => f.ruleId);
    expect(ids.filter((i) => i.startsWith('goal.'))).toHaveLength(0);
    // Goal-gated training rules go quiet too.
    expect(ids).not.toContain('training.hypertrophy.total-volume-short');
    expect(ids).not.toContain('training.hypertrophy.region-volume-short');
  });
});

describe('timezone determinism', () => {
  // This suite reads a LOCAL clock hour off `started_at` and compares it to meal
  // times stored as bare wall-clock strings. That pairing is correct in a
  // browser — both are the athlete's own zone — but it means these fixtures only
  // mean one thing if the runner's zone is pinned. It was not: the fuel-timing
  // assertions passed in Europe/London and Asia/Kolkata and failed in UTC,
  // America/New_York and Australia/Sydney, so the suite was red in CI and green
  // for whoever wrote it, for months.
  //
  // vitest.config.ts pins TZ=UTC. If that pin is ever removed this fails first
  // and names the reason, instead of one fuel-timing assertion failing somewhere
  // far away and looking like a coaching-logic bug.
  it('runs in the pinned timezone', () => {
    expect(new Date().getTimezoneOffset()).toBe(0);
  });

  // The specific trap: a session that starts within an hour of the day's first
  // meal flips from "fed" to "unfed" on a one-hour offset change.
  it('keeps the fed-before-training fixture unambiguous in the pinned zone', () => {
    const fuel = measureFuelTiming(LOGS, MEALS, 60, TODAY);
    expect(fuel.unfedLongSessions).toBe(0);
  });
});
