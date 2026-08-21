// Stage 1 of the coach: turn rows into measured numbers. No thresholds here and
// no judgements — this file must not import knowledge.ts.
//
// WHY MINUTES ARE THE DENOMINATOR EVERYWHERE. A goal-alignment rule wants "how
// much of your training went to endurance?", and the obvious answer — count
// sets — is wrong here in a way that is invisible on screen. Sessions logged
// through ActivityLogger (a 90-minute run, a 60-minute yoga class, a 48-minute
// ride) carry ONE set. Distributing by sets deletes almost all of the endurance
// and mobility work and manufactures a strength skew larger than reality, and
// it does so most severely for exactly the athlete whose goals prize that work.
//
// So every share in this file is a share of WORKING MINUTES, via
// summarizeBodyLoad. That is not a new exchange rate invented for the coach: it
// is LOAD.repSeconds / LOAD.metersPerMinute, already the currency of the body
// map and of the radar's endurance axis, already tested, and already the number
// the athlete sees elsewhere in the app. Sets still appear — but only for
// per-muscle resistance volume, where a set is the unit the evidence itself is
// stated in.

import {
  MODALITY_KEYS,
  MUSCLE_REGION_KEYS,
  type ModalityKey,
  type RegionKey,
} from '@/app.config';
import { summarizeBodyLoad } from '@/lib/bodyLoad';
import { bestE1rmByMovement } from '@/lib/prs';
import { completedLogs } from '@/lib/stats';
import { buildDayInsights, summarizeTiming, toHours } from '@/lib/mealInsights';
import type { OverrideMap } from '@/lib/movementTaxonomy';
import type { MealLog, UserStats, WorkoutLog } from '@/lib/types';
import { summarizeMealText, type MealTextSummary } from '@/lib/coach/mealText';
import type { Measured, Sufficiency } from '@/lib/coach/types';

// --- windowing -------------------------------------------------------------

/** Days of history every signal is measured over. Four weeks: long enough that
 *  a single missed session does not swing a weekly rate, short enough that a
 *  change of habit shows up while the athlete still remembers making it. */
export const COACH_WINDOW_DAYS = 28;

/** Below this, a session's `total_seconds` is treated as absent rather than as
 *  a short session. Real logs carry 0 and 203 from sessions that were started
 *  and abandoned; neither is five minutes of training. */
export const MIN_PLAUSIBLE_SESSION_MINUTES = 5;

/** Longest timed conditioning set still read as an interval bout rather than a
 *  steady-state block. Five minutes covers everything from a 20-second sprint to
 *  a San-Millán four-by-four and excludes a 45-minute ride logged as one set. */
export const MAX_BOUT_SECONDS = 300;

/** ISO-week key, e.g. '2026-W34'. The default `periodKey` for weekly rules. */
export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday of this week decides the year, per ISO-8601.
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function windowStart(today: Date, days: number): string {
  return ymd(new Date(today.getTime() - (days - 1) * 86_400_000));
}

// --- sufficiency -----------------------------------------------------------

/**
 * The one place a sample count becomes a verdict. `ok` needs the full floor,
 * `partial` needs two thirds of it, anything less is `insufficient` and the
 * rules that depend on it stay silent.
 */
export function rate(
  samples: number,
  floor: number,
  shortfall: string,
): { sufficiency: Sufficiency; shortfall?: string } {
  if (samples >= floor) return { sufficiency: 'ok' };
  if (samples >= Math.ceil(floor * (2 / 3))) return { sufficiency: 'partial', shortfall };
  return { sufficiency: 'insufficient', shortfall };
}

function measured<T>(value: T, samples: number, floor: number, shortfall: string): Measured<T> {
  return { value, samples, ...rate(samples, floor, shortfall) };
}

// --- training --------------------------------------------------------------

export interface TrainingSignals {
  windowDays: number;
  weeks: number;
  /** Completed sessions inside the window. */
  sessions: number;
  sessionsPerWeek: Measured<number>;
  /** Working minutes per week, by modality — the body-map currency. Excludes
   *  rest, so it is a measure of work done, NOT of time spent. */
  modalityMinutesPerWeek: Measured<Record<ModalityKey, number>>;
  /**
   * ELAPSED session minutes per week, by modality. The goal-alignment
   * denominator, and deliberately a different number from the line above.
   *
   * Working minutes are wrong for this question in a way the first probe of
   * this engine made obvious. `setMinutes` prices a set at reps x 3s, so an
   * hour of lifting yields ~20 working minutes while an hour on a bike yields
   * ~48 — all the rest between sets vanishes. Distributing goals by that unit
   * told an athlete who spends most of his gym time under a barbell that
   * endurance was taking 57% of his training, which is false about the only
   * resource a goal weight is really allocating: his time.
   *
   * So each session's own `total_seconds` is split across the modalities it
   * contained, in proportion to the working minutes inside it. An hour of
   * lifting is an hour of resistance; an hour of cycling is an hour of
   * endurance; a session that was half each splits half and half. Sessions with
   * no plausible elapsed time fall back to their working minutes rather than
   * being dropped, so a badly-logged session still counts as something.
   */
  sessionMinutesPerWeek: Measured<Record<ModalityKey, number>>;
  /** Hard resistance sets per week, per muscle region. Sets, because the
   *  hypertrophy evidence is stated in sets. */
  regionSetsPerWeek: Measured<Record<RegionKey, number>>;
  /**
   * How resistance sets distribute across the rep bands the evidence names.
   * Counted only over sets that recorded reps — a set with no rep count is
   * absent data, never a zero.
   */
  repBands: Measured<{ strength: number; blended: number; hypertrophy: number; endurance: number }>;
  /**
   * Of RESISTANCE sets that recorded both load and reps, the fraction loaded at
   * or above the strength threshold, measured against each movement's own best
   * e1RM in the window. A claim about intent, not about absolute strength.
   *
   * WHY ALL RESISTANCE SECTIONS AND NOT JUST `primary`. The first version of
   * this read the `primary` slot only, on the assumption that is where the main
   * lift lives. In real logs it is not: across a four-week window the `primary`
   * section held 17 sets of which 4 recorded load and reps, while `accessory`
   * held 144 sets with 117 loaded and `secondary` held the actual heavy work —
   * Back Squat to 100 kg on three-minute rests. Filtering to `primary` threw
   * away 142 of the 146 usable loaded sets and made the rule permanently
   * silent, which read as "nothing to say" rather than "looking in the wrong
   * place". Section is a layout choice in the logger, not a statement about
   * what the set was for; the load and the reps are the statement.
   */
  loadedIntensity: Measured<{
    atOrAboveHeavy: number;
    total: number;
    share: number;
    /**
     * Movement with the highest estimated 1RM in the window, and how its working
     * sets sat against it. NOT necessarily "the main lift" — a hip-thrust
     * machine outranks a back squat on raw e1RM — so callers must describe it as
     * what it is, the heaviest estimate, and never promote it to a claim about
     * programming priority.
     */
    topMovement: string | null;
    topMovementBestKg: number | null;
    topMovementMeanFraction: number | null;
  }>;
  /**
   * Mean RPE of sets landing in the hypertrophy rep band, and how many of them
   * reached the near-failure mark. The rep range is only half the prescription —
   * its cited caveat is that the set must be taken to or near failure — and RPE
   * is recorded on effectively every set in real logs, so this is measurable.
   */
  hypertrophyEffort: Measured<{ meanRpe: number; nearFailure: number; total: number }>;
  /**
   * Rest between sets on HEAVY low-rep work, where the evidence names a band.
   * `restSeconds` is the PRESCRIBED rest on the item or its group — the app
   * never records actual rest taken — so this reads intent, and rules must say
   * so rather than claiming to have timed anything.
   */
  heavyRest: Measured<{ meanSeconds: number; belowBand: number; total: number }>;
  /** Share of classified minutes the taxonomy could actually resolve, 0..1. */
  coverage: number;
  /** Sessions that logged a conditioning block AND a resistance block. */
  mixedSessions: number;
  /** Of those, how many put the conditioning block before the resistance work. */
  mixedConditioningFirst: number;
  /** Longest run of consecutive calendar days with a completed session. */
  longestConsecutiveDays: number;
  /**
   * Conditioning-block interval work: bouts, their length, and how hard they
   * actually went.
   *
   * The whole point is the last part. A log full of "Ski-Erg Intervals" looks
   * like VO2max work until you read the RPE — 30-second bouts at RPE 7 are not
   * the thing the 5-6 minutes-a-week prescription is about, and a rule counting
   * only minutes would congratulate the athlete for them. `allOutMinutes` counts
   * WORKING time in bouts that reached the all-out mark; `boutMinutes` counts
   * every timed bout, so a rule can say "you did the work, at the wrong
   * intensity" rather than "you did no intervals".
   */
  intervals: Measured<{
    bouts: number;
    boutMinutes: number;
    allOutBouts: number;
    allOutMinutes: number;
    meanBoutSeconds: number;
    meanRpe: number | null;
    /** Sessions that contained at least one timed conditioning bout. */
    sessions: number;
  }>;
  /**
   * Everything else the conditioning block recorded, so nothing logged goes
   * unread: distance, calories and time totals across conditioning work.
   */
  conditioning: {
    sets: number;
    minutes: number;
    distanceMeters: number;
    calories: number;
    /** Sets that recorded no metric at all beyond being completed. */
    bareSets: number;
  };
  /**
   * The vibe check — sleep, energy, soreness, 1-5 — averaged over sessions that
   * recorded one, plus the counts that make a rule possible. SYMPTOMS ONLY: see
   * READINESS in ../knowledge.ts on why this can never on its own support a
   * claim about overreaching.
   */
  readiness: Measured<{
    meanSleep: number;
    meanEnergy: number;
    meanSoreness: number;
    lowSleepSessions: number;
    highSorenessSessions: number;
    rated: number;
    /** Sessions with a vibe check / sessions in the window. */
    coverage: number;
  }>;
  /** Local clock hour each session started, for sessions that recorded one. */
  startHours: number[];
}

/** Fraction of 1RM at which a set is being treated as strength work. Passed in
 *  by the rule from the knowledge pack — signals never hold a threshold. */
export interface TrainingOptions {
  heavyFraction: number;
  /** RPE at or above which a conditioning bout reads as all-out. */
  allOutRpe: number;
  strengthRepMax: number;
  hypertrophyReps: [number, number];
  /** RPE at or above which a set reads as taken near failure. */
  nearFailureRpe: number;
  /** Seconds of rest the evidence puts under heavy low-rep work. */
  heavyRestSeconds: [number, number];
  overrides?: OverrideMap;
  unweightedKg?: number;
}

export function measureTraining(
  allLogs: WorkoutLog[],
  opts: TrainingOptions,
  today: Date = new Date(),
  windowDays: number = COACH_WINDOW_DAYS,
): TrainingSignals {
  const start = windowStart(today, windowDays);
  const logs = completedLogs(allLogs).filter((l) => l.log_date.slice(0, 10) >= start);
  const weeks = windowDays / 7;
  const overrides = opts.overrides ?? {};

  const body = summarizeBodyLoad(logs, overrides, { unweightedKg: opts.unweightedKg });

  const modalityPerWeek = Object.fromEntries(
    MODALITY_KEYS.map((k) => [k, body.modalityMinutes[k] / weeks]),
  ) as Record<ModalityKey, number>;
  const regionPerWeek = Object.fromEntries(
    MUSCLE_REGION_KEYS.map((k) => [k, body.resistanceSets[k] / weeks]),
  ) as Record<RegionKey, number>;

  // Rep bands and primary intensity need the raw sets, and need to know which
  // section a set came from — flattenSets drops `section`, so walk it here.
  // Elapsed-time attribution, per session. Uses summarizeBodyLoad on a
  // single-log array so the modality split is the SAME classification the body
  // map uses — no second, divergent classifier.
  const sessionMinutes = Object.fromEntries(MODALITY_KEYS.map((k) => [k, 0])) as Record<
    ModalityKey,
    number
  >;
  for (const log of logs) {
    const one = summarizeBodyLoad([log], overrides, { unweightedKg: opts.unweightedKg });
    const worked = MODALITY_KEYS.reduce((sum, k) => sum + one.modalityMinutes[k], 0);
    if (worked <= 0) continue;
    // Implausible elapsed times are ignored, not clamped: 0 and 203s both appear
    // in real data from abandoned sessions, and migration 0015 already caps the
    // top end at 7200. Below the floor the session's own working minutes are the
    // better estimate of how long it took.
    const elapsed = (log.total_seconds ?? 0) / 60;
    const total = elapsed >= MIN_PLAUSIBLE_SESSION_MINUTES ? elapsed : worked;
    for (const k of MODALITY_KEYS) {
      sessionMinutes[k] += (one.modalityMinutes[k] / worked) * total;
    }
  }
  const sessionPerWeek = Object.fromEntries(
    MODALITY_KEYS.map((k) => [k, sessionMinutes[k] / weeks]),
  ) as Record<ModalityKey, number>;

  const bests = bestE1rmByMovement(logs);
  const bands = { strength: 0, blended: 0, hypertrophy: 0, endurance: 0 };
  let bandTotal = 0;
  let heavy = 0;
  let loaded = 0;
  let hypRpeSum = 0;
  let hypRpeCount = 0;
  let hypNearFailure = 0;
  let heavyRestSum = 0;
  let heavyRestCount = 0;
  let heavyRestBelow = 0;
  const topFractions: number[] = [];
  let mixed = 0;
  let conditioningFirst = 0;

  // Conditioning: intervals plus every other metric the block recorded.
  let bouts = 0;
  let boutSeconds = 0;
  let allOutBouts = 0;
  let allOutSeconds = 0;
  let boutRpeSum = 0;
  let boutRpeCount = 0;
  const boutSessions = new Set<string>();
  let condSets = 0;
  let condSeconds = 0;
  let condDistance = 0;
  let condCalories = 0;
  let condBare = 0;

  // Vibe check — symptoms only.
  let sleepSum = 0;
  let energySum = 0;
  let sorenessSum = 0;
  let rated = 0;
  let lowSleep = 0;
  let highSoreness = 0;
  const startHours: number[] = [];

  // Highest estimated 1RM in the window, whichever section it was logged in.
  // Deliberately not called "the main lift" — see the note on the field.
  let topMovement: string | null = null;
  let topBest = 0;
  for (const [name, best] of bests) {
    if (best > topBest) {
      topBest = best;
      topMovement = name;
    }
  }

  for (const log of logs) {
    const sections = log.data?.sections ?? [];
    let sawResistance = false;
    let sawConditioning = false;
    let firstConditioningIdx = -1;
    let firstResistanceIdx = -1;

    sections.forEach((section, idx) => {
      const isConditioning = section.key === 'conditioning';
      const isResistance =
        section.key === 'primary' || section.key === 'secondary' || section.key === 'accessory';
      for (const group of section.groups ?? []) {
        for (const item of group.items ?? []) {
          if (item.kind === 'subroutine') continue;
          for (const set of item.sets ?? []) {
            const a = set.actual;
            if (!a.completed) continue;
            if (isConditioning) {
              if (!sawConditioning) {
                sawConditioning = true;
                firstConditioningIdx = idx;
              }
              condSets += 1;
              if (a.time != null) condSeconds += a.time;
              if (a.distance != null) condDistance += a.distance;
              if (a.calories != null) condCalories += a.calories;
              if (a.time == null && a.distance == null && a.calories == null && a.reps == null) {
                condBare += 1;
              }
              // A BOUT is a timed conditioning set short enough to be an
              // interval rather than a steady-state block. The upper bound is
              // this file's, not the corpus's — Galpin is explicit that bout
              // LENGTH does not matter, only the intensity reached — but a
              // 45-minute ride logged as one timed set is plainly not a bout,
              // and without a bound it would be counted as one.
              if (a.time != null && a.time > 0 && a.time <= MAX_BOUT_SECONDS) {
                bouts += 1;
                boutSeconds += a.time;
                boutSessions.add(log.id);
                if (a.rpe != null) {
                  boutRpeSum += a.rpe;
                  boutRpeCount += 1;
                  if (a.rpe >= opts.allOutRpe) {
                    allOutBouts += 1;
                    allOutSeconds += a.time;
                  }
                }
              }
            }
            if (isResistance) {
              if (!sawResistance) {
                sawResistance = true;
                firstResistanceIdx = idx;
              }
              const inHypBand =
                a.reps != null &&
                a.reps >= opts.hypertrophyReps[0] &&
                a.reps <= opts.hypertrophyReps[1];
              if (a.reps != null) {
                bandTotal += 1;
                if (a.reps <= opts.strengthRepMax) bands.strength += 1;
                else if (a.reps < opts.hypertrophyReps[0]) bands.blended += 1;
                else if (inHypBand) bands.hypertrophy += 1;
                else bands.endurance += 1;
              }
              if (inHypBand && a.rpe != null) {
                hypRpeSum += a.rpe;
                hypRpeCount += 1;
                if (a.rpe >= opts.nearFailureRpe) hypNearFailure += 1;
              }

              if (a.weight != null && a.reps != null) {
                const best = bests.get(item.movement);
                // No best for this movement means no denominator. Skipping is
                // the only honest read — assuming the set was light would
                // invent one.
                if (best != null && best > 0) {
                  loaded += 1;
                  const fraction = a.weight / best;
                  if (fraction >= opts.heavyFraction) heavy += 1;
                  if (item.movement === topMovement) topFractions.push(fraction);

                  // Rest is only interesting where the evidence names a band:
                  // heavy, low-rep work. `restSeconds` is PRESCRIBED — item
                  // first, then the group it sits in. Absent rest is absent
                  // data, never a zero.
                  const isHeavyLowRep =
                    fraction >= opts.heavyFraction && a.reps <= opts.strengthRepMax;
                  const rest = item.restSeconds ?? group.restSeconds ?? null;
                  if (isHeavyLowRep && rest != null && rest > 0) {
                    heavyRestSum += rest;
                    heavyRestCount += 1;
                    if (rest < opts.heavyRestSeconds[0]) heavyRestBelow += 1;
                  }
                }
              }
            }
          }
        }
      }
    });

    if (sawResistance && sawConditioning) {
      mixed += 1;
      if (firstConditioningIdx < firstResistanceIdx) conditioningFirst += 1;
    }

    const vibe = log.data?.session?.vibe;
    if (vibe) {
      rated += 1;
      sleepSum += vibe.sleep;
      energySum += vibe.energy;
      sorenessSum += vibe.soreness;
      // 1-5 scales. Two or below on sleep, four or above on soreness, are the
      // second-from-worst points on the athlete's OWN scale — the same shape of
      // read as `arrivingHungry`, and for the same reason: no external norm is
      // involved, so no citation is needed to state it.
      if (vibe.sleep <= 2) lowSleep += 1;
      if (vibe.soreness >= 4) highSoreness += 1;
    }
    if (log.started_at) {
      // LOCAL clock hour: the question is "did you train before breakfast?",
      // which is a wall-clock question, and meal_logs already stores wall clock.
      const d = new Date(log.started_at);
      startHours.push(d.getHours() + d.getMinutes() / 60);
    }
  }

  // Consecutive training days — the input to any fatigue read. Dates are ymd
  // strings so this is a sort plus a walk, no Date arithmetic per pair.
  const days = [...new Set(logs.map((l) => l.log_date.slice(0, 10)))].sort();
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of days) {
    const t = Date.parse(`${d}T00:00:00Z`) / 86_400_000;
    run = prev != null && t - prev === 1 ? run + 1 : 1;
    prev = t;
    if (run > longest) longest = run;
  }

  return {
    windowDays,
    weeks,
    sessions: logs.length,
    // Four sessions is the floor for a weekly rate over four weeks: below one a
    // week there is no rate, only a handful of events.
    sessionsPerWeek: measured(
      logs.length / weeks,
      logs.length,
      4,
      `only ${logs.length} sessions in the last ${windowDays} days`,
    ),
    modalityMinutesPerWeek: measured(
      modalityPerWeek,
      logs.length,
      6,
      'a modality split needs more sessions to be stable',
    ),
    sessionMinutesPerWeek: measured(
      sessionPerWeek,
      logs.length,
      6,
      'a training-time split needs more sessions to be stable',
    ),
    regionSetsPerWeek: measured(
      regionPerWeek,
      logs.length,
      6,
      'per-muscle set counts need more logged sessions',
    ),
    repBands: measured(
      bands,
      bandTotal,
      30,
      `only ${bandTotal} sets recorded a rep count`,
    ),
    loadedIntensity: measured(
      {
        atOrAboveHeavy: heavy,
        total: loaded,
        share: loaded ? heavy / loaded : 0,
        topMovement,
        topMovementBestKg: topMovement ? Math.round(topBest) : null,
        topMovementMeanFraction: topFractions.length
          ? topFractions.reduce((a, b) => a + b, 0) / topFractions.length
          : null,
      },
      loaded,
      20,
      `only ${loaded} resistance sets recorded both load and reps`,
    ),
    hypertrophyEffort: measured(
      {
        meanRpe: hypRpeCount ? hypRpeSum / hypRpeCount : 0,
        nearFailure: hypNearFailure,
        total: hypRpeCount,
      },
      hypRpeCount,
      25,
      `only ${hypRpeCount} sets in the hypertrophy rep range recorded an RPE`,
    ),
    heavyRest: measured(
      {
        meanSeconds: heavyRestCount ? heavyRestSum / heavyRestCount : 0,
        belowBand: heavyRestBelow,
        total: heavyRestCount,
      },
      heavyRestCount,
      8,
      `only ${heavyRestCount} heavy low-rep sets carried a prescribed rest`,
    ),
    coverage: body.coverage,
    mixedSessions: mixed,
    mixedConditioningFirst: conditioningFirst,
    longestConsecutiveDays: longest,
    intervals: measured(
      {
        bouts,
        boutMinutes: boutSeconds / 60,
        allOutBouts,
        allOutMinutes: allOutSeconds / 60,
        meanBoutSeconds: bouts ? boutSeconds / bouts : 0,
        meanRpe: boutRpeCount ? boutRpeSum / boutRpeCount : null,
        sessions: boutSessions.size,
      },
      bouts,
      6,
      `only ${bouts} timed conditioning bouts in the last ${windowDays} days`,
    ),
    conditioning: {
      sets: condSets,
      minutes: condSeconds / 60,
      distanceMeters: condDistance,
      calories: condCalories,
      bareSets: condBare,
    },
    readiness: measured(
      {
        meanSleep: rated ? sleepSum / rated : 0,
        meanEnergy: rated ? energySum / rated : 0,
        meanSoreness: rated ? sorenessSum / rated : 0,
        lowSleepSessions: lowSleep,
        highSorenessSessions: highSoreness,
        rated,
        coverage: logs.length ? rated / logs.length : 0,
      },
      rated,
      6,
      `only ${rated} of ${logs.length} sessions recorded a vibe check`,
    ),
    startHours,
  };
}

// --- goals -----------------------------------------------------------------

export interface GoalShare {
  id: string;
  label: string;
  /** Stated weight, renormalised so the goals sum to 1. */
  intent: number;
  /** Share of working minutes that went to the modalities this goal maps to. */
  actual: number;
  /** actual − intent. Negative means underserved. */
  gap: number;
}

/**
 * Goal id → the modalities that serve it.
 *
 * This mapping is a PRODUCT decision, not a claim from the corpus, which is why
 * it lives here and not in knowledge.ts. It is deliberately many-to-one and
 * lossy: `skill` has no modality at all and is excluded rather than guessed at,
 * because the taxonomy has no notion of skill work and pretending otherwise
 * would let a rule accuse the athlete of neglecting something the app cannot
 * see. Free-text goals (uuid ids) are likewise excluded — an unrecognised goal
 * is not a zero.
 */
export const GOAL_MODALITIES: Record<string, ModalityKey[]> = {
  strength: ['resistance'],
  hypertrophy: ['resistance'],
  endurance: ['endurance'],
  mobility: ['mobility'],
};

export function measureGoals(
  stats: UserStats | null,
  training: TrainingSignals,
): Measured<GoalShare[]> {
  const goals = (stats?.goals ?? []).filter((g) => GOAL_MODALITIES[g.id] && g.weight > 0);
  // Elapsed, not working — see the note on sessionMinutesPerWeek.
  const minutes = training.sessionMinutesPerWeek.value;

  // Strength and hypertrophy both map to resistance, so the actual shares would
  // double-count it. Split the modality's minutes across the goals claiming it,
  // in proportion to their stated weights — the athlete's own ranking is the
  // only defensible splitter, and it keeps sum(actual) === 1.
  const weightTotal = goals.reduce((s, g) => s + g.weight, 0);
  const claimants = new Map<ModalityKey, number>();
  for (const g of goals) {
    for (const m of GOAL_MODALITIES[g.id]) claimants.set(m, (claimants.get(m) ?? 0) + g.weight);
  }

  const servedMinutes = [...claimants.keys()].reduce((s, m) => s + minutes[m], 0);

  const shares: GoalShare[] = goals.map((g) => {
    const intent = weightTotal ? g.weight / weightTotal : 0;
    const actual = servedMinutes
      ? GOAL_MODALITIES[g.id].reduce(
          (s, m) => s + (minutes[m] * (g.weight / (claimants.get(m) as number))) / servedMinutes,
          0,
        )
      : 0;
    return { id: g.id, label: g.label, intent, actual, gap: actual - intent };
  });

  return {
    value: shares,
    samples: training.sessions,
    ...rate(
      goals.length >= 2 ? training.sessions : 0,
      6,
      goals.length < 2
        ? 'set at least two goals in Settings so the split has something to compare'
        : 'a training split needs more logged sessions to be stable',
    ),
  };
}

// --- nutrition -------------------------------------------------------------

export interface NutritionSignals {
  daysLogged: number;
  mealsPerDay: Measured<number>;
  /** Mean clock hour of the first and last intake of a day, and the span. */
  firstMealHour: Measured<number>;
  lastMealHour: Measured<number>;
  eatingWindowHours: Measured<number>;
  /** Days whose last intake landed at or after 21:00. */
  lateNights: number;
  /** Longest gap between consecutive intakes within a day, averaged over days. */
  meanLongestGapHours: Measured<number>;
  /** Share of MEALS (not snacks) carrying the protein tag. Style, never dose. */
  proteinTaggedShare: Measured<number>;
  /** Mean count of protein-tagged intakes per day. */
  proteinFeedsPerDay: Measured<number>;
  /** Mean hunger 1–5 immediately before eating. High means long gaps. */
  meanHungerBefore: Measured<number>;
  /** Share of intakes not prepared at home. */
  awayShare: Measured<number>;
  /** Training days in the window that recorded any intake after the session. */
  trainingDays: number;
  trainingDaysFuelled: number;
  /** What the free-text notes named. Descriptive only — see ./mealText.ts. */
  text: MealTextSummary;
  /**
   * Meals whose `tag_mix` was actually filled in, and the mean protein share
   * across those. A COMPOSITION the athlete dragged sliders to set, never a
   * measurement — no gram follows from it, and no rule may treat it as one.
   */
  mixCoverage: number;
  meanProteinMixPct: number | null;
}

/**
 * Where sessions sit relative to meals — the one question neither log can answer
 * alone.
 *
 * `workout_logs.started_at` is an absolute instant and `meal_logs.eaten_time` is
 * a wall-clock reading, so this compares them in LOCAL clock hours. That is the
 * right frame and not merely the convenient one: migration 0032 chose wall clock
 * for meals precisely because "do I eat late?" and "did I train before
 * breakfast?" are wall-clock questions, and converting either side to an instant
 * would answer a different one.
 *
 * Sessions with no `started_at` are skipped rather than assumed — roughly a
 * fifth of real rows have none, and placing them at noon would invent the very
 * fact being measured.
 */
export interface FuelTimingSignals {
  /** Training days where BOTH a start time and that day's meals are known. */
  pairedDays: number;
  /** Of those, days with no intake logged before the session started. */
  unfedSessions: number;
  /** Unfed sessions that also ran past the duration the evidence cares about. */
  unfedLongSessions: number;
  /** Mean hours from the last pre-session intake to the session start. */
  meanHoursSincePreMeal: number | null;
  /** Mean hours from session start to the next intake after it. */
  meanHoursToPostMeal: number | null;
  /** Days where nothing at all was logged after the session. */
  daysWithNoPostMeal: number;
  meanStartHour: number | null;
}

export function measureFuelTiming(
  allLogs: WorkoutLog[],
  allMeals: MealLog[],
  longSessionMinutes: number,
  today: Date = new Date(),
  windowDays: number = COACH_WINDOW_DAYS,
): FuelTimingSignals {
  const start = windowStart(today, windowDays);
  const logs = completedLogs(allLogs).filter(
    (l) => l.log_date.slice(0, 10) >= start && l.started_at != null,
  );
  const mealsByDay = new Map<string, number[]>();
  for (const m of allMeals) {
    if (m.log_date < start) continue;
    mealsByDay.set(m.log_date, [...(mealsByDay.get(m.log_date) ?? []), toHours(m.eaten_time)]);
  }

  let paired = 0;
  let unfed = 0;
  let unfedLong = 0;
  let noPost = 0;
  const preGaps: number[] = [];
  const postGaps: number[] = [];
  const starts: number[] = [];

  for (const log of logs) {
    const day = log.log_date.slice(0, 10);
    const hours = mealsByDay.get(day);
    const d = new Date(log.started_at as string);
    const startHour = d.getHours() + d.getMinutes() / 60;
    starts.push(startHour);
    // No meals logged that day is absent data, not a fasted session. Only a day
    // the athlete DID log meals can tell us whether they ate before training.
    if (!hours || hours.length === 0) continue;
    paired += 1;

    const before = hours.filter((h) => h <= startHour);
    const after = hours.filter((h) => h > startHour);
    if (before.length === 0) {
      unfed += 1;
      if ((log.total_seconds ?? 0) / 60 >= longSessionMinutes) unfedLong += 1;
    } else {
      preGaps.push(startHour - Math.max(...before));
    }
    if (after.length === 0) noPost += 1;
    else postGaps.push(Math.min(...after) - startHour);
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    pairedDays: paired,
    unfedSessions: unfed,
    unfedLongSessions: unfedLong,
    meanHoursSincePreMeal: mean(preGaps),
    meanHoursToPostMeal: mean(postGaps),
    daysWithNoPostMeal: noPost,
    meanStartHour: mean(starts),
  };
}

export function measureNutrition(
  allMeals: MealLog[],
  allLogs: WorkoutLog[],
  today: Date = new Date(),
  windowDays: number = COACH_WINDOW_DAYS,
): NutritionSignals {
  const start = windowStart(today, windowDays);
  const meals = allMeals.filter((m) => m.log_date >= start);
  const days = buildDayInsights(meals, windowDays);
  const withMeals = days.filter((d) => d.meals.length > 0);
  const n = withMeals.length;
  const timing = summarizeTiming(days);

  // Nine days is two thirds of the fourteen a timing habit needs to read as a
  // habit rather than a fortnight's weather. Both numbers are product judgement
  // and neither is in the corpus — they gate the rules, they are not thresholds
  // the rules test against.
  const DAY_FLOOR = 14;
  const short = `only ${n} days of meals logged in the last ${windowDays}`;
  const m = <T>(v: T) => measured(v, n, DAY_FLOOR, short);

  const gaps = withMeals.map((d) => {
    const hours = d.meals.map((x) => toHours(x.eaten_time)).sort((a, b) => a - b);
    let longest = 0;
    for (let i = 1; i < hours.length; i += 1) longest = Math.max(longest, hours[i] - hours[i - 1]);
    return longest;
  });
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  const realMeals = meals.filter((x) => x.kind === 'meal');
  const mixed = meals.filter((x) => x.tag_mix != null && Object.keys(x.tag_mix).length > 0);
  const proteinMeals = realMeals.filter((x) => x.tags.includes('protein'));
  const proteinAll = meals.filter((x) => x.tags.includes('protein'));

  // Post-session intake. `ended_at` is often null (ActivityLogger and older
  // rows), so this asks the weaker but answerable question — did anything get
  // logged at all on a day that was trained, after the median training hour of
  // 18:00 — rather than inventing a session end time.
  const trainedDays = new Set(
    completedLogs(allLogs)
      .map((l) => l.log_date.slice(0, 10))
      .filter((d) => d >= start),
  );
  let fuelled = 0;
  for (const d of withMeals) {
    if (!trainedDays.has(d.date)) continue;
    if (d.meals.some((x) => toHours(x.eaten_time) >= 12)) fuelled += 1;
  }

  return {
    daysLogged: n,
    mealsPerDay: m(Number(timing.mealsPerDay)),
    firstMealHour: m(mean(withMeals.map((d) => toHours(d.firstMeal as string)))),
    lastMealHour: m(mean(withMeals.map((d) => toHours(d.lastMeal as string)))),
    eatingWindowHours: m(
      mean(
        withMeals.map((d) => toHours(d.lastMeal as string) - toHours(d.firstMeal as string)),
      ),
    ),
    lateNights: timing.lateNights,
    meanLongestGapHours: m(mean(gaps)),
    proteinTaggedShare: measured(
      realMeals.length ? proteinMeals.length / realMeals.length : 0,
      realMeals.length,
      20,
      `only ${realMeals.length} meals logged in the last ${windowDays} days`,
    ),
    proteinFeedsPerDay: m(n ? proteinAll.length / n : 0),
    meanHungerBefore: m(timing.hungerBefore),
    awayShare: measured(
      meals.length ? meals.filter((x) => x.source !== 'home').length / meals.length : 0,
      meals.length,
      20,
      short,
    ),
    trainingDays: withMeals.filter((d) => trainedDays.has(d.date)).length,
    trainingDaysFuelled: fuelled,
    text: summarizeMealText(meals),
    mixCoverage: meals.length ? mixed.length / meals.length : 0,
    meanProteinMixPct: mixed.length
      ? mixed.reduce((sum, m) => sum + (Number(m.tag_mix?.protein) || 0), 0) / mixed.length
      : null,
  };
}
