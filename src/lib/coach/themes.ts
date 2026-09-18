// Which findings are the same story?
//
// WHY NOT `family()`. That function splits on the first dotted segment —
// training / nutrition / goal — which is where a rule's CODE lives, not what it
// is ABOUT. It is the right grain for ownership and the wrong grain for a page:
// it puts "your intervals are not hard enough" next to "you are training four
// days a week short of target" because both are training, and puts "you arrive
// at sessions hungry" in a different group from "long sessions are going
// unfed". The second segment is the opposite problem — `endurance`, `intent`,
// `effort` and `timing` are four groups of one or two.
//
// THE EVIDENCE THIS IS THE RIGHT CUT. One real account acted on
// `endurance.intervals-not-all-out`, `endurance.zone2-short` and
// `effort.rpe-calibration` as three separate rows over three weeks. They are
// one observation: the endurance work is there but neither hard enough nor
// rated reliably enough to prove it either way. Three rows asked the athlete to
// solve the same problem three times.
//
// SO A THEME IS AN EDITORIAL CLAIM, hand-written and argued with, exactly like
// RULE_IMPACT in ./impact.ts and for the same reason: it is this product's
// judgement about what belongs together, not a fact about the body, so it does
// NOT belong in knowledge.ts and it does not belong in app.config.ts either —
// nothing outside the coach groups a rule.
//
// Themes do a second job. A rule in a theme whose siblings have just started
// firing is more worth re-raising than the same rule alone, which is the
// `interacting` term in ./recurrence.ts. That is the only way a quiet rule's
// score can be raised by something other than its own measurement, and it is
// bounded on purpose: interaction can only amplify a rule that is already true.

/** Stable slug. Used as a row key in the UI and in `coach_briefs.theme`. */
export type ThemeKey =
  | 'endurance-quality'
  | 'stimulus'
  | 'recovery'
  | 'fuelling'
  | 'consistency'
  | 'alignment';

export interface Theme {
  key: ThemeKey;
  /** The card headline when two or more members are live. ≤40 chars. */
  title: string;
  /** One sentence naming what the members have in common. */
  blurb: string;
  ruleIds: readonly string[];
}

/**
 * Six themes, in the order they lead a page when they tie.
 *
 * A rule may appear in exactly one theme — `themeOf` returns the first match
 * and a rule in two groups is a rule whose story has not been decided.
 */
export const THEMES: readonly Theme[] = [
  {
    key: 'consistency',
    title: 'The work is not adding up',
    blurb: 'Volume or frequency below what the goal needs, before any question of quality.',
    ruleIds: [
      'training.frequency.below-target',
      'training.hypertrophy.total-volume-short',
      'training.hypertrophy.region-volume-short',
    ],
  },
  {
    key: 'stimulus',
    title: 'The work is not hard enough',
    blurb: 'The sessions happen; the intensity that drives the adaptation is missing.',
    ruleIds: [
      'training.hypertrophy.effort-low',
      'training.intent.loaded-too-light',
      'training.strength.rest-too-short',
      'training.effort.rpe-calibration',
    ],
  },
  {
    key: 'endurance-quality',
    title: 'Endurance work lacks shape',
    blurb: 'Easy work and hard work are blurring into the same middle.',
    ruleIds: [
      'training.endurance.zone2-short',
      'training.endurance.intervals-not-all-out',
      'training.endurance.interval-ordering',
    ],
  },
  {
    key: 'recovery',
    title: 'Recovery is the limit',
    blurb: 'Load is accumulating faster than it is being absorbed.',
    ruleIds: ['training.recovery.symptoms-and-load', 'training.recovery.consecutive-days'],
  },
  {
    key: 'fuelling',
    title: 'Sessions are underfuelled',
    blurb: 'What is eaten around training is not matching what training asks for.',
    ruleIds: [
      'nutrition.timing.long-session-unfed',
      'nutrition.timing.carb-window',
      'nutrition.timing.arriving-hungry',
      'nutrition.style.protein-gap-days',
      'nutrition.style.carb-concentration',
      'nutrition.dose.protein-target',
    ],
  },
  {
    key: 'alignment',
    title: 'Training does not match the goal',
    blurb: 'Time is going somewhere other than what you ranked highest.',
    // `goal.underserved.<aspect>` is one rule per aspect and the aspect list is
    // app.config's to grow, so this matches on the PREFIX — the same fallback
    // impactWeight() makes, and for the same reason.
    ruleIds: ['goal.underserved'],
  },
];

const BY_RULE = new Map<string, Theme>();
for (const t of THEMES) for (const id of t.ruleIds) BY_RULE.set(id, t);

/**
 * The theme a rule belongs to, or null.
 *
 * Falls back from the full id to its first two segments so a per-aspect rule
 * family needs one entry rather than one per aspect. Null is a legitimate
 * answer — a closing `outcome.resolved.*` finding is not part of any story,
 * it is the end of one.
 */
export function themeOf(ruleId: string): Theme | null {
  const exact = BY_RULE.get(ruleId);
  if (exact) return exact;
  return BY_RULE.get(ruleId.split('.').slice(0, 2).join('.')) ?? null;
}

/**
 * Group rows by theme, largest group first, singletons kept out.
 *
 * A one-member "group" is a card with a headline that says less than the
 * finding inside it, so a theme earns its card at two. Anything ungrouped comes
 * back in `loose`, in the order it was given — the caller has already ranked it
 * and this function must not re-sort what it does not own.
 */
export function groupByTheme<T extends { rule_id: string | null }>(
  rows: readonly T[],
): { theme: Theme; rows: T[] }[] {
  const byKey = new Map<ThemeKey, { theme: Theme; rows: T[] }>();
  for (const r of rows) {
    const t = r.rule_id ? themeOf(r.rule_id) : null;
    if (!t) continue;
    const slot = byKey.get(t.key) ?? { theme: t, rows: [] };
    slot.rows.push(r);
    byKey.set(t.key, slot);
  }
  return [...byKey.values()]
    .filter((g) => g.rows.length >= 2)
    .sort((a, b) => b.rows.length - a.rows.length || a.theme.key.localeCompare(b.theme.key));
}
