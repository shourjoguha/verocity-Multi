// Reading a set's notations, in both spellings. The logger writes `(p)`, `(t)`
// and `(v)`; logs from before it did carry bare `p` / `t` / `v`, and code that
// matched only the parenthesised form read a spring of paused and tempo sets
// as plain ones. Every reader of these three goes through here.
//
// What each one is FOR is decided by its caller, not here:
//   - `(p)` / `(t)` are harder reps at the same load. Volume prices them
//     (VOLUME.pauseFactor, time under tension); the review page's staple lifts
//     credit them (LOAD_EQUIVALENCE); personal records deliberately do not.
//   - `(v)` is a different variation of the lift. It is never priced, only
//     kept apart — some variations are easier at the same load. It also has
//     no 1RM reference: a variation neither feeds the plain lift's best
//     (bestE1rmByMovement) nor is measured as a fraction of it.
//   - `(v:<kind>)` (VARIATION_KINDS) says what the variation changes. Written
//     beside `(v)`, never instead of it, and read by nothing that measures.

import { VARIATION_KINDS } from '@/app.config';

export type NotationLetter = 'p' | 't' | 'v';

export function hasNotation(notations: readonly string[] | undefined, letter: NotationLetter): boolean {
  if (!notations) return false;
  return notations.includes(`(${letter})`) || notations.includes(letter);
}

/** A paused or tempo set. */
export function isHeld(notations: readonly string[] | undefined): boolean {
  return hasNotation(notations, 'p') || hasNotation(notations, 't');
}

/** A variation of the named lift. */
export function isVariant(notations: readonly string[] | undefined): boolean {
  return hasNotation(notations, 'v');
}

/**
 * The name a set's history is kept under: the movement itself, or
 * "<movement> (v)" for a variation, so a heel-elevated squat never sets or
 * breaks the plain squat's record.
 */
export function trackName(movement: string, notations: readonly string[] | undefined): string {
  return isVariant(notations) ? `${movement} (v)` : movement;
}

/** A `(v:<kind>)` token — what a variation changes, not a notation of its own. */
export function isVariationKind(notation: string): boolean {
  return notation.startsWith('(v:');
}

/** How a notation reads on screen: a kind by its label, everything else as written. */
export function notationLabel(notation: string): string {
  return (VARIATION_KINDS as Record<string, { label: string }>)[notation]?.label ?? notation;
}
