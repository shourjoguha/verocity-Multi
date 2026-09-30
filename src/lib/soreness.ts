// Which recent session a reported soreness most likely came from.
//
// The vibe check is taken at the START of a session, so the soreness it reports
// belongs to earlier work — and because DOMS peaks 24-72h out, not necessarily
// to the session immediately before. Each candidate in the lag window is scored
// by the scaled volume it put on the sore regions (`regionVolume`, which prices
// runs and jumps as well as lifts — a calf-sore morning after a long run has to
// be able to point at the run), times how well its lag fits the DOMS curve.
//
// A guess, and surfaced as one: nothing here knows the eccentric share or how
// novel the work was, which drive DOMS more than volume does.

import {
  MUSCLE_REGIONS,
  SORE_AREAS,
  SORENESS,
  type RegionKey,
  type SoreAreaKey,
} from '@/app.config';
import { summarizeBodyLoad } from '@/lib/bodyLoad';
import type { OverrideMap } from '@/lib/movementTaxonomy';
import type { VibeCheck, WorkoutLog } from '@/lib/types';

export interface SorenessCandidate {
  log: WorkoutLog;
  daysBefore: number;
  score: number;
}

const isArea = (k: string): k is SoreAreaKey => k in SORE_AREAS;

export function soreLabel(k: SoreAreaKey | RegionKey): string {
  return isArea(k) ? SORE_AREAS[k].label : (MUSCLE_REGIONS[k]?.short ?? k);
}

/** Coarse areas expanded to muscle regions, deduplicated. */
export function soreRegions(sore: VibeCheck['sore']): RegionKey[] {
  const out = new Set<RegionKey>();
  for (const k of sore ?? []) {
    if (isArea(k)) for (const r of SORE_AREAS[k].regions) out.add(r as RegionKey);
    else if (k in MUSCLE_REGIONS) out.add(k);
  }
  return [...out];
}

/** The dates that can hold a cause for soreness reported on `date`, inclusive. */
export function lagWindow(date: string): { from: string; to: string } {
  const shift = (days: number) =>
    new Date(Date.parse(date) - days * 86_400_000).toISOString().slice(0, 10);
  return { from: shift(SORENESS.maxLagDays), to: shift(1) };
}

/** Whole calendar days from `from` to `to`, both 'YYYY-MM-DD'. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/**
 * Candidates ranked best-first. Empty when the target reports no sore area —
 * without one, every session in the window is equally plausible and naming one
 * would be invented precision.
 */
export function attributeSoreness(
  target: WorkoutLog,
  logs: WorkoutLog[],
  overrides: OverrideMap = {},
): SorenessCandidate[] {
  const regions = soreRegions(target.data?.session?.vibe?.sore);
  if (regions.length === 0) return [];

  const out: SorenessCandidate[] = [];
  for (const log of logs) {
    if (log.id === target.id || log.status !== 'done') continue;
    const daysBefore = daysBetween(log.log_date, target.log_date);
    const lag = SORENESS.lagWeights[daysBefore];
    if (!lag) continue;
    const volume = summarizeBodyLoad([log], overrides).regionVolume;
    const load = regions.reduce((acc, r) => acc + volume[r], 0);
    if (load > 0) out.push({ log, daysBefore, score: load * lag });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** The leader, plus the runner-up when it is too close to call. */
export function likelySources(ranked: SorenessCandidate[]): SorenessCandidate[] {
  const [first, second] = ranked;
  if (!first) return [];
  return second && second.score >= first.score * SORENESS.ambiguousRatio ? [first, second] : [first];
}
