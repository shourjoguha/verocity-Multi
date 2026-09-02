// Goal alignment: the athlete's stated ranking against where their minutes
// actually went.
//
// THE DENOMINATOR IS THE WHOLE RULE, and it took two wrong answers to find.
//
// Counting SETS is wrong: an ActivityLogger run or yoga class carries one set
// and a full hour, so a set-based split accuses an endurance-and-mobility
// athlete of neglecting endurance and mobility.
//
// Counting WORKING MINUTES is also wrong, in the opposite direction. `setMinutes`
// prices a set at reps x 3s, so an hour of lifting yields ~20 minutes and an
// hour of cycling yields ~48; the first probe of this engine reported that a
// barbell-heavy athlete was giving 57% of his training to endurance.
//
// So this uses ELAPSED session minutes, attributed across the modalities each
// session contained — see sessionMinutesPerWeek in ../signals.ts. That is the
// resource a goal weight actually allocates: time.
//
// There is no citation on this family and there should not be. Nobody in the
// corpus says "your minute split should match your goal weights" — that is the
// app's own reading of what a weighted goal list means. The rule states an
// arithmetic fact about the athlete's own two inputs and leaves the judgement
// to them, which is why its body never says a split is wrong.

import { share as shareOf } from '@/lib/coach/impact';
import type { Finding } from '@/lib/coach/types';
import type { GoalShare } from '@/lib/coach/signals';
import type { Measured } from '@/lib/coach/types';
import type { TrainingSignals } from '@/lib/coach/signals';

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * The largest gap between intent and minutes.
 *
 * ONE finding, not one per goal. The shares are renormalised to sum to 1, so
 * every underserved goal implies an overserved one and emitting both sides
 * would be the same fact twice. The gate is ten percentage points AND under
 * three quarters of the ranked share — see the two conditions below.
 */
export function goalDrift(
  goals: Measured<GoalShare[]>,
  training: TrainingSignals,
  periodKey: string,
): Finding | null {
  if (goals.sufficiency === 'insufficient') return null;
  const shares = goals.value;
  if (shares.length < 2) return null;

  const sorted = [...shares].sort((a, b) => a.gap - b.gap);
  const under = sorted[0];
  const over = sorted[sorted.length - 1];
  // Two conditions, both required. The absolute one keeps a rounding-scale gap
  // quiet; the relative one stops a goal ranked at 5% being called underserved
  // for missing by four points. Together they mean: this goal is getting
  // materially less than three quarters of the share you ranked it at.
  if (under.gap > -0.1) return null;
  if (under.actual >= under.intent * 0.75) return null;

  const minutes = training.sessionMinutesPerWeek.value;
  const totalMinutes = Object.values(minutes).reduce((a, b) => a + b, 0);

  return {
    // Scoped by goal id so a shift from "endurance underserved" to "mobility
    // underserved" reads as a new finding rather than an edit of the old one.
    ruleId: `goal.underserved.${under.id}`,
    periodKey,
    tldr: `${under.label} is ${pct(Math.abs(under.gap))} under its rank`,
    action: `Convert one ${over.label.toLowerCase()} session a week into ${under.label.toLowerCase()} work.`,
    body: `You rank ${under.label} at ${pct(under.intent)} of your stated goals but it took ${pct(under.actual)} of your training minutes over the last ${training.windowDays} days. ${over.label} runs the other way — ${pct(over.intent)} of intent, ${pct(over.actual)} of minutes. That is ${Math.round(totalMinutes)} minutes of training time a week being split differently from how you ranked it. This counts elapsed session time, not sets and not working minutes: a logged run carries one set and a full hour, and an hour of lifting is mostly rest — either of those units would answer a different question than the one your goal ranking asks.`,
    drift: shareOf(Math.abs(under.gap), 0.5),
    confidence: goals.sufficiency === 'ok' ? 0.7 : 0.45,
    sufficiency: goals.sufficiency,
    claims: [],
    observed: {
      underGoal: under.label,
      underIntent: Number(under.intent.toFixed(2)),
      underActual: Number(under.actual.toFixed(2)),
      overGoal: over.label,
      overIntent: Number(over.intent.toFixed(2)),
      overActual: Number(over.actual.toFixed(2)),
      minutesPerWeek: Math.round(totalMinutes),
    },
  };
}
