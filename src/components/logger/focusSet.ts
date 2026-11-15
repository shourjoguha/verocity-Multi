// Pure helpers behind the Logger's focus card: which set is live, which logged
// set "copy previous" reads, and what that copy writes. No React here, so the
// RPE semantics — the part a coach rule can be silently corrupted by — are
// pinned by focusSet.test.ts rather than by eye.
import { RPE } from '@/app.config';
import type { LogGroup, LogItem, SetActual } from '@/lib/types';
import { isSubroutine } from '@/lib/subroutine';

/** Index of the first set in this movement that is not logged, or -1. */
export function firstOpenSet(item: LogItem): number {
  if (isSubroutine(item)) return -1;
  return item.sets.findIndex((s) => !s.actual.completed);
}

/**
 * The next set to log in a group, in ROUND order: set 1 of every member in
 * member order, then set 2 of every member, and so on — the order a superset
 * or circuit alternates in. For a single movement that is simply its first
 * open set. A set skipped in an earlier round comes before anything in a later
 * round. Null when every set in the group is logged (or it has none).
 */
export function nextOpenSet(group: LogGroup): { ii: number; ki: number } | null {
  const rounds = Math.max(0, ...group.items.map((it) => (isSubroutine(it) ? 0 : it.sets.length)));
  for (let ki = 0; ki < rounds; ki++) {
    for (let ii = 0; ii < group.items.length; ii++) {
      const it = group.items[ii];
      if (isSubroutine(it)) continue;
      const set = it.sets[ki];
      if (set && !set.actual.completed) return { ii, ki };
    }
  }
  return null;
}

/** The most recent LOGGED set before `ki` in this movement, or -1. */
export function previousLoggedSet(item: LogItem, ki: number): number {
  for (let i = Math.min(ki, item.sets.length) - 1; i >= 0; i--) {
    if (item.sets[i].actual.completed) return i;
  }
  return -1;
}

// The measured fields a set records. Not `rest` (a per-set rest-after tag, which
// says nothing about the next set), not the completion/provenance flags.
const MEASURED = ['weight', 'reps', 'time', 'distance', 'calories', 'mark'] as const;

/**
 * What "copy previous set" writes into the live set: the measured fields,
 * `prefilled: true`, and — by the owner's decision (2026-11-15) — the previous
 * set's RPE AS A RATING when that RPE was itself rated. This is the one place a
 * copied RPE counts: the athlete pressed the copy key, sees the value selected
 * in the picker, and can change or clear it before logging, so it is a rating
 * they chose, not one that echoed forward unseen (which is what `rpeRated`
 * exists to stop — see SetActual in lib/types.ts). A source RPE that was only
 * seeded is NOT copied; the live set's RPE and rated flag stay as they were.
 * Never touches `completed`: copying does not log.
 */
export function copyPreviousPatch(source: SetActual): Partial<SetActual> {
  const patch: Partial<SetActual> = { prefilled: true };
  for (const k of MEASURED) {
    const v = source[k];
    if (v != null) patch[k] = v;
  }
  if (source.rpeRated === true && source.rpe != null) {
    patch.rpe = source.rpe;
    patch.rpeRated = true;
  }
  return patch;
}

/**
 * The values the inline RPE row offers: `RPE.pickerMin`–`RPE.max`. If the set
 * already carries a rated value below that (set in the sheet, or copied), the
 * row starts there instead, so a selected value is never off the row.
 */
export function rpeScale(selected: number | null = null): number[] {
  const from = selected != null && selected < RPE.pickerMin ? Math.max(RPE.min, selected) : RPE.pickerMin;
  const out: number[] = [];
  for (let v = from; v <= RPE.max + 1e-9; v += RPE.step) out.push(Math.round(v * 10) / 10);
  return out;
}

/**
 * What the inline RPE picker shows as selected: only a value the athlete rated
 * on THIS set. A seeded, copied or defaulted RPE (`rpeRated` false) and a
 * pre-field row (`rpeRated` absent) both show nothing selected, so a set
 * logged without touching the picker records RPE exactly as the sheet does
 * when its stepper is left alone.
 */
export function selectedRpe(a: SetActual): number | null {
  return a.rpeRated === true && a.rpe != null ? a.rpe : null;
}

/**
 * The patch for a tap on RPE value `v`. Tapping the selected value again
 * withdraws the rating (`rpeRated: false`) and leaves the stored number alone —
 * readers ignore an unrated RPE, and there is no seed left to restore.
 */
export function rpeTapPatch(a: SetActual, v: number): Partial<SetActual> {
  return selectedRpe(a) === v ? { rpeRated: false } : { rpe: v, rpeRated: true };
}
