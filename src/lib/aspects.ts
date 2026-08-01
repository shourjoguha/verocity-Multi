// The fitness-profile radar (Stats spider chart), in two stages.
//
//   raw metrics (unit-ful, unbounded)  →  scores (1–10, relative to your history)
//        AspectMetrics                          AspectScores
//
// Keeping these apart is the whole point. The previous model went straight to an
// absolute clamped 1–10 built from hand-tuned constants ("~12 conditioning
// sessions reads as a 10"), so a committed user pinned every reachable axis at
// ASPECT_SCALE.max and the polygon stopped moving — see docs/LESSONS.md on the
// fixture that couldn't show a score change because it was already at the
// ceiling. Metrics are now compared against the distribution of *your own* past
// values for the same metric, through a logistic that is asymptotic rather than
// clamped, so the midpoint always means "typical for you" and there is always
// room to move in both directions.
//
// AspectMetrics is what gets persisted (aspect_snapshots.metrics). AspectScores
// is a presentation of a metric against a baseline and is never the source of
// truth — recomputing it from a longer baseline must be able to change it.

import {
  ACWR,
  ENDURANCE,
  ASPECT_GOOD_BASELINE,
  ASPECT_MIN_BASELINE,
  ASPECT_OVERRIDE_DAYS,
  ASPECT_SCALE,
  ASPECT_SOFTNESS,
  ASPECT_WINDOW_DAYS,
  FITNESS_ASPECTS,
  HR,
  PLANE_KEYS,
  RECOVERY,
  type AspectKey,
} from '@/app.config';
import { summarizeBodyLoad, summarizeTrainingVolume } from '@/lib/bodyLoad';
import type { OverrideMap } from '@/lib/movementTaxonomy';
import { bestE1rmByMovement } from '@/lib/prs';
import { completedLogs, flattenSets } from '@/lib/stats';
import type {
  AspectMetrics,
  AspectScores,
  AspectSnapshotInput,
  FitnessAssessment,
  WorkoutLog,
} from '@/lib/types';

export type AspectWindow = { start: string; end: string };

export type Confidence = 'low' | 'ok';
export type AspectBaselines = Partial<Record<AspectKey, number[]>>;

export interface AspectScoring {
  /** Raw measurements. Carries axes that have no baseline to be scored against. */
  metrics: AspectMetrics;
  scores: AspectScores;
  confidence: Partial<Record<AspectKey, Confidence>>;
}

export interface AspectMetricOptions {
  /** Inclusive ymd the window ends on. Anchors the ACWR sub-windows. */
  end: string;
  windowDays?: number;
  /** Max hr_max observed over a history wider than this window. */
  hrMaxRef?: number;
  overrides?: OverrideMap;
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

function shift(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

function parseYmd(s: string): Date {
  return new Date(`${s.slice(0, 10)}T00:00:00Z`);
}

/** Whole days from ymd `a` to ymd `b`. Negative when `a` is after `b`. */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86_400_000);
}

// The two blocks the radar compares: `current` ends on the given day, `prior` is
// the block immediately before it, both `days` long. Bounds are inclusive ymd
// strings (UTC) so they can be handed straight to getLogsInRange, and the caller
// passes the day in — the showcase anchors on a fixed date, not on now.
export function aspectWindows(
  today: Date,
  days: number = ASPECT_WINDOW_DAYS,
): { current: AspectWindow; prior: AspectWindow } {
  const end = ymd(today);
  const start = ymd(shift(today, -(days - 1)));
  return {
    current: { start, end },
    prior: { start: ymd(shift(today, -(days * 2 - 1))), end: ymd(shift(today, -days)) },
  };
}

// Inclusive date-bound filter — logs carry `log_date` as a ymd string, so this is
// a lexicographic compare, no Date parsing.
export function logsInWindow(logs: WorkoutLog[], w: AspectWindow): WorkoutLog[] {
  return logs.filter((l) => {
    const d = l.log_date.slice(0, 10);
    return d >= w.start && d <= w.end;
  });
}

/** A window of `days` ending inclusively on ymd `end`. */
export function windowEndingOn(end: string, days: number): AspectWindow {
  return { start: ymd(shift(parseYmd(end), -(days - 1))), end };
}

/**
 * Ends of the last `weeks` COMPLETED weeks, oldest first. Weeks run Monday to
 * Sunday, matching the rest of the app.
 *
 * Snapshots anchor to week ends rather than to "today minus N weeks" because the
 * upsert key is (owner, period_end, window_days): a period_end that drifted with
 * the current day would mint a new row on every visit instead of overwriting
 * one. The in-progress week is deliberately excluded — the live radar computes
 * its own current/prior windows and has no need to persist them.
 *
 * Weekly rather than monthly because it is what allowed the invented reference
 * values to be deleted: a real baseline now arrives in ~4 weeks, not ~4 months.
 */
export function completedWeekEnds(today: Date, weeks: number): string[] {
  const mondayIndex = (today.getUTCDay() + 6) % 7; // 0 = Monday
  const lastSunday = shift(today, -mondayIndex - 1);
  const out: string[] = [];
  for (let i = 0; i < weeks; i += 1) out.push(ymd(shift(lastSunday, -i * 7)));
  return out.reverse();
}

/**
 * Measure each period in `periodEnds` from `logs`, which must span every
 * period's window. Periods with no completed sessions are skipped — a month you
 * did not train is absent data, not a zero to score against.
 *
 * Scores accumulate progressively: each period is scored against the periods
 * before it (plus any `seed` metrics from snapshots already stored), which is
 * the closest a backfill can get to "what the radar would have drawn then".
 */
export function buildSnapshots(
  logs: WorkoutLog[],
  periodEnds: string[],
  opts: {
    windowDays?: number;
    hrMaxRef?: number;
    overrides?: OverrideMap;
    seed?: AspectMetrics[];
  } = {},
): AspectSnapshotInput[] {
  const windowDays = opts.windowDays ?? ASPECT_WINDOW_DAYS;
  const history: { metrics: AspectMetrics }[] = (opts.seed ?? []).map((metrics) => ({ metrics }));
  const out: AspectSnapshotInput[] = [];

  for (const end of periodEnds) {
    const window = windowEndingOn(end, windowDays);
    const metrics = computeAspectMetrics(logsInWindow(logs, window), {
      end,
      windowDays,
      hrMaxRef: opts.hrMaxRef,
      overrides: opts.overrides,
    });
    if (Object.keys(metrics).length === 0) continue;
    const { scores } = scoreAspects(metrics, buildBaselines(history));
    history.push({ metrics });
    out.push({ period_end: end, window_days: windowDays, metrics, scores });
  }
  return out;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// ---- stage 1: raw metrics ----

function workingMinutes(logs: WorkoutLog[], overrides: OverrideMap): number {
  return summarizeBodyLoad(logs, overrides).totalMinutes;
}

/** Did this session log an actual conditioning block, not just a tag? */
function hasConditioningBlock(log: WorkoutLog): boolean {
  return (log.data?.sections ?? []).some(
    (s) => s.key === 'conditioning' && s.groups.some((g) => g.items.length > 0),
  );
}

function observedHrMax(logs: WorkoutLog[]): number | null {
  let max: number | null = null;
  for (const l of logs) {
    if (l.hr_max != null && (max == null || l.hr_max > max)) max = l.hr_max;
  }
  return max;
}

/**
 * Measure one window. Every axis derives from logged data — `power` and
 * `mobility` included, via the movement taxonomy's plyometric/mobility
 * modalities, which is what stopped those two from going stale between
 * check-ins.
 *
 * Returns `{}` when the window holds no completed sessions. Otherwise every axis
 * the data can speak to is present, including as `0` — a genuine zero (you did
 * no plyometric work) is a measurement, and omitting it would collapse that
 * vertex to the centre where it reads identically to "no data".
 */
export function computeAspectMetrics(
  logs: WorkoutLog[],
  opts: AspectMetricOptions,
): AspectMetrics {
  const overrides = opts.overrides ?? {};
  const windowDays = opts.windowDays ?? ASPECT_WINDOW_DAYS;
  const weeks = windowDays / 7;
  const done = completedLogs(logs);
  if (done.length === 0) return {};

  const out: AspectMetrics = {};
  const load = summarizeBodyLoad(done, overrides);

  let totalSets = 0;
  let completedSets = 0;
  for (const log of done) {
    for (const s of flattenSets(log)) {
      totalSets += 1;
      if (s.completed) completedSets += 1;
    }
  }

  // Strength and power are both SCALED TRAINING VOLUME — how much work you did,
  // not how heavy a single best rep was. `setVolume` reads the parts of a set
  // that were previously thrown away: `/side` (reps are logged per side and
  // nothing doubled them), `(p)` paused reps, and RPE.
  //
  // Strength additionally weights each set by load relative to that movement's
  // own best e1RM. Without that, pure tonnage makes a peaking block read as a
  // strength *drop* — 5×10 @ 60kg outscores 5×3 @ 140kg — so the e1RM machinery
  // is kept, moved from being the metric to setting the intensity reference.
  // Power weights toward low-rep sets, or 20 sloppy box jumps would outrank 6
  // sharp ones.
  const volume = summarizeTrainingVolume(done, overrides, bestE1rmByMovement(done));
  out.strength = volume.modalityVolume.resistance / weeks;
  out.power = volume.modalityVolume.plyometric / weeks;

  // Endurance — three things that all mean "conditioning", in one number.
  const hrMaxRef = opts.hrMaxRef ?? observedHrMax(done) ?? HR.maxFallback;
  let aerobic = 0;
  let spread = 0;
  for (const log of done) {
    // 1. Aerobic work, weighted by how hard it was.
    const minutes = summarizeBodyLoad([log], overrides).modalityMinutes.endurance;
    if (minutes > 0) {
      const intensity =
        log.hr_avg != null && hrMaxRef > 0
          ? clamp01(log.hr_avg / hrMaxRef)
          : HR.defaultIntensity;
      aerobic += minutes * intensity;
    }

    // 2. Heart-rate spread. hr_max − hr_avg is the interval signature: it is the
    // only thing separating a threshold session from steady state at the same
    // average HR, and it was being discarded entirely. Scaled by session length
    // so a wide spread across an hour outweighs the same spread across ten
    // minutes, and boosted when a conditioning block was actually logged.
    if (log.hr_avg != null && log.hr_max != null && hrMaxRef > 0) {
      const ratio = clamp01((log.hr_max - log.hr_avg) / hrMaxRef);
      const sessionMinutes = (log.total_seconds ?? 0) / 60;
      const boost = hasConditioningBlock(log) ? ENDURANCE.conditioningBoost : 1;
      spread += ratio * sessionMinutes * boost;
    }
  }
  // 3. Dense strength work — high volume on short rests is conditioning.
  const density = volume.resistanceMinutes * volume.density * ENDURANCE.densityWeight;
  out.endurance = (aerobic + density + spread) / weeks;

  // Mobility — mobility minutes, rewarded for working outside the sagittal
  // plane. The scale factor sits in [1, 2] rather than multiplying by the share
  // directly, so a purely sagittal mobility practice still counts as work done.
  const planeTotal = PLANE_KEYS.reduce((acc, k) => acc + load.planeMinutes[k], 0);
  const nonSagittal =
    planeTotal > 0 ? (planeTotal - load.planeMinutes.sagittal) / planeTotal : 0;
  out.mobility = (load.modalityMinutes.mobility / weeks) * (1 + nonSagittal);

  // Consistency — showing up, not just finishing what you started. Adherence
  // alone scored one immaculate session in 60 days as a perfect 10.
  const days = new Set(done.map((l) => l.log_date.slice(0, 10)));
  const adherence = totalSets > 0 ? completedSets / totalSets : 0;
  out.consistency = (days.size / weeks) * adherence;

  // Recovery — self-rated vibe damped by training stress. ACWR (acute 7d load
  // against chronic 28d load) is the term that makes this axis move for a user
  // who never fills in the vibe check; it is also the only readout here that
  // says anything about ramping too fast.
  const vibes = done
    .map((l) => l.data?.session?.vibe)
    .filter((v): v is NonNullable<typeof v> => !!v);
  const vibeNorm =
    vibes.length > 0
      ? clamp01((mean(vibes.map((v) => (v.sleep + v.energy + (6 - v.soreness)) / 3)) - 1) / 4)
      : RECOVERY.neutralVibe;
  const acute =
    workingMinutes(logsInWindow(done, windowEndingOn(opts.end, ACWR.acuteDays)), overrides) /
    (ACWR.acuteDays / 7);
  const chronic =
    workingMinutes(logsInWindow(done, windowEndingOn(opts.end, ACWR.chronicDays)), overrides) /
    (ACWR.chronicDays / 7);
  const ratio = chronic > 0 ? acute / chronic : 1;
  const acwrPenalty = clamp01(1 - Math.max(0, ratio - ACWR.sweetMax) / ACWR.penaltySpan);
  out.recovery = vibeNorm * acwrPenalty;

  return out;
}

// ---- stage 2: relative scoring ----

const MID_SPAN = ASPECT_SCALE.max - ASPECT_SCALE.min;

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Logistic onto ASPECT_SCALE. Asymptotic, so a score approaches the bounds but
 *  never pins to them — which is what a clamp did, and why the chart went inert. */
function toScale(position: number): number {
  const raw = ASPECT_SCALE.min + MID_SPAN / (1 + Math.exp(-position));
  return Math.round(raw * 10) / 10;
}

/**
 * Place `value` on ASPECT_SCALE against the user's own history — a robust
 * z-score, median and MAD rather than mean and SD, because one deload week
 * should not drag the anchor. The median of your own history lands exactly
 * mid-scale, which is the only thing that makes "typical for you" a true claim.
 *
 * Returns **null** below ASPECT_MIN_BASELINE samples. There is deliberately no
 * absolute fallback: the previous version scored thin-history axes against
 * invented reference constants while the chart went on calling the midpoint
 * "typical for you", which was a claim the data could not support. An axis with
 * no baseline now reports no score, and the chart shows its raw measurement.
 */
export function scoreAgainstBaseline(
  value: number,
  baseline: number[],
): { score: number; confidence: Confidence } | null {
  const samples = baseline.filter((n) => Number.isFinite(n));
  if (samples.length < ASPECT_MIN_BASELINE) return null;

  const med = median(samples);
  // 1.4826 scales MAD to an SD-equivalent for a normal distribution.
  const dispersion = median(samples.map((n) => Math.abs(n - med))) * 1.4826;
  // A perfectly flat history has no spread to judge against — mid-scale is the
  // honest answer, and it keeps the divide from producing Infinity/NaN.
  const z = dispersion > 0 ? (value - med) / dispersion : 0;
  return {
    score: toScale(z / ASPECT_SOFTNESS.z),
    confidence: samples.length < ASPECT_GOOD_BASELINE ? 'low' : 'ok',
  };
}

/**
 * Score every measured axis that has a baseline to be scored against. Axes
 * absent from `metrics` stay absent; axes present but unscorable keep their raw
 * value in `metrics` and simply get no entry in `scores` — that is the signal
 * the chart reads to print a measurement instead of a rating.
 */
export function scoreAspects(
  metrics: AspectMetrics,
  baselines: AspectBaselines = {},
): AspectScoring {
  const scores: AspectScores = {};
  const confidence: Partial<Record<AspectKey, Confidence>> = {};
  for (const aspect of FITNESS_ASPECTS) {
    const key = aspect.key as AspectKey;
    const value = metrics[key];
    if (value == null || !Number.isFinite(value)) continue;
    const scored = scoreAgainstBaseline(value, baselines[key] ?? []);
    if (!scored) continue;
    scores[key] = scored.score;
    confidence[key] = scored.confidence;
  }
  return { metrics, scores, confidence };
}

/**
 * Baseline samples for ONE window length.
 *
 * The filter is the point, and it is load-bearing: a 28-day reading scored
 * against a distribution of 60-day readings would be silently and badly wrong on
 * every axis, with nothing on screen to give it away. `aspect_snapshots` keeps
 * the two series apart via `window_days`; this is where that separation is
 * enforced on the read side.
 */
export function baselinesFor(
  snapshots: { window_days: number; metrics: AspectMetrics }[],
  windowDays: number,
): AspectBaselines {
  return buildBaselines(snapshots.filter((s) => s.window_days === windowDays));
}

/** Collect per-axis baseline samples from stored snapshots. */
export function buildBaselines(snapshots: { metrics: AspectMetrics }[]): AspectBaselines {
  const out: AspectBaselines = {};
  for (const snapshot of snapshots) {
    for (const aspect of FITNESS_ASPECTS) {
      const key = aspect.key as AspectKey;
      const value = snapshot.metrics?.[key];
      if (value == null || !Number.isFinite(value)) continue;
      (out[key] ??= []).push(value);
    }
  }
  return out;
}

/**
 * A check-in overrides the derived scores for the axes it rated — but only while
 * it is fresh. Past ASPECT_OVERRIDE_DAYS before the window end the derived score
 * takes back over, so a rating from four months ago stops presenting itself as
 * current. `assessments` must be newest-first (`taken_at desc`, as queried).
 */
export function applyAssessmentOverride(
  scoring: AspectScoring,
  assessments: FitnessAssessment[],
  endDate: string,
  overrideDays: number = ASPECT_OVERRIDE_DAYS,
): AspectScoring {
  const rated = assessments.find((a) => a.taken_at.slice(0, 10) <= endDate);
  if (!rated) return scoring;
  if (daysBetween(rated.taken_at.slice(0, 10), endDate) > overrideDays) return scoring;

  const scores = { ...scoring.scores };
  const confidence = { ...scoring.confidence };
  for (const aspect of FITNESS_ASPECTS) {
    const key = aspect.key as AspectKey;
    const value = rated.scores[key];
    if (value == null) continue;
    scores[key] = value;
    // A rating the user typed is a statement, not an estimate from thin history.
    confidence[key] = 'ok';
  }
  return { metrics: scoring.metrics, scores, confidence };
}
