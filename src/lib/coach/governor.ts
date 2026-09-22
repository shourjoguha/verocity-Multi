// What a model is allowed to have written.
//
// The only rows in the coach's path that were not produced by a rule are
// `coach_briefs` and `coach_rule_notes` (migration 0043). This module is where
// they are checked, and it is checked at READ time on purpose — the same call
// lib/deepGovernors.ts made for `rx_deep_results`. Validating at write would
// leave every row already in the table governed by whatever the rules were on
// the day it landed; validating at read means tightening this file
// retroactively disarms everything written under a looser version of it.
//
// THE BOUNDARY. A note may change what a rule SAYS, and may raise how eagerly a
// rule that is ALREADY TRUE re-speaks. It may not change what a rule MEASURES,
// invent a rule, or silence one. Everything below is that sentence made
// executable:
//
//   * unknown rule id          -> dropped. A note cannot address a rule that
//                                 does not exist, which is how a model would
//                                 introduce one.
//   * expired                  -> dropped. A snapshot of context from four
//                                 months ago must not still be steering prose.
//   * numeric claim in a note  -> dropped. This is the load-bearing one; see
//                                 `statesANumber`.
//   * edge to an unknown rule,
//     or to itself             -> dropped.
//   * low-confidence edge      -> dropped, because an edge's only effect is to
//                                 make the coach louder.
//
// There is deliberately no rule that lets a note SUPPRESS anything. Silence is
// the one thing a model must not be able to buy on the athlete's behalf: a
// wrong "ignore this, it is fine" is unfalsifiable from the page, where a wrong
// note that says too much is visible the moment it is read.

import { RULE_IMPACT } from '@/lib/coach/impact';
import { THEMES, type ThemeKey } from '@/lib/coach/themes';
import type { CoachBrief, CoachRuleNote } from '@/lib/types';

/** Longest note rendered. Past this it is an essay competing with the finding
 *  it is supposed to annotate. */
export const MAX_NOTE_CHARS = 280;

/** An edge only ever makes the coach louder, so a hedged one is not worth
 *  acting on. Notes carry no floor — a context note is prose beside a finding,
 *  and a tentative one that is labelled tentative is fine. */
export const MIN_EDGE_CONFIDENCE = 0.6;

/** Every rule id the engine can produce, by exact id or by two-segment prefix —
 *  the same fallback `impactWeight` and `themeOf` make, so a per-aspect family
 *  like `goal.underserved.*` needs one entry and not one per aspect. */
const KNOWN = new Set<string>([
  ...Object.keys(RULE_IMPACT),
  ...THEMES.flatMap((t) => t.ruleIds),
]);

export function isKnownRuleId(ruleId: string): boolean {
  if (KNOWN.has(ruleId)) return true;
  return KNOWN.has(ruleId.split('.').slice(0, 2).join('.'));
}

/**
 * Does this note assert a NUMBER?
 *
 * The sharpest edge of the boundary. A note reading "you only get about 8 hard
 * sets a week for legs" is not context, it is a measurement — and one nobody
 * computed, sourced or tested, sitting in the same paragraph as numbers that
 * were all three. Left unchecked it is how a threshold gets restated by
 * inference, which is exactly what knowledge.ts's pack versioning and verbatim
 * quotes exist to prevent.
 *
 * So the rule is blunt and deliberately over-broad: any digit that is not part
 * of an ordinary word gets the note dropped. Numbers come from the engine. A
 * model wanting to say something numeric has a legitimate route — propose the
 * rule, and let it ship with a claim and a test.
 *
 * Dates and times are allowed through, because "they train before work" is
 * context and "06:30" is how an athlete says it.
 *
 * THE COST IS REAL AND ACCEPTED: this also refuses "their Zone 2 is a bike
 * commute", where the digit is part of a proper noun and claims nothing. Write
 * it as "their easy aerobic work is a bike commute". A refused note costs a
 * rewrite; an accepted false threshold costs the provenance the whole coach
 * rests on, and there is no check downstream that would catch it.
 */
export function statesANumber(note: string): boolean {
  const withoutClock = note.replace(/\b\d{1,2}:\d{2}\b/g, ' ');
  const withoutDates = withoutClock.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
  return /\d/.test(withoutDates);
}

/** Why a note was refused. Returned rather than logged so a caller can say so
 *  in a development surface instead of a row silently vanishing. */
export type NoteRejection =
  | 'expired'
  | 'unknown-rule'
  | 'unknown-target'
  | 'self-edge'
  | 'states-a-number'
  | 'low-confidence'
  | 'empty';

export interface GovernedNote {
  note: CoachRuleNote;
  /** Clamped to MAX_NOTE_CHARS. */
  text: string;
}

/** The one check, for one note. Null means it passes. */
export function rejectNote(n: CoachRuleNote, now: Date): NoteRejection | null {
  if (Date.parse(n.expires_at) <= now.getTime()) return 'expired';
  if (!n.note.trim()) return 'empty';
  if (!isKnownRuleId(n.rule_id)) return 'unknown-rule';
  if (statesANumber(n.note)) return 'states-a-number';
  if (n.kind === 'edge') {
    if (!n.related_rule_id) return 'unknown-target';
    if (n.related_rule_id === n.rule_id) return 'self-edge';
    if (!isKnownRuleId(n.related_rule_id)) return 'unknown-target';
    if ((n.confidence ?? 0) < MIN_EDGE_CONFIDENCE) return 'low-confidence';
  }
  return null;
}

/** Context notes that survive, keyed by rule id. At most one per rule — the
 *  partial unique index guarantees it, and the newest wins if it does not. */
export function governContextNotes(
  notes: readonly CoachRuleNote[],
  now: Date = new Date(),
): Map<string, GovernedNote> {
  const out = new Map<string, GovernedNote>();
  for (const n of [...notes].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) {
    if (n.kind !== 'context') continue;
    if (rejectNote(n, now)) continue;
    out.set(n.rule_id, { note: n, text: n.note.trim().slice(0, MAX_NOTE_CHARS) });
  }
  return out;
}

/**
 * Surviving edges as an adjacency map, SYMMETRIC.
 *
 * An interaction between two rules is a claim about the pair, and reading it in
 * one direction only would make the effect depend on which rule the model
 * happened to name first.
 */
export function governEdges(
  notes: readonly CoachRuleNote[],
  now: Date = new Date(),
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    const set = out.get(a) ?? new Set<string>();
    set.add(b);
    out.set(a, set);
  };
  for (const n of notes) {
    if (n.kind !== 'edge' || !n.related_rule_id) continue;
    if (rejectNote(n, now)) continue;
    link(n.rule_id, n.related_rule_id);
    link(n.related_rule_id, n.rule_id);
  }
  return out;
}

/**
 * The brief to show, or null.
 *
 * Newest unexpired row wins, scoped to a theme when one is asked for. A brief
 * is never merged with another: two models' syntheses stitched together is a
 * third synthesis nobody wrote.
 *
 * The athlete's answer (0044) is applied AFTER picking the newest, not before:
 * marking the current brief done must clear the slot, not promote the older
 * synthesis it superseded. A snooze that has run out makes it live again.
 */
export function currentBrief(
  briefs: readonly CoachBrief[],
  theme: ThemeKey | null = null,
  now: Date = new Date(),
): CoachBrief | null {
  const live = briefs
    .filter((b) => b.expires_at == null || Date.parse(b.expires_at) > now.getTime())
    .filter((b) => (theme == null ? b.theme == null : b.theme === theme))
    .filter((b) => b.headline.trim().length > 0 && b.body_md.trim().length > 0)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const top = live[0];
  return top && isBriefLive(top, now) ? top : null;
}

/** Open, or snoozed until a time that has passed. Rows written before 0044
 *  have no status and read as open. */
export function isBriefLive(b: CoachBrief, now: Date = new Date()): boolean {
  if (b.status == null || b.status === 'open') return true;
  return b.status === 'snoozed' && b.snooze_until != null && Date.parse(b.snooze_until) <= now.getTime();
}

/**
 * How stale a brief is, in days, for the label the UI must carry.
 *
 * A model's synthesis and a rule's citation are both prose on a page and the
 * athlete has to be able to tell them apart — which means the page says who
 * wrote it and when, every time, not only when it is old.
 */
export function briefAgeDays(b: CoachBrief, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(b.created_at)) / 86_400_000));
}
