// How long a set took, estimated — no set is ever timed.
//
// The session's own clock (`total_seconds`) is the only measurement. Every
// reader that has to divide it — the body map's minutes, Stats, the goal
// chart's strength/hypertrophy split — prices a set here, so one session never
// splits two different ways. The numbers are the owner's (SET_TIME in
// app.config.ts); this file only decides which of them applies.
//
// A set used to be reps x 3 s whatever it was, which priced a paused back
// squat and a rear-delt fly the same per rep and ignored setup, sides, pauses
// and intent. Timed, distance and calorie sets keep their own conversions.

import { LOAD, SET_TIME, type MovementProfile, type RegionKey } from '@/app.config';
import { TRAINING } from '@/lib/coach/knowledge';
import { hasNotation } from '@/lib/notations';
import type { LogSet } from '@/lib/types';

export type MovementKind = keyof typeof SET_TIME.kinds;
export type SetIntent = keyof typeof SET_TIME.intent;

const LOWER: readonly RegionKey[] = ['glutes', 'hamstrings', 'quads', 'calves'];

/**
 * Which row of SET_TIME.kinds a movement takes, from what the taxonomy knows:
 * plyometric → ballistic; mostly trunk → core; one dominant region and not
 * whole-body → isolation; otherwise compound, lower or upper by where its
 * weight sits. An unresolved movement prices as compound upper, the middle row.
 */
export function movementKind(profile: MovementProfile | null): MovementKind {
  if (!profile) return 'upper';
  if (profile.modality === 'plyometric') return 'ballistic';
  const regions = Object.entries(profile.regions) as [RegionKey, number][];
  if (regions.length === 0) return 'upper';
  if ((profile.regions.core ?? 0) >= SET_TIME.coreShare) return 'core';
  const top = Math.max(...regions.map(([, w]) => w));
  if (!profile.systemic && top >= SET_TIME.isolationTopShare) return 'isolation';
  const lower = regions.filter(([r]) => LOWER.includes(r)).reduce((a, [, w]) => a + w, 0);
  return lower >= 0.5 ? 'lower' : 'upper';
}

/**
 * The intent a set's TIME is priced at. Coarser than coach/intent.ts on
 * purpose: this runs where no superset context exists, and the 6-7 rep middle
 * prices as hypertrophy (x1). A conditioning block is conditioning.
 */
export function timingIntent(set: LogSet, sectionKey?: string): SetIntent {
  if (sectionKey === 'conditioning') return 'conditioning';
  const reps = set.actual.reps;
  return reps != null && reps <= TRAINING.strengthReps.value ? 'strength' : 'hypertrophy';
}

/** Seconds of work in one completed set — time under load, no setup, no rest. */
export function setWorkSeconds(set: LogSet, profile: MovementProfile | null, sectionKey?: string): number {
  const a = set.actual;
  if (!a.completed) return 0;
  if (a.time != null) return a.time;
  if (a.distance != null) return (a.distance / (profile?.paceMpm ?? LOAD.metersPerMinute)) * 60;
  if (a.calories != null) return a.calories * LOAD.secondsPerCalorie;
  if (a.reps == null) return LOAD.fallbackSetMinutes * 60;
  const kind = SET_TIME.kinds[movementKind(profile)];
  const sides = set.notations?.includes('/side') ? 2 : 1;
  const perRep =
    kind.repSeconds +
    (hasNotation(set.notations, 'p') ? SET_TIME.pauseSecondsPerRep : 0) +
    (hasNotation(set.notations, 't') ? SET_TIME.tempoSecondsPerRep : 0);
  const effort = a.rpe != null && a.rpe >= SET_TIME.nearFailureRpe ? SET_TIME.nearFailureFactor : 1;
  const work = a.reps * sides * perRep * SET_TIME.intent[timingIntent(set, sectionKey)] * effort;
  return work + (sides > 1 ? SET_TIME.sideSwitchSeconds : 0);
}

/** Setup before the first rep. Only rep-counted sets carry it. */
export function setSetupSeconds(set: LogSet, profile: MovementProfile | null): number {
  const a = set.actual;
  if (!a.completed || a.reps == null || a.time != null || a.distance != null || a.calories != null) return 0;
  return SET_TIME.kinds[movementKind(profile)].setupSeconds;
}

/** What a set cost the session clock before its rest: setup + work. */
export function setClockSeconds(set: LogSet, profile: MovementProfile | null, sectionKey?: string): number {
  return setSetupSeconds(set, profile) + setWorkSeconds(set, profile, sectionKey);
}
