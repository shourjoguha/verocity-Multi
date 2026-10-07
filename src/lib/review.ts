// The training review behind /app/review: one period of history — all time, the
// last quarter, or the life of one plan — reduced to the few figures and charts
// the review page draws.
//
// DETERMINISTIC ON PURPOSE. Every number here is measured from the logs by the
// same code the coach and the body map already use (`measureTraining`,
// `measureGoals`, `sessionLens`, `computePlanAdherence`); nothing is estimated
// by hand and no model writes any of it. The one-line headlines are templates
// over those numbers, so a headline can never say more than its chart shows.

import { LOAD_EQUIVALENCE, MUSCLE_REGIONS, RPE_LADDER, type BodyLensKey, type RegionKey } from '@/app.config';
import { sessionClockSeconds, sessionLens } from '@/lib/bodyLoad';
import { TRAINING as T } from '@/lib/coach/knowledge';
import { GOAL_MODALITIES, measureGoals, measureTraining, rpeWasRated, type GoalShare } from '@/lib/coach/signals';
import { classifyMovement, type OverrideMap } from '@/lib/movementTaxonomy';
import { computePlanAdherence, type PlanAdherence } from '@/lib/planAdherence';
import { e1rm } from '@/lib/e1rm';
import { hasNotation } from '@/lib/notations';
import { completedLogs, flattenWorkingSets, workingSections } from '@/lib/stats';
import { isSubroutine } from '@/lib/subroutine';
import { sessionTagColors } from '@/lib/tags';
import type { Plan, UserStats, WorkoutLog } from '@/lib/types';
import { unweightedRepKg } from '@/lib/userStats';

export type ReviewPeriod = { kind: 'all' } | { kind: 'quarter' } | { kind: 'plan'; planId: string };

/** Thirteen weeks: a quarter that always holds whole weeks. */
export const QUARTER_DAYS = 91;
/** A movement needs this many sessions in the window to count as a staple. */
export const STAPLE_MIN_SESSIONS = 3;
const STAPLE_LIMIT = 6;

export interface ReviewWindow {
  start: string;
  end: string;
  days: number;
  weeks: number;
  label: string;
  plan: Plan | null;
}

const DAY_MS = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const dayOf = (log: WorkoutLog) => log.log_date.slice(0, 10);
const addDays = (date: string, n: number) => ymd(new Date(Date.parse(date) + n * DAY_MS));
const daysInclusive = (start: string, end: string) =>
  Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS) + 1;

function shortDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Resolve a period to dates. A plan's window runs from its first logged session
 * (or its start date, if logging never began) to its last — or to today while it
 * is still active, so a plan in progress is not cut off at yesterday's session.
 * Null when the period holds nothing to review.
 */
export function reviewWindow(
  period: ReviewPeriod,
  logs: WorkoutLog[],
  plans: Plan[],
  today: Date,
): ReviewWindow | null {
  const done = completedLogs(logs);
  const end = ymd(today);
  const make = (start: string, stop: string, label: string, plan: Plan | null = null): ReviewWindow => {
    const days = Math.max(1, daysInclusive(start, stop));
    return { start, end: stop, days, weeks: days / 7, label, plan };
  };

  if (period.kind === 'quarter') {
    return make(addDays(end, -(QUARTER_DAYS - 1)), end, 'Last 13 weeks');
  }
  if (period.kind === 'all') {
    const first = done.map(dayOf).sort()[0];
    return first ? make(first, end, 'All time') : null;
  }

  const plan = plans.find((p) => p.id === period.planId);
  if (!plan) return null;
  const linked = done.filter((l) => l.plan_id === plan.id).map(dayOf).sort();
  const start = linked[0] ?? plan.start_date?.slice(0, 10);
  if (!start) return null;
  const stop = plan.is_active ? end : (linked[linked.length - 1] ?? start);
  return make(start, stop < start ? start : stop, plan.name, plan);
}

// --- the review ----------------------------------------------------------------

export interface CalendarDay {
  date: string;
  /** One colour per session, from its activity tags. */
  colors: string[];
  /** A letter per session, so the grid still reads without colour. */
  marks: string[];
  title: string;
  inWindow: boolean;
}

export interface CalendarWeek {
  start: string;
  days: CalendarDay[];
  lifts: number;
  active: number;
}

export interface EffortGroup {
  label: string;
  hard: number;
  total: number;
  sessions: number;
}

/** The set that best represents one session of a staple. */
export interface StapleSet {
  date: string;
  weight: number;
  reps: number;
  rpe: number | null;
  /** A paused or tempo set, credited LOAD_EQUIVALENCE.pauseTempo; null for a plain one. */
  held: '(p)' | '(t)' | null;
  /** Estimated 1RM from weight × reps (with pause credit), or null past the rep cap. */
  estimate: number | null;
  /** The same with reps-in-reserve added; null when the session was unrated. */
  rpeEstimate: number | null;
}

export interface Staple {
  movement: string;
  /** 'reps' for isometric work (a band or a light cable, where the number on
   *  the stack says little): compared on reps, with the same credit and RPE. */
  measure: '1rm' | 'reps';
  /** A (v) track: compared only with itself, from `since`. */
  variant: boolean;
  since: string;
  sessions: number;
  first: StapleSet;
  last: StapleSet;
  /** Change in estimated 1RM, as a fraction; null when either end has none. */
  change: number | null;
  /** Whether `change` used RPE — only when BOTH ends were rated sessions. */
  rpeAdjusted: boolean;
}

export interface Review {
  window: ReviewWindow;
  sessions: number;
  activeDays: number;
  activeDaysPerWeek: number;
  liftsPerWeek: number;
  /** Lifting days the plan's week template asks for; plan periods only. */
  plannedLiftsPerWeek: number | null;
  hours: number;
  /** Hours by what each session was mostly for — winner-take-all per session. */
  hoursByLens: Record<BodyLensKey | 'other', number>;
  calendar: CalendarWeek[];
  /** Goals the app can measure, with stated weight vs share of time. */
  goals: GoalShare[];
  /** Goals it cannot (free text, skill), named rather than scored as zero. */
  unmeasuredGoals: string[];
  regionSets: { key: RegionKey; label: string; perWeek: number }[];
  setFloor: number;
  effort: { hard: number; total: number; ratedSessions: number; unratedSessions: number; byGroup: EffortGroup[] };
  staples: Staple[];
  adherence: PlanAdherence | null;
}

export interface ReviewInput {
  logs: WorkoutLog[];
  plans: Plan[];
  stats: UserStats | null;
  overrides?: OverrideMap;
  today?: Date;
}

export function buildReview(period: ReviewPeriod, input: ReviewInput): Review | null {
  const today = input.today ?? new Date();
  const window = reviewWindow(period, input.logs, input.plans, today);
  if (!window) return null;
  const overrides = input.overrides ?? {};

  const inWindow = completedLogs(input.logs).filter((l) => {
    const d = dayOf(l);
    return d >= window.start && d <= window.end;
  });
  const planById = new Map(input.plans.map((p) => [p.id, p]));
  const dayLabel = (log: WorkoutLog): string | null =>
    log.plan_id && log.day_key
      ? (planById.get(log.plan_id)?.parsed.days.find((d) => d.dayKey === log.day_key)?.label ?? null)
      : null;

  // Hours and lifting sessions: each session belongs to the one kind of work it
  // mostly was (`sessionLens`), which is the question "what did the time go on".
  const hoursByLens: Review['hoursByLens'] = { strength: 0, cardio: 0, mobility: 0, other: 0 };
  const lensOf = new Map<string, BodyLensKey | null>();
  for (const log of inWindow) {
    const lens = sessionLens(log, overrides);
    lensOf.set(log.id, lens);
    hoursByLens[lens ?? 'other'] += sessionClockSeconds(log, overrides) / 3600;
  }
  const lifts = inWindow.filter((l) => lensOf.get(l.id) === 'strength').length;
  const activeDates = new Set(inWindow.map(dayOf));
  const hours = Object.values(hoursByLens).reduce((a, b) => a + b, 0);

  // Measured over the same window, ending on its last day. measureTraining has
  // no upper bound of its own, so the logs are cut at the window's end first.
  const training = measureTraining(
    input.logs.filter((l) => dayOf(l) <= window.end),
    {
      heavyFraction: T.strengthIntensity.value,
      strengthRepMax: T.strengthReps.value,
      hypertrophyReps: T.hypertrophyReps.value,
      nearFailureRpe: RPE_LADDER.nearFailure,
      allOutRpe: RPE_LADDER.allOut,
      heavyRestSeconds: T.strengthRest.value,
      overrides,
      unweightedKg: unweightedRepKg(input.stats),
    },
    new Date(`${window.end}T12:00:00Z`),
    window.days,
  );
  const goals = measureGoals(input.stats, training).value;
  const unmeasuredGoals = (input.stats?.goals ?? [])
    .filter((g) => g.weight > 0 && !GOAL_MODALITIES[g.id])
    .map((g) => g.label);

  const regionSets = (Object.keys(MUSCLE_REGIONS) as RegionKey[])
    .map((key) => ({ key, label: MUSCLE_REGIONS[key].label, perWeek: training.regionSetsPerWeek.value[key] }))
    .sort((a, b) => b.perWeek - a.perWeek);

  const plannedDays = window.plan ? window.plan.parsed.weeklyTemplate.length || window.plan.parsed.days.length : null;

  return {
    window,
    sessions: inWindow.length,
    activeDays: activeDates.size,
    activeDaysPerWeek: activeDates.size / window.weeks,
    liftsPerWeek: lifts / window.weeks,
    plannedLiftsPerWeek: plannedDays,
    hours,
    hoursByLens,
    calendar: buildCalendar(window, inWindow, lensOf, dayLabel),
    goals,
    unmeasuredGoals,
    regionSets,
    setFloor: T.hypertrophyWeeklySets.value,
    effort: measureEffort(inWindow, dayLabel),
    staples: findStaples(inWindow, overrides),
    adherence: window.plan
      ? // Measured to the window's end, so a finished plan reads its own
        // length rather than the weeks that have passed since it stopped.
        computePlanAdherence(window.plan.id, window.plan.parsed, input.logs, new Date(`${window.end}T12:00:00Z`), overrides)
      : null,
  };
}

// Monday-aligned weeks covering the window; days outside it render blank.
function buildCalendar(
  window: ReviewWindow,
  logs: WorkoutLog[],
  lensOf: Map<string, BodyLensKey | null>,
  dayLabel: (log: WorkoutLog) => string | null,
): CalendarWeek[] {
  const byDate = new Map<string, WorkoutLog[]>();
  for (const log of logs) byDate.set(dayOf(log), [...(byDate.get(dayOf(log)) ?? []), log]);

  const startDow = (new Date(window.start).getUTCDay() + 6) % 7;
  const weeks: CalendarWeek[] = [];
  for (let ws = addDays(window.start, -startDow); ws <= window.end; ws = addDays(ws, 7)) {
    const days: CalendarDay[] = [];
    let lifts = 0;
    let active = 0;
    for (let i = 0; i < 7; i++) {
      const date = addDays(ws, i);
      const dayLogs = byDate.get(date) ?? [];
      const names = dayLogs.map((l) => dayLabel(l) ?? l.activity_type ?? l.data?.sections?.[0]?.groups?.[0]?.items?.[0]?.movement ?? 'Session');
      if (dayLogs.length) active += 1;
      lifts += dayLogs.filter((l) => lensOf.get(l.id) === 'strength').length;
      days.push({
        date,
        colors: dayLogs.map((l) => sessionTagColors(l.tags ?? [], l.activity_type)[0]),
        marks: names.map((n) => n.charAt(0).toUpperCase()),
        title: dayLogs.length ? `${shortDate(date)} · ${names.join(', ')}` : shortDate(date),
        inWindow: date >= window.start && date <= window.end,
      });
    }
    weeks.push({ start: ws, days, lifts, active });
  }
  return weeks;
}

// Share of rated working sets at or above the near-failure mark, grouped by plan
// day. Sessions that never moved the RPE dial are missing data, not easy work
// (see rpeWasRated), so they are counted apart rather than averaged in.
function measureEffort(logs: WorkoutLog[], dayLabel: (log: WorkoutLog) => string | null): Review['effort'] {
  const groups = new Map<string, EffortGroup>();
  let hard = 0;
  let total = 0;
  let ratedSessions = 0;
  let unratedSessions = 0;
  for (const log of logs) {
    const sets = flattenWorkingSets(log).filter((s) => s.completed && s.rpe != null);
    if (sets.length === 0) continue;
    if (!rpeWasRated(log)) {
      unratedSessions += 1;
      continue;
    }
    ratedSessions += 1;
    const label = dayLabel(log) ?? 'Unplanned';
    const g = groups.get(label) ?? { label, hard: 0, total: 0, sessions: 0 };
    const h = sets.filter((s) => (s.rpe as number) >= RPE_LADDER.nearFailure).length;
    g.hard += h;
    g.total += sets.length;
    g.sessions += 1;
    groups.set(label, g);
    hard += h;
    total += sets.length;
  }
  const byGroup = [...groups.values()].sort((a, b) => b.hard / b.total - a.hard / a.total);
  return { hard, total, ratedSessions, unratedSessions, byGroup };
}

// Loaded movements done in enough sessions to have a trend, first session
// against latest, compared on estimated 1RM rather than raw kilos:
//   - reps count (Brzycki), and on a session that actually used the RPE dial so
//     do the reps left in the tank — 5 @8 is 7 to failure;
//   - a paused or tempo set is credited LOAD_EQUIVALENCE.pauseTempo;
//   - a (v) variation is its own track, never priced against the plain lift;
//   - isometric work (Pallof press: a band) is compared on reps, not load.
// Each session is represented by its best-estimated set.
function findStaples(logs: WorkoutLog[], overrides: OverrideMap = {}): Staple[] {
  const tracks = new Map<string, { name: string; variant: boolean; repsOnly: boolean; rows: StapleSet[] }>();
  const repsOnlyCache = new Map<string, boolean>();
  const isRepsOnly = (name: string) => {
    const key = name.trim().toLowerCase();
    if (!repsOnlyCache.has(key)) {
      repsOnlyCache.set(key, classifyMovement(name, { overrides }).profile.modality === 'isometric');
    }
    return repsOnlyCache.get(key) as boolean;
  };
  const ordered = [...logs].sort((a, b) => (a.log_date < b.log_date ? -1 : 1));
  for (const log of ordered) {
    const rated = rpeWasRated(log);
    const best = new Map<string, StapleSet>();
    for (const section of workingSections(log)) {
      for (const group of section.groups ?? []) {
        for (const item of group.items ?? []) {
          if (isSubroutine(item)) continue;
          for (const s of item.sets) {
            const { weight, reps, rpe, completed } = s.actual;
            if (!completed || weight == null || weight <= 0 || reps == null || reps < 1) continue;
            const variant = hasNotation(s.notations, 'v');
            const key = `${item.movement.trim().toLowerCase()}${variant ? '|v' : ''}`;
            const held = hasNotation(s.notations, 'p') ? '(p)' : hasNotation(s.notations, 't') ? '(t)' : null;
            const credit = held ? LOAD_EQUIVALENCE.pauseTempo : 1;
            const repsOnly = isRepsOnly(item.movement);
            const estimateAt = (n: number) =>
              repsOnly
                ? n * credit
                : n <= LOAD_EQUIVALENCE.maxEffectiveReps
                  ? (e1rm(weight, n) ?? 0) * credit || null
                  : null;
            const set: StapleSet = {
              date: dayOf(log),
              weight,
              reps,
              rpe: rated ? (rpe ?? null) : null,
              held,
              estimate: estimateAt(reps),
              rpeEstimate: rated && rpe != null ? estimateAt(reps + Math.max(0, 10 - rpe)) : null,
            };
            // The session's best set by weight × reps alone is the one shown, so
            // which set stands for a session never depends on its RPE. The
            // RPE-adjusted figure is the best across ALL its sets, so it does not
            // hang on whichever set happened to win a tie.
            const cur = best.get(key);
            const bestRpe = Math.max(cur?.rpeEstimate ?? 0, set.rpeEstimate ?? 0) || null;
            if (!cur || (set.estimate ?? 0) > (cur.estimate ?? 0) || (cur.estimate == null && set.estimate == null && weight > cur.weight)) {
              best.set(key, { ...set, rpeEstimate: bestRpe });
            } else {
              cur.rpeEstimate = bestRpe;
            }
            // Shown as the athlete last typed it.
            tracks.set(key, { name: item.movement.trim(), variant, repsOnly, rows: tracks.get(key)?.rows ?? [] });
          }
        }
      }
    }
    for (const [key, set] of best) tracks.get(key)!.rows.push(set);
  }
  return [...tracks.values()]
    .filter((t) => t.rows.length >= STAPLE_MIN_SESSIONS)
    .map((t): Staple => {
      const first = t.rows[0];
      const last = t.rows[t.rows.length - 1];
      // RPE only when both ends were rated: adding reps-in-reserve to one end
      // and not the other reads identical sets as progress.
      const rpeAdjusted = first.rpeEstimate != null && last.rpeEstimate != null;
      const a = rpeAdjusted ? first.rpeEstimate : first.estimate;
      const b = rpeAdjusted ? last.rpeEstimate : last.estimate;
      return {
        movement: t.name,
        measure: t.repsOnly ? 'reps' : '1rm',
        variant: t.variant,
        since: first.date,
        sessions: t.rows.length,
        first,
        last,
        change: a && b ? b / a - 1 : null,
        rpeAdjusted,
      };
    })
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, STAPLE_LIMIT);
}

// --- headlines -----------------------------------------------------------------

const pct = (n: number) => `${Math.round(n * 100)}%`;
const one = (n: number) => (Math.round(n * 10) / 10).toString();

/** The page's lead sentence: frequency against the plan, or on its own. */
export function frequencyHeadline(r: Review): string {
  const lifts = `${one(r.liftsPerWeek)} lifts a week`;
  return r.plannedLiftsPerWeek
    ? `${lifts} against a ${r.plannedLiftsPerWeek}-day plan, ${one(r.activeDaysPerWeek)} active days`
    : `${lifts}, ${one(r.activeDaysPerWeek)} active days a week`;
}

/** The widest goal gap, stated both ways, or null when there is nothing to compare. */
export function goalsHeadline(r: Review): string | null {
  if (r.goals.length < 2) return null;
  const widest = [...r.goals].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
  if (Math.abs(widest.gap) < 0.05) return 'Time split matches your goal weights within 5 points';
  return `${widest.label} gets ${pct(widest.actual)} of your time on ${pct(widest.intent)} of your goal weight`;
}

export function volumeHeadline(r: Review): string {
  const under = r.regionSets.filter((g) => g.perWeek < r.setFloor).map((g) => g.label);
  if (under.length === 0) return `Every muscle group clears ${r.setFloor} hard sets a week`;
  if (under.length === r.regionSets.length) return `No muscle group reaches ${r.setFloor} hard sets a week`;
  return `${listOf(under)} ${under.length === 1 ? 'sits' : 'sit'} under ${r.setFloor} hard sets a week`;
}

export function effortHeadline(r: Review): string | null {
  const e = r.effort;
  if (e.total === 0) return null;
  return `${pct(e.hard / e.total)} of rated sets at RPE ${RPE_LADDER.nearFailure}+`;
}

/** Under this change in estimated 1RM a staple reads as not having moved. */
export const STAPLE_FLAT = 0.01;

export function staplesHeadline(r: Review): string | null {
  const measured = r.staples.filter((s) => s.change != null);
  if (measured.length === 0) return null;
  const up = measured.filter((s) => (s.change as number) >= STAPLE_FLAT).length;
  const down = measured.filter((s) => (s.change as number) <= -STAPLE_FLAT).length;
  const flat = measured.length - up - down;
  if (up === measured.length) return 'Every staple lift moved up';
  const parts = [`${up} of ${measured.length} staple lifts moved up`];
  if (flat) parts.push(`${flat} held`);
  if (down) parts.push(`${down} dropped`);
  return parts.join(', ');
}

function listOf(items: string[]): string {
  return items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
