// CONDITIONING LOAD — what a conditioning block cost, in RPE·min.
//
// Working time x effort, per set: the session-RPE idea (Foster) applied set by
// set, because sets here carry their own RPE. It is the Stats cardio lane's
// currency, replacing kg.m there.
//
// WHY NOT kg.m. Mechanical work answers "how much was moved", and on that a
// heavy sled will always dwarf an erg: one athlete's 20 m pushes priced ~2.5x
// a 13-cal ski interval of the same effort, and a ski interval logged by time
// priced at zero, because time is not a work unit. Neither says what the block
// cost the athlete. Thirty seconds at RPE 8 is thirty seconds at RPE 8 on
// either machine. kg.m stays the lifting lane's currency, and stays the right
// read for progress on ONE station (more calories in the same time).
//
// Rest is not working time and is not counted. How densely the work was packed
// is a separate question.
//
// An unrated set scores at RPE.default: absence is never a penalty.

import { RPE, type MovementProfile } from '@/app.config';
import { setWorkSeconds } from '@/lib/setTime';
import type { LogSet } from '@/lib/types';

export const CONDITIONING_UNIT = 'RPE·min';

/**
 * Seconds of work in one completed set, from whatever was logged — priced by
 * lib/setTime.ts at conditioning intent, the same estimate every other reader
 * of set time uses.
 */
export function workSeconds(set: LogSet, profile: MovementProfile | null): number {
  return setWorkSeconds(set, profile, 'conditioning');
}

/** Working minutes x RPE for one set. */
export function conditioningLoad(set: LogSet, profile: MovementProfile | null): number {
  const seconds = workSeconds(set, profile);
  if (seconds <= 0) return 0;
  return (seconds / 60) * (set.actual.rpe ?? RPE.default);
}
