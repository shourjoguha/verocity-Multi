// What the coach page says about a finding's PAST: the drift series behind it
// and a one-word reading of its direction.
//
// DISPLAY ONLY. This module labels; it never gates and never sorts. `impact.ts`
// is the only sort on the page and `recurrence.ts` the only gate on what may
// speak (CLAUDE.md: "Do not let a fourth number order the page"). The labels
// reuse recurrence's own constants so the page cannot describe a rule as
// "improving" by a different yardstick than the one that decided to quiet it.

import type { CoachObservation } from '@/lib/types';
import {
  driftSlope,
  PERSISTENCE_FLAT_SLOPE,
  REGRESSION_DELTA,
  RESOLUTION_FLOOR,
  type Reading,
} from '@/lib/coach/recurrence';

/** How many check-ins a row draws. Eight fits a phone row at ≥24px per bar. */
export const TRAJECTORY_POINTS = 8;

export type TrajectoryLabel = 'new' | 'came-back' | 'persisting' | 'improving' | 'resolving';

/** Per-rule readings, oldest first, from the athlete's own observation rows. */
export function readingsByRule(obs: readonly CoachObservation[]): Map<string, Reading[]> {
  const out = new Map<string, Reading[]>();
  const sorted = [...obs].sort((a, b) => a.observed_on.localeCompare(b.observed_on));
  for (const o of sorted) {
    const list = out.get(o.rule_id) ?? [];
    list.push({ observedOn: o.observed_on, drift: o.drift, fired: o.fired });
    out.set(o.rule_id, list);
  }
  return out;
}

/**
 * Several rules as one series, one point per check-in day, at the WORST member
 * that day — the same "a group is as urgent as its worst member" call
 * CoachView's partition makes for ranking. A day fires if any member fired.
 */
export function mergeSeries(series: readonly (readonly Reading[])[]): Reading[] {
  const byDay = new Map<string, Reading>();
  for (const s of series) {
    for (const r of s) {
      const prev = byDay.get(r.observedOn);
      byDay.set(
        r.observedOn,
        prev
          ? { observedOn: r.observedOn, drift: Math.max(prev.drift, r.drift), fired: prev.fired || r.fired }
          : { ...r },
      );
    }
  }
  return [...byDay.values()].sort((a, b) => a.observedOn.localeCompare(b.observedOn));
}

/**
 * One word for the direction of a series.
 *
 * Order mirrors recurrence(): clean beats relapse beats persistence. Relapse is
 * measured from the athlete's own best BEFORE the latest reading, exactly as
 * recurrence() measures it, so "came back" here and 'regressing' there cannot
 * disagree about the same numbers.
 */
export function trajectoryLabel(series: readonly Reading[]): TrajectoryLabel | null {
  if (series.length === 0) return null;
  const last = series[series.length - 1];
  if (series.length === 1) return last.drift > RESOLUTION_FLOOR ? 'new' : null;
  if (last.drift <= RESOLUTION_FLOOR) return 'resolving';
  const best = Math.min(...series.slice(0, -1).map((r) => r.drift));
  if (Math.round((last.drift - best) * 100) / 100 >= REGRESSION_DELTA) return 'came-back';
  const slope = driftSlope(series);
  if (slope != null && slope <= PERSISTENCE_FLAT_SLOPE) return 'improving';
  return 'persisting';
}

export interface CheckinDelta {
  /** The latest check-in day, 'YYYY-MM-DD'. */
  on: string;
  fresh: number;
  still: number;
  cleared: number;
}

/**
 * What changed between the last two check-in days, from `fired` alone.
 *
 * The toast used to be the only place this was said, and it was gone in four
 * seconds. Derived rather than stored: `coach_observations` already records
 * whether each rule fired on each day, so the summary needs no new column.
 * Null until there are two check-in days to compare.
 */
export function checkinDelta(obs: readonly CoachObservation[]): CheckinDelta | null {
  const days = [...new Set(obs.map((o) => o.observed_on))].sort();
  if (days.length < 2) return null;
  const [prevDay, lastDay] = days.slice(-2);
  const firedOn = (day: string) =>
    new Set(obs.filter((o) => o.observed_on === day && o.fired).map((o) => o.rule_id));
  const prev = firedOn(prevDay);
  const last = firedOn(lastDay);
  let fresh = 0;
  let still = 0;
  for (const r of last) {
    if (prev.has(r)) still += 1;
    else fresh += 1;
  }
  const cleared = [...prev].filter((r) => !last.has(r)).length;
  return { on: lastDay, fresh, still, cleared };
}
