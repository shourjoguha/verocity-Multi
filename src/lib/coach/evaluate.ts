// Stage 3: run every rule, then decide which of its findings are allowed to
// speak. Pure — it takes the athlete's existing recommendations as an argument
// and returns rows to write, so the whole decision is testable without a client.
//
// SUPPRESSION IS THE HARD HALF, not deduplication. A unique index on
// (owner, rule_id, period_key) stops the same finding being written twice this
// week, and that is easy. The real failure of a deterministic engine over a
// stable habit is different: the conditions barely move, so left alone it emits
// the same three findings every week forever, and a finding the athlete has
// already dismissed reopens the moment they check in again — because the data
// that produced it cannot change for weeks. That builds a nag that survives
// being told no.
//
// So dismissal, action and snoozing all buy silence, and a rule that is STILL
// TRUE is not automatically a rule that should still speak.
//
// BUT SILENCE USED TO BE PRICED IN CALENDAR DAYS, AND THAT WAS THE BUG.
// Cooldowns ran 42/14 days from `created_at` and nothing in the decision looked
// at whether the athlete had trained since. Worse, a rule whose row was still
// `open` from an earlier period was muted outright. Put those together over a
// few weeks of ordinary use and every rule is either open-from-last-week or
// inside a cooldown, so `write` comes back empty and the check-in reports
// "Nothing new since last check-in" — to an athlete who has logged ten sessions
// since. The coach looked finished. It was gagged.
//
// The gate is now EVIDENCE, not the clock. A decided rule speaks again when new
// training has actually landed AND its measurement says something new. An open
// row is refreshed in place rather than muting its own rule, so this week's
// numbers replace last week's on the row already on the page. The clock
// survives only as a short floor (so a same-day re-check is quiet) and a long
// stop (so a decision cannot buy silence forever on a measurement that never
// moves).
//
// AND "SOMETHING NEW" USED TO MEAN "WORSE", WHICH WAS THE SECOND BUG. The
// evidence half was priced as `driftNow - driftOnTheDecidedRow >= 0.15`, which
// is unsatisfiable for anything decided near drift 1.0, cannot see a relapse
// off the athlete's own best, and answers a successful fix with permanent
// silence. That comparison now lives in ./recurrence.ts, measured against the
// TRAJECTORY in `coach_observations` rather than a frozen anchor, and this file
// only asks it the question. Read that module's header before touching any
// threshold here.

import { KNOWLEDGE_PACK_VERSION } from '@/lib/coach/knowledge';
import { byImpact } from '@/lib/coach/impact';
import {
  COACH_WINDOW_DAYS,
  isoWeekKey,
  measureFuelTiming,
  measureGoals,
  measureNutrition,
  measureTraining,
} from '@/lib/coach/signals';
import { NUTRITION as N, TRAINING as T } from '@/lib/coach/knowledge';
import { TRAINING_RULES, rpeCalibration } from '@/lib/coach/rules/training';
import { goalDrift } from '@/lib/coach/rules/goals';
import {
  arrivingHungry,
  carbSourceConcentration,
  carbTimingWindow,
  longSessionUnfed,
  proteinGapDays,
  proteinTarget,
} from '@/lib/coach/rules/nutrition';
import {
  RESOLUTION_FLOOR,
  RESOLUTION_HOLD,
  RESOLUTION_MIN_SESSIONS,
  alreadyResolved,
  readingsSince,
  recurrence,
  resolvedRuleId,
  type Reading,
  type Recurrence,
} from '@/lib/coach/recurrence';
import { themeOf } from '@/lib/coach/themes';
import type { EvidencePayload, Finding } from '@/lib/coach/types';
import { SOURCES, CLAIMS } from '@/lib/coach/knowledge';
import { RPE_LADDER } from '@/app.config';
import { unweightedRepKg } from '@/lib/userStats';
import type { OverrideMap } from '@/lib/movementTaxonomy';
import type {
  CoachObservation,
  CoachObservationInput,
  MealLog,
  Recommendation,
  UserStats,
  WorkoutLog,
  Plan,
} from '@/lib/types';

/**
 * The short floor: a decision is honoured for at least this long no matter what
 * lands, so a check-in an hour after dismissing something is quiet.
 *
 * Dismissal buys more than acting because it is the stronger signal — "I have
 * heard this and I do not want it" — but neither is the 42/14 days it used to
 * be. Those numbers were doing the work that SESSIONS_TO_RESPEAK does now, and
 * doing it blind to whether the athlete had trained at all.
 */
export const MIN_SILENCE_DAYS = { dismissed: 10, acted: 5 } as const;

/**
 * The long stop. Without it the evidence gate becomes the mirror of the bug it
 * replaced: a rule dismissed once, on a measurement that is stable by nature
 * (the standing protein target, a habitual session length), would be silenced
 * permanently. Past this a decision has simply expired.
 */
export const DECISION_EXPIRY_DAYS = 180;

/** `goal.underserved.mobility` -> `goal`; `training.hypertrophy.x` -> `training`. */
export function family(ruleId: string): string {
  return ruleId.split('.')[0];
}

export interface CoachInput {
  logs: WorkoutLog[];
  meals: MealLog[];
  stats: UserStats | null;
  plan?: Plan | null;
  /** Recommendations already on file — the suppression memory. */
  existing: Recommendation[];
  /** Past drift readings (migration 0042) — the trajectory memory. Optional so
   *  every existing caller and fixture keeps working; without it the engine
   *  falls back to the decision anchor, which is correct but blind to whether a
   *  finding improved or came back. */
  observations?: CoachObservation[];
  /** Model-proposed rule interactions, ALREADY GOVERNED — pass the output of
   *  `governEdges`, never the raw rows. The engine does not validate them a
   *  second time: one enforcement point, in lib/coach/governor.ts, or there are
   *  two places to tighten and one of them will be missed. */
  edges?: Map<string, Set<string>>;
  overrides?: OverrideMap;
  today?: Date;
  windowDays?: number;
}

/**
 * Completed sessions in the window below which a rule that did NOT fire is
 * treated as unmeasured rather than clean.
 *
 * This is the guard that keeps `drift: 0` honest. A rule is silent for two very
 * different reasons — the athlete fixed it, or there is nothing to look at —
 * and writing a zero for the second would let a fortnight off training "resolve"
 * every open finding at once. `Sufficiency` draws the same line one level down;
 * this is the coarse version of it, applied where no individual signal is in
 * scope.
 */
export const MIN_SESSIONS_FOR_CLEAN = 3;

/** The same guard for the nutrition family, whose denominator is days with any
 *  intake logged rather than sessions. */
export const MIN_MEAL_DAYS_FOR_CLEAN = 7;

/** Impact weight and confidence for a closing finding. Deliberately NOT ranked
 *  by how large the improvement was: good news that outranks a structural
 *  problem is still the wrong thing to lead a page with. */
const RESOLVED_CONFIDENCE = 0.8;

/** A row ready for upsert. Mirrors `recommendations` after migration 0036. */
export interface CoachRecInput {
  rule_id: string;
  period_key: string;
  pack_version: string;
  tldr: string;
  action: string;
  body_md: string;
  drift_score: number;
  confidence: number;
  evidence: EvidencePayload;
}

function daysSince(iso: string, today: Date): number {
  return (today.getTime() - Date.parse(iso)) / 86_400_000;
}

/** Why a rule stayed quiet. Reported so the UI can tell a gagged coach from an
 *  empty one, which is the distinction the old single 'cooldown' reason lost. */
export type SuppressionReason =
  /** Inside the short floor after a decision. */
  | 'too-soon'
  /** Decided, and not enough has happened since — in days OR in sessions. */
  | 'no-new-training'
  /** Enough happened and the measurement had nothing new to say. */
  | 'unchanged'
  /** Still true, but genuinely coming down. Distinct from 'unchanged' because
   *  the two want opposite sentences from the surface that reports them. */
  | 'improving'
  | 'snoozed';

/**
 * What `isSuppressed` needs beyond the rule's own history.
 *
 * Optional so the function stays callable on history alone, in which case no
 * new evidence has been established and a decided rule stays quiet.
 *
 * `since` is the half that did not exist before migration 0042 and is the whole
 * point of it: without a trajectory the only available reference is the drift
 * frozen on the decided row, and every pathology in recurrence.ts's header
 * follows from that.
 */
export interface EvidenceDelta {
  /** Completed sessions logged after the decided row was written. */
  newSessions: number;
  /** The rule's drift right now. */
  drift: number;
  /** Did the rule produce a finding this run, before suppression? Defaults to
   *  true: a caller bothering to ask about a rule's drift has one in hand. */
  fired?: boolean;
  /** Readings taken after the decision, oldest first. Empty is normal. */
  since?: Reading[];
  /** A rule in the same theme started firing this run. */
  siblingFired?: boolean;
}

/**
 * May this rule speak right now?
 *
 * Looks at the most recent row for the rule only. Older rows are history: a
 * finding dismissed in April and acted on in July is in its acted cooldown, not
 * its dismissed one.
 *
 * An OPEN row never suppresses its own rule any more, in any period. The rule
 * re-measures and the caller upserts the fresh numbers onto that row (see
 * `runCoach`), so an unaddressed finding stays current instead of freezing at
 * the week it first fired and muting itself thereafter.
 */
export function isSuppressed(
  ruleId: string,
  _periodKey: string,
  existing: Recommendation[],
  today: Date,
  delta?: EvidenceDelta,
): SuppressionReason | null {
  const prior = existing
    .filter((r) => r.rule_id === ruleId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const last = prior[0];
  if (!last) return null;

  if (last.status === 'open') return null;

  if (last.status === 'snoozed') {
    return last.snooze_until != null && Date.parse(last.snooze_until) > today.getTime()
      ? 'snoozed'
      : null;
  }

  const status = last.status === 'dismissed' ? 'dismissed' : 'acted';
  const age = daysSince(last.created_at, today);
  if (age < MIN_SILENCE_DAYS[status]) return 'too-soon';
  // A decision cannot buy silence forever on a number that never moves.
  if (age >= DECISION_EXPIRY_DAYS) return null;

  // A resolution RETIRES the decision it closed. Without this the anchor stays
  // frozen at a problem the athlete has already fixed and been told they fixed,
  // so the rule's return would be graded against a number from before the fix
  // rather than treated as the new event it is.
  const resolved = existing
    .filter((r) => r.rule_id === resolvedRuleId(ruleId))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
  if (resolved && resolved.created_at > last.created_at) return null;

  const verdict = recurrence({
    status,
    decidedOn: last.created_at,
    driftAtDecision: last.drift_score ?? 0,
    drift: delta?.drift ?? 0,
    fired: delta?.fired ?? true,
    newSessions: delta?.newSessions ?? 0,
    since: delta?.since ?? [],
    siblingFired: delta?.siblingFired,
    today,
  });
  if (verdict.speaks) return null;
  // Reported separately because the surface wants opposite sentences for them:
  // "this is coming down, keep going" against "nothing has moved".
  if (verdict.reason === 'improving') return 'improving';
  // Short of the re-speak window in BOTH days and sessions — the only remaining
  // reading of "not enough has happened yet".
  if (verdict.readiness < 1) return 'no-new-training';
  return 'unchanged';
}

function toEvidence(f: Finding, sufficiency: EvidencePayload['sufficiency']): EvidencePayload {
  return {
    packVersion: KNOWLEDGE_PACK_VERSION,
    // Resolved, not referenced. A row written under this pack must still render
    // its own reasoning after the pack moves on and a threshold changes; storing
    // only ids would silently re-point old findings at new numbers.
    claims: f.claims.map((c) => {
      const src = SOURCES[c.source];
      return {
        id: c.id,
        statement: c.statement,
        value: c.value,
        unit: c.unit,
        quote: c.quote,
        caveat: c.caveat,
        speaker: src.speaker,
        work: src.work,
        url: src.url,
      };
    }),
    observed: f.observed,
    sufficiency,
  };
}

/**
 * The day a reading is stamped with.
 *
 * UTC, matching `windowStart` and `isoWeekKey` in ./signals.ts rather than the
 * viewer's clock. Every date the coach compares — the decision timestamp, the
 * window edges, a reading — is derived this way, and one local date among them
 * would put readings a day either side of the decisions they are supposed to
 * follow. The cost is that a late-evening check-in east of UTC is filed under
 * the next day; the benefit is that the comparisons are all in one frame.
 */
function localDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The closing finding for a rule the athlete fixed.
 *
 * Borrows the headline from the row being closed so the athlete recognises the
 * thing being reported as done. `claims` is empty: this is not an assertion
 * about the body, it is a report about their own record, and inventing a
 * citation for it would devalue every real one.
 *
 * `drift` is the CURRENT (low) reading, not the size of the improvement. The
 * column means "distance past the threshold" everywhere else, and overloading
 * it here would make `rank()` in CoachView read a big win as a big problem. The
 * improvement is carried in `observed` instead, where it cannot be mistaken for
 * a severity.
 */
function resolvedFinding(
  ruleId: string,
  decision: Recommendation,
  driftNow: number,
  periodKey: string,
  verdict: Recurrence,
): Finding {
  const was = decision.drift_score ?? 0;
  const drop = Math.round((was - driftNow) * 100);
  const what = (decision.tldr ?? ruleId).trim();
  return {
    ruleId: resolvedRuleId(ruleId),
    periodKey,
    tldr: `Cleared: ${what}`,
    action: 'Nothing to do. Keeping this is the work now.',
    body: `You acted on this on ${decision.created_at.slice(0, 10)} when it was reading ${Math.round(was * 100)}% past its threshold. It has been at or under ${Math.round(RESOLUTION_FLOOR * 100)}% for the last ${RESOLUTION_HOLD} check-ins, across ${RESOLUTION_MIN_SESSIONS}+ sessions since — that is a change holding, not a quiet week. The rule goes back on watch from here: if it comes back, it will be measured against this new level rather than the old one.`,
    drift: driftNow,
    confidence: RESOLVED_CONFIDENCE,
    sufficiency: 'ok',
    claims: [],
    observed: {
      driftAtDecision: Number(was.toFixed(2)),
      driftNow: Number(driftNow.toFixed(2)),
      improvementPoints: drop,
      decidedOn: decision.created_at.slice(0, 10),
      readings: verdict.slope != null ? `slope ${verdict.slope}` : 'short series',
    },
  };
}

/**
 * Everything the coach knows, in one pure pass.
 *
 * Returns the findings it would write AND the ones it suppressed, because a
 * suppressed finding is not nothing — it is why the coach looks quiet, and the
 * tests assert on it.
 */
export function runCoach(input: CoachInput): {
  write: CoachRecInput[];
  /** Rule ids in `write` that landed on an already-open row rather than a new one. */
  refreshed: string[];
  suppressed: { ruleId: string; reason: SuppressionReason }[];
  findings: Finding[];
  /** This run's drift readings, for `upsertCoachObservations`. One per rule that
   *  could be measured, whether or not it spoke — see MIN_SESSIONS_FOR_CLEAN. */
  observations: CoachObservationInput[];
  /** Rule ids that cleared this run, i.e. whose `outcome.resolved.*` finding is
   *  in `write`. Reported so the surface can say "1 cleared" rather than
   *  counting a closing finding as a new problem. */
  resolved: string[];
} {
  const today = input.today ?? new Date();
  const windowDays = input.windowDays ?? COACH_WINDOW_DAYS;
  const weekKey = isoWeekKey(today);
  const monthKey = today.toISOString().slice(0, 7);

  const training = measureTraining(
    input.logs,
    {
      heavyFraction: T.strengthIntensity.value,
      strengthRepMax: T.strengthReps.value,
      hypertrophyReps: T.hypertrophyReps.value,
      nearFailureRpe: RPE_LADDER.nearFailure,
      allOutRpe: RPE_LADDER.allOut,
      heavyRestSeconds: T.strengthRest.value,
      overrides: input.overrides,
      // Prices unweighted work against the athlete's own mass rather than the
      // flat constant, exactly as the radar does. Falls back on its own when
      // there is no bodyweight on file.
      unweightedKg: unweightedRepKg(input.stats),
    },
    today,
    windowDays,
  );
  const goals = measureGoals(input.stats, training);
  const nutrition = measureNutrition(input.meals, input.logs, today, windowDays);
  const fuel = measureFuelTiming(
    input.logs,
    input.meals,
    N.fastedDuration.value,
    today,
    windowDays,
  );

  const findings: Finding[] = [];
  for (const rule of TRAINING_RULES) {
    const f = rule(training, input.stats, weekKey);
    if (f) findings.push(f);
  }
  const g = goalDrift(goals, training, weekKey);
  if (g) findings.push(g);
  const cal = rpeCalibration(training, weekKey);
  if (cal) findings.push(cal);

  // Monthly cadence for the standing protein target — it restates a number that
  // only moves when bodyweight does. Everything else is weekly.
  const nutritionFindings = [
    proteinTarget(nutrition, input.stats, monthKey),
    proteinGapDays(nutrition, input.meals, weekKey),
    arrivingHungry(nutrition, weekKey),
    carbTimingWindow(nutrition, training, input.stats, weekKey),
    longSessionUnfed(fuel, input.stats, weekKey),
    // Monthly: what your carbohydrate is made of moves on the scale of habits,
    // not weeks, and restating it weekly would be the monotony this engine is
    // most prone to.
    carbSourceConcentration(nutrition, monthKey),
  ];
  for (const f of nutritionFindings) if (f) findings.push(f);

  // ---- observation substrate (migration 0042) ----------------------------
  //
  // WHICH RULES GET A READING. Every rule that fired, plus every rule the
  // athlete already has history for. Deliberately NOT "every rule that exists":
  // a trajectory is only ever consulted for a rule with a decision behind it,
  // and building a registry of all rule ids here would be a second list to keep
  // in step with rules/** for no gain. The set grows itself — a rule's first
  // firing is what enrols it.
  const observedOn = localDay(today);
  const cleanIsMeasurable = (ruleId: string) =>
    family(ruleId) === 'nutrition'
      ? nutrition.daysLogged >= MIN_MEAL_DAYS_FOR_CLEAN
      : training.sessions >= MIN_SESSIONS_FOR_CLEAN;

  const firedById = new Map(findings.map((f) => [f.ruleId, f]));
  const withHistory = new Set(
    input.existing
      .map((r) => r.rule_id)
      .filter((id): id is string => id != null && !id.startsWith('outcome.')),
  );
  const observations: CoachObservationInput[] = [];
  for (const ruleId of new Set([...firedById.keys(), ...withHistory])) {
    const f = firedById.get(ruleId);
    // A rule that fired on thin inputs still reports what it measured; a rule
    // that did NOT fire only reports a clean zero when there was enough to look
    // at. "We do not know" and "you are fine" must never share a value.
    if (f ? f.sufficiency === 'insufficient' : !cleanIsMeasurable(ruleId)) continue;
    observations.push({
      rule_id: ruleId,
      observed_on: observedOn,
      drift: f?.drift ?? 0,
      confidence: f?.confidence ?? null,
      sufficiency: f?.sufficiency === 'partial' ? 'partial' : 'ok',
      fired: f != null,
      sessions: training.sessions,
      observed: f?.observed ?? null,
    });
  }

  // Past readings, grouped per rule. TODAY'S rows are dropped: `recurrence`
  // appends this run as the newest reading itself, and a second check-in on the
  // same day would otherwise count the day twice in `best` and in the slope.
  const seriesByRule = new Map<string, CoachObservation[]>();
  for (const o of input.observations ?? []) {
    if (o.observed_on >= observedOn) continue;
    seriesByRule.set(o.rule_id, [...(seriesByRule.get(o.rule_id) ?? []), o]);
  }
  const readingsFor = (ruleId: string, decidedOn: string): Reading[] =>
    readingsSince(seriesByRule.get(ruleId) ?? [], decidedOn);

  // ---- interaction --------------------------------------------------------
  //
  // Did a DIFFERENT rule in the same theme fire this run? That is the pattern
  // the athlete asked about: "endurance intervals are back AND zone 2 is short
  // again" is one story, and the second half of it is worth re-raising sooner
  // than it would be on its own.
  //
  // Bounded deliberately. It raises a rule's recurrence; it never invents one —
  // `recurrence` requires the rule to be independently true before the
  // `interacting` term can apply at all. A theme is a reason to listen harder,
  // never a reason to make something up.
  const siblingFiredFor = (ruleId: string): boolean => {
    // "A sibling", not "itself": the rule under test always fired, or we would
    // not be asking whether to suppress its finding.
    const others = [...firedById.keys()].filter((id) => id !== ruleId);
    const t = themeOf(ruleId);
    if (t && others.some((id) => themeOf(id)?.key === t.key)) return true;
    // A governed edge is a per-athlete link the static themes do not carry —
    // "for you, the RPE dial going untouched is upstream of the effort rule".
    // It can only ever add a sibling; there is no edge that removes one.
    const linked = input.edges?.get(ruleId);
    return linked != null && others.some((id) => linked.has(id));
  };

  // The open row per rule, if any: both the reason a rule is not suppressed and
  // the row the refreshed numbers are written onto.
  const openByRule = new Map<string, Recommendation>();
  for (const r of [...input.existing].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) {
    if (r.rule_id && r.status === 'open') openByRule.set(r.rule_id, r);
  }

  // Completed sessions logged after a given row was written. `log_date` is a
  // bare date, so compare on the date part only — a session logged the same day
  // as the decision is not evidence against it.
  const doneDates = input.logs
    .filter((l) => l.status === 'done')
    .map((l) => l.log_date)
    .sort();
  const newSessionsSince = (iso: string) => {
    const cutoff = iso.slice(0, 10);
    return doneDates.filter((d) => d > cutoff).length;
  };
  const lastDecisionFor = (ruleId: string) =>
    input.existing
      .filter((r) => r.rule_id === ruleId && (r.status === 'dismissed' || r.status === 'acted'))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];

  const suppressed: { ruleId: string; reason: SuppressionReason }[] = [];
  const live = findings.filter((f) => {
    const decision = lastDecisionFor(f.ruleId);
    const reason = isSuppressed(
      f.ruleId,
      f.periodKey,
      input.existing,
      today,
      decision
        ? {
            newSessions: newSessionsSince(decision.created_at),
            drift: f.drift,
            fired: true,
            since: readingsFor(f.ruleId, decision.created_at),
            siblingFired: siblingFiredFor(f.ruleId),
          }
        : undefined,
    );
    if (reason) suppressed.push({ ruleId: f.ruleId, reason });
    return reason === null;
  });

  // ---- closing the loop --------------------------------------------------
  //
  // A rule the athlete ACTED on, whose drift has since fallen below the floor
  // and stayed there. Computed over decisions rather than over findings,
  // because a resolved rule by definition does not fire — which is exactly why
  // the engine had no way to say so before. The headline is borrowed from the
  // row being closed: it is the sentence the athlete already recognises.
  //
  // Dismissals are excluded in `recurrence`, and a resolution is said once —
  // see `alreadyResolved`. Both guards exist because good news restated every
  // week is the same monotony as bad news restated every week.
  const resolvedFindings: Finding[] = [];
  for (const ruleId of withHistory) {
    const decision = lastDecisionFor(ruleId);
    if (!decision || decision.status !== 'acted') continue;
    if (alreadyResolved(ruleId, input.existing)) continue;
    const f = firedById.get(ruleId);
    if (f ? f.sufficiency === 'insufficient' : !cleanIsMeasurable(ruleId)) continue;
    const driftNow = f?.drift ?? 0;
    const verdict = recurrence({
      status: 'acted',
      decidedOn: decision.created_at,
      driftAtDecision: decision.drift_score ?? 0,
      drift: driftNow,
      fired: f != null,
      newSessions: newSessionsSince(decision.created_at),
      since: readingsFor(ruleId, decision.created_at),
      today,
    });
    if (verdict.reason !== 'resolved') continue;
    resolvedFindings.push(resolvedFinding(ruleId, decision, driftNow, weekKey, verdict));
  }

  // A RULE THAT CLEARED MUST NOT ALSO COMPLAIN. Resolution needs the last
  // RESOLUTION_HOLD readings under RESOLUTION_FLOOR, and a rule can sit a
  // fraction past its own threshold and still be inside that floor — so a rule
  // decided at 0.8 and reading 0.05 today both resolves AND fires, and the page
  // would carry "Cleared: heavy sets are getting 70s of rest" directly above
  // "Heavy sets are getting 70s of rest". The closing row wins: it is the newer
  // and larger statement, and it says the rule is back on watch anyway.
  const closedThisRun = new Set(resolvedFindings.map((f) => f.ruleId));
  const stillOpen = live.filter((f) => !closedThisRun.has(resolvedRuleId(f.ruleId)));
  stillOpen.push(...resolvedFindings);

  // EVERYTHING TRUE IS WRITTEN, ranked. The old cap of four was applied here,
  // at the write, which meant a fifth true finding was not deferred — it was
  // destroyed, with no row, no history and no way for the athlete to know it
  // had been measured. Volume control belongs to the surface that renders the
  // page (see SURFACED_LIMIT in CoachView), where "show me the rest" is a
  // disclosure rather than a re-run of the engine.
  const ranked = [...stillOpen].sort(byImpact);

  const write = ranked.map((f) => ({
    rule_id: f.ruleId,
    // Refresh in place when this rule already has an open row, whatever period
    // it was opened in. Minting a new weekly row alongside it would leave two
    // live rows for one unresolved point; suppressing the rule instead — which
    // is what used to happen — left the athlete reading last week's numbers.
    period_key: openByRule.get(f.ruleId)?.period_key ?? f.periodKey,
    pack_version: KNOWLEDGE_PACK_VERSION,
    tldr: f.tldr.slice(0, 200),
    action: f.action.slice(0, 400),
    body_md: f.body.slice(0, 2000),
    drift_score: f.drift,
    confidence: f.confidence,
    evidence: toEvidence(f, f.sufficiency),
  }));

  // Split so the caller can say "2 new, 3 updated" instead of "5 new" — the
  // second is a lie the athlete catches immediately, and it is the reason a
  // refreshed row must not be reported as a discovery.
  const refreshed = write.filter((r) => openByRule.has(r.rule_id)).map((r) => r.rule_id);

  // `findings` stays the FULL set, suppressed ones included — a suppressed
  // finding is not nothing, it is why the coach looks quiet, and the tests
  // assert on the difference between the two lists. Closing findings are
  // appended: they were never suppressed and never rule findings, but they are
  // rows the caller must write.
  return {
    write,
    refreshed,
    suppressed,
    findings: [...findings, ...resolvedFindings],
    observations,
    resolved: resolvedFindings.map((f) => f.ruleId.replace('outcome.resolved.', '')),
  };
}

export { CLAIMS };
