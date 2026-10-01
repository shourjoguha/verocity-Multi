// Which recent session a reported soreness most likely came from.
//
// The vibe check is taken at the START of a session, so the soreness it reports
// belongs to earlier work — and because it peaks 24-48h out (coach claim
// `recovery.domsPeak`), not necessarily to the session immediately before.
// Each candidate is scored by the scaled volume it put on the sore regions
// (`setVolume` × the movement's region weight — the same arithmetic as
// `regionVolume`, so runs and jumps count as well as lifts), times its lag
// weight in SORENESS.
//
// A guess, and surfaced as one: nothing here knows the eccentric share or how
// novel the work was, and the log holds dates, not hours.

import { SORE_AREAS, SORENESS, type RegionKey, type SoreAreaKey } from '@/app.config';
import { bwLoadFactor, romFactor, setVolume } from '@/lib/bodyLoad';
import { classifyMovement, type OverrideMap } from '@/lib/movementTaxonomy';
import { isSubroutine } from '@/lib/subroutine';
import type { VibeCheck, WorkoutLog } from '@/lib/types';

export interface MovementLoad {
  movement: string;
  load: number;
}

export interface SorenessCandidate {
  log: WorkoutLog;
  daysBefore: number;
  /** Load on the sore regions × lag weight. */
  score: number;
  /** What carried the load, heaviest first. */
  movements: MovementLoad[];
}

/** Area key → display label. */
export function soreLabel(k: SoreAreaKey): string {
  return SORE_AREAS[k]?.label ?? k;
}

/** Areas expanded to the muscle regions they are scored against, deduplicated. */
export function soreRegions(sore: VibeCheck['sore']): RegionKey[] {
  const out = new Set<RegionKey>();
  for (const k of sore ?? []) for (const r of SORE_AREAS[k]?.regions ?? []) out.add(r as RegionKey);
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
  return Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86_400_000);
}

/** Load each movement in a log put on `regions`, heaviest first. */
export function movementLoads(
  log: WorkoutLog,
  regions: RegionKey[],
  overrides: OverrideMap = {},
): MovementLoad[] {
  const byName = new Map<string, number>();
  for (const section of log.data?.sections ?? []) {
    for (const group of section.groups ?? []) {
      for (const item of group.items ?? []) {
        if (isSubroutine(item)) continue;
        const { profile } = classifyMovement(item.movement, { overrides });
        const weight = regions.reduce((acc, r) => acc + (profile.regions[r] ?? 0), 0);
        if (weight <= 0) continue;
        const rom = romFactor(profile);
        const bw = bwLoadFactor(profile);
        const volume = item.sets.reduce((acc, s) => acc + setVolume(s, undefined, rom, bw), 0);
        if (volume > 0) byName.set(item.movement, (byName.get(item.movement) ?? 0) + volume * weight);
      }
    }
  }
  return [...byName].map(([movement, load]) => ({ movement, load })).sort((a, b) => b.load - a.load);
}

/** Every done session in the lag window that loaded `regions`, best first. */
export function attributeRegions(
  target: WorkoutLog,
  logs: WorkoutLog[],
  regions: RegionKey[],
  overrides: OverrideMap = {},
): SorenessCandidate[] {
  if (regions.length === 0) return [];
  const out: SorenessCandidate[] = [];
  for (const log of logs) {
    if (log.id === target.id || log.status !== 'done') continue;
    const daysBefore = daysBetween(log.log_date, target.log_date);
    const lag = SORENESS.lagWeights[daysBefore];
    if (!lag) continue;
    const movements = movementLoads(log, regions, overrides);
    const load = movements.reduce((acc, m) => acc + m.load, 0);
    if (load > 0) out.push({ log, daysBefore, score: load * lag, movements });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Candidates ranked best-first, across every area the target reports. Empty
 * when it reports none — without one, every session in the window is equally
 * plausible and naming one would be invented precision.
 */
export function attributeSoreness(
  target: WorkoutLog,
  logs: WorkoutLog[],
  overrides: OverrideMap = {},
): SorenessCandidate[] {
  return attributeRegions(target, logs, soreRegions(target.data?.session?.vibe?.sore), overrides);
}

/** The leader plus every session that carried a real share of its load. */
export function likelySources(ranked: SorenessCandidate[]): SorenessCandidate[] {
  const [first] = ranked;
  if (!first) return [];
  return ranked.filter((c) => c.score >= first.score * SORENESS.contributorShare);
}

export interface AreaExplanation {
  area: SoreAreaKey;
  /** Contributors inside the cited peak window. Several means several loaded it. */
  peak: SorenessCandidate[];
  /** Sessions inside the peak window that did NOT load this area. */
  quietInPeak: WorkoutLog[];
  /** The best match outside the peak window, reported only when `peak` is empty. */
  tail: SorenessCandidate | null;
}

/** Calendar days back that an hours window covers: [24, 48] → [1, 2]. */
export function hoursToDays([lo, hi]: readonly [number, number]): number[] {
  const out: number[] = [];
  for (let d = Math.round(lo / 24); d <= Math.round(hi / 24); d += 1) out.push(d);
  return out;
}

/**
 * Per reported area: who loaded it inside the peak window, and who did not.
 * `peakDays` comes from the caller — the coach derives it from its cited claim,
 * so this module holds no threshold of its own.
 */
export function explainSoreness(
  target: WorkoutLog,
  logs: WorkoutLog[],
  peakDays: readonly number[],
  overrides: OverrideMap = {},
): AreaExplanation[] {
  const inPeak = (d: number) => peakDays.includes(d);
  const peakLogs = logs.filter(
    (l) => l.id !== target.id && l.status === 'done' && inPeak(daysBetween(l.log_date, target.log_date)),
  );
  return (target.data?.session?.vibe?.sore ?? []).map((area) => {
    const ranked = attributeRegions(target, logs, soreRegions([area]), overrides);
    const peak = likelySources(ranked.filter((c) => inPeak(c.daysBefore)));
    const loaded = new Set(ranked.filter((c) => inPeak(c.daysBefore)).map((c) => c.log.id));
    return {
      area,
      peak,
      quietInPeak: peakLogs.filter((l) => !loaded.has(l.id)),
      tail: peak.length ? null : (ranked.find((c) => !inPeak(c.daysBefore)) ?? null),
    };
  });
}
