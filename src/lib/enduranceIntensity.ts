// How hard endurance minutes were, Light or Hard — ENDURANCE_INTENSITY in
// app.config.ts holds the owner's numbers and the reasoning.
//
// Two hours of tennis and a 20-minute finisher circuit both serve endurance and
// are not the same work: tennis is light to moderate and carries its own
// warm-up; a circuit after lifting is hard and starts warm. The goal chart keeps
// counting minutes (one unit across every goal) and shows how many were hard.

import { ALL_OUT_HR, ENDURANCE_INTENSITY, RPE } from '@/app.config';
import type { LogItem, LogSet, WorkoutLog } from '@/lib/types';

export type EnduranceKind = keyof typeof ENDURANCE_INTENSITY.defaults;

/**
 * The athlete's own max heart rate reference: the highest hr_max ever logged,
 * once enough sessions carry one for it to be a reference rather than a single
 * reading. Null otherwise — the HR channel then says nothing.
 */
export function observedPeakHr(allLogs: WorkoutLog[]): number | null {
  const readings = allLogs.map((l) => l.hr_max).filter((v): v is number => v != null && v > 0);
  if (readings.length < ALL_OUT_HR.minSessionsForPeak) return null;
  return Math.max(...readings);
}

/** Effort from heart rate, by % of heart-rate reserve. Null without all three
 *  numbers, or when they do not make a reserve (peak at or under resting). */
export function rpeFromHeartRate(
  avg: number | null | undefined,
  resting: number | null | undefined,
  peak: number | null | undefined,
): { rpe: number; zone: number; reserve: number } | null {
  if (avg == null || resting == null || peak == null || peak <= resting || avg <= 0) return null;
  const reserve = (avg - resting) / (peak - resting);
  const z = ENDURANCE_INTENSITY.hrZones.find((b) => reserve >= b.fromReserve) ?? ENDURANCE_INTENSITY.hrZones.at(-1)!;
  return { rpe: z.rpe, zone: z.zone, reserve };
}

/** An RPE the athlete actually chose, not the logger's carried-over default. */
export function ratedRpe(set: LogSet): number | null {
  const a = set.actual;
  if (!a.completed || a.rpe == null) return null;
  const rated = a.rpeRated ?? a.rpe !== RPE.default;
  return rated ? a.rpe : null;
}

/** A session logged through the activity logger (tennis, a run, a class). */
export const isActivity = (log: WorkoutLog): boolean => log.activity_type != null && log.activity_type !== '';

const BOUT_SECONDS = 5 * 60;

/** The kind of endurance work an item was, for its default intensity. */
export function enduranceKind(log: WorkoutLog, item: LogItem, sectionKey: string): EnduranceKind {
  const tags = log.tags ?? [];
  if (!isActivity(log) && sectionKey === 'conditioning') return 'circuit';
  if (tags.includes('sport')) return 'sport';
  if (tags.includes('hyrox') || tags.includes('crossfit')) return 'circuit';
  const done = item.sets.filter((s) => s.actual.completed);
  if (done.length >= 3 && done.every((s) => (s.actual.time ?? Infinity) <= BOUT_SECONDS)) return 'intervals';
  return 'steady';
}

/**
 * Intensity of one item's minutes: the mean RPE the athlete rated, else — for
 * an activity only, never a finisher inside a lifting session, whose heart rate
 * is the whole session's — the heart-rate estimate, else the kind's default.
 */
export function itemIntensity(
  log: WorkoutLog,
  item: LogItem,
  sectionKey: string,
  hr: { resting: number | null; peak: number | null },
): number {
  const rated = item.sets.map(ratedRpe).filter((v): v is number => v != null);
  if (rated.length) return rated.reduce((a, b) => a + b, 0) / rated.length;
  if (isActivity(log)) {
    const fromHr = rpeFromHeartRate(log.hr_avg, hr.resting, hr.peak);
    if (fromHr) return fromHr.rpe;
  }
  return ENDURANCE_INTENSITY.defaults[enduranceKind(log, item, sectionKey)];
}
