// Nutrition rules — TIMING AND STYLE ONLY.
//
// THE LINE THIS FILE MUST NOT CROSS. `meal_logs` holds no calories and no macro
// grams, by explicit schema decision (migration 0032: "No calories, no macros,
// no score"). Every dose threshold in the corpus is stated in g/kg. There is
// therefore NO WAY to test a logged meal against one, and the tempting bridge —
// turning size 'heavy' plus tag_mix {protein: 60} into a gram figure — is
// exactly the invented reference value lib/aspects.ts bans. `tag_mix` is a
// composition slider the athlete dragged, not a measurement; on this data it is
// present on a minority of rows.
//
// So the dose claims appear here once, in `proteinTarget`, and that rule does
// not evaluate anything the athlete ate. It converts a cited target into their
// own bodyweight and their own logged meal cadence, and stops. Everything else
// tests only what was actually recorded: clock times, gaps between intakes,
// portion size, tag presence, source, and the 1–5 hunger the athlete typed in
// themselves.
//
// AND THE RULE THAT REFUSES TO FIRE. `carbTimingWindow` is gated on Galpin's own
// precondition — carbohydrate timing starts to matter at daily or twice-daily
// training, and with two or more days between sessions he says glycogen
// restores on its own. For an athlete training three or four times a week it is
// silent by construction. It is kept, rather than deleted, because a caveat
// that suppresses a plausible-sounding finding is the part of this design most
// likely to be quietly dropped in a later edit.

import { NUTRITION } from '@/lib/coach/knowledge';
import { excess, share as shareOf } from '@/lib/coach/impact';
import type { Finding } from '@/lib/coach/types';
import type { FuelTimingSignals, NutritionSignals, TrainingSignals } from '@/lib/coach/signals';
import type { MealLog, UserStats } from '@/lib/types';

const round = (n: number, d = 0) => Number(n.toFixed(d));
const pct = (v: number) => `${Math.round(v * 100)}%`;
const clock = (h: number) =>
  `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

/**
 * The cited daily protein band, expressed in this athlete's kilograms and their
 * own logged meal cadence.
 *
 * Reads nothing about what they ate — deliberately. It is the one place the
 * dose evidence is allowed to appear, and it appears as a target to aim at
 * rather than a verdict on the log. Monthly `periodKey`: a target that has not
 * moved does not need restating every week.
 */
export function proteinTarget(
  n: NutritionSignals,
  stats: UserStats | null,
  periodKey: string,
): Finding | null {
  const kg = stats?.body_weight_kg ?? null;
  if (kg == null) return null;
  if (n.mealsPerDay.sufficiency === 'insufficient') return null;

  const [low, high] = NUTRITION.proteinTarget.value;
  const floor = NUTRITION.proteinFloor.value;
  const meals = n.mealsPerDay.value;
  const perMeal = meals > 0 ? (low * kg) / meals : 0;

  return {
    ruleId: 'nutrition.dose.protein-target',
    periodKey,
    tldr: `Your protein band is ${Math.round(low * kg)}–${Math.round(high * kg)} g/day`,
    action: `Aim for about ${Math.round(perMeal)} g of protein at each of your ${round(meals, 1)} daily meals.`,
    body: `At ${kg} kg, the floor below which nobody should sit is ${Math.round(floor * kg)} g a day, and the band worth aiming at is ${Math.round(low * kg)}–${Math.round(high * kg)} g. Attia's argument for the upper end is asymmetric risk rather than more being better — "${NUTRITION.proteinTarget.quote}" — because a day spent below costs more than a day above gains. You average ${round(meals, 1)} intakes a day, which puts roughly ${Math.round(perMeal)} g on each. This app records no grams, so this is a target to aim at, not a reading of what you ate.`,
    drift: 0,
    confidence: 0.8,
    sufficiency: n.mealsPerDay.sufficiency,
    claims: [NUTRITION.proteinFloor, NUTRITION.proteinTarget],
    observed: {
      bodyWeightKg: kg,
      floorGrams: Math.round(floor * kg),
      targetLowGrams: Math.round(low * kg),
      targetHighGrams: Math.round(high * kg),
      mealsPerDay: round(meals, 1),
    },
  };
}

/**
 * Days that recorded no protein-tagged intake at all.
 *
 * The only place the daily protein evidence touches the log, and it works
 * because it needs no grams: the cited floor is stated *per day*, so a logged
 * day carrying no protein intake is below any daily target whatever the
 * portions were. Requires two such days — one is a day the athlete forgot to
 * tag, not a pattern.
 */
export function proteinGapDays(
  n: NutritionSignals,
  meals: MealLog[],
  periodKey: string,
): Finding | null {
  if (n.proteinFeedsPerDay.sufficiency === 'insufficient') return null;

  const byDay = new Map<string, boolean>();
  for (const m of meals) {
    byDay.set(m.log_date, (byDay.get(m.log_date) ?? false) || m.tags.includes('protein'));
  }
  const gapDays = [...byDay.values()].filter((hit) => !hit).length;
  if (gapDays < 2) return null;

  return {
    ruleId: 'nutrition.style.protein-gap-days',
    periodKey,
    tldr: `${gapDays} logged days with no protein tagged`,
    action: 'Anchor each day with one protein-tagged intake before anything else gets logged.',
    body: `Of the ${byDay.size} days you logged meals, ${gapDays} carried no protein-tagged intake at all. The cited floor is a daily one — "${NUTRITION.proteinFloor.quote}" — so a day with none logged sits under it regardless of portion size. Galpin's framing makes the daily total the thing that matters more than its timing: "${NUTRITION.proteinTotalOverTiming.quote}". If those days did contain protein and simply went untagged, the fix is the tag, not the meal.`,
    drift: shareOf(gapDays, byDay.size),
    confidence: n.proteinFeedsPerDay.sufficiency === 'ok' ? 0.55 : 0.35,
    sufficiency: n.proteinFeedsPerDay.sufficiency,
    claims: [NUTRITION.proteinFloor, NUTRITION.proteinTotalOverTiming],
    observed: { gapDays, daysLogged: byDay.size, proteinFeedsPerDay: round(n.proteinFeedsPerDay.value, 1) },
  };
}

/**
 * Consistently arriving at meals very hungry.
 *
 * Uses the athlete's OWN 1–5 report against its own ceiling — no external norm
 * is involved, which is what makes it safe to state without a citation. There is
 * nothing in the corpus about meal spacing, and this rule does not pretend
 * otherwise: it reports the pattern and names the gap, and leaves whether that
 * matters to the athlete.
 */
export function arrivingHungry(n: NutritionSignals, periodKey: string): Finding | null {
  if (n.meanHungerBefore.sufficiency === 'insufficient') return null;
  if (n.meanLongestGapHours.sufficiency === 'insufficient') return null;
  const hunger = n.meanHungerBefore.value;
  // 4 of 5 is the second-highest point on the athlete's own scale. Below it the
  // reading is ordinary appetite, not a pattern worth naming.
  if (hunger < 4) return null;

  const gap = n.meanLongestGapHours.value;

  return {
    ruleId: 'nutrition.timing.arriving-hungry',
    periodKey,
    tldr: `You arrive at meals at ${round(hunger, 1)}/5 hunger`,
    action: `Move one intake into the ${round(gap, 1)}-hour gap, or make the meal before it larger.`,
    body: `Across ${n.daysLogged} logged days your own hunger-before rating averages ${round(hunger, 1)} out of 5, and your longest gap between intakes averages ${round(gap, 1)} hours. Your eating window runs ${clock(n.firstMealHour.value)} to ${clock(n.lastMealHour.value)}. That is your own rating against your own scale, not a target from anywhere — the corpus says nothing about meal spacing. Worth noticing only if arriving that hungry is changing what you then eat.`,
    drift: excess(hunger, 4, 1),
    confidence: n.meanHungerBefore.sufficiency === 'ok' ? 0.5 : 0.3,
    sufficiency: n.meanHungerBefore.sufficiency,
    claims: [],
    observed: {
      meanHungerBefore: round(hunger, 1),
      meanLongestGapHours: round(gap, 1),
      firstMeal: clock(n.firstMealHour.value),
      lastMeal: clock(n.lastMealHour.value),
      daysLogged: n.daysLogged,
    },
  };
}

/**
 * Carbohydrate timing around sessions.
 *
 * GATED ON THE SOURCE'S OWN PRECONDITION and silent below it. Galpin: timing
 * starts to matter at daily or twice-daily training, and with two or more days
 * between sessions glycogen restores without it. Do not relax this gate to make
 * the rule reachable — that would be quoting him against his own caveat.
 */
export function carbTimingWindow(
  n: NutritionSignals,
  training: TrainingSignals,
  stats: UserStats | null,
  periodKey: string,
): Finding | null {
  const perWeek = training.sessionsPerWeek;
  if (perWeek.sufficiency === 'insufficient') return null;
  if (perWeek.value < NUTRITION.carbTimingPrecondition.value) return null;
  if (n.trainingDays === 0) return null;

  const unfuelled = n.trainingDays - n.trainingDaysFuelled;
  if (unfuelled < 2) return null;

  const kg = stats?.body_weight_kg ?? null;
  const lb = kg != null ? kg * 2.20462 : null;
  const carbs = lb != null ? Math.round(lb * NUTRITION.hardSessionFuel.value.carbPerLb) : null;
  const protein = lb != null ? Math.round(lb * NUTRITION.hardSessionFuel.value.proteinPerLb) : null;

  return {
    ruleId: 'nutrition.timing.carb-window',
    periodKey,
    tldr: `Training ${round(perWeek.value, 1)}×/week — fuelling timing now counts`,
    action:
      carbs != null
        ? `Get roughly ${carbs} g carbohydrate and ${protein} g protein in around each hard session.`
        : 'Get carbohydrate in around each hard session, pre, during or post.',
    body: `At ${round(perWeek.value, 1)} sessions a week you are past the point Galpin puts the precondition: "${NUTRITION.carbTimingPrecondition.quote}". Below daily training he says the opposite — glycogen restores on its own and timing can be ignored, which is why this has stayed quiet until now. ${unfuelled} of your ${n.trainingDays} logged training days recorded nothing after midday. His starting figure is "${NUTRITION.hardSessionFuel.quote}", which he calls a very rough number to scale with expenditure.`,
    drift: shareOf(unfuelled, n.trainingDays),
    confidence: 0.5,
    sufficiency: perWeek.sufficiency,
    claims: [NUTRITION.carbTimingPrecondition, NUTRITION.hardSessionFuel],
    observed: {
      sessionsPerWeek: round(perWeek.value, 1),
      trainingDays: n.trainingDays,
      unfuelledDays: unfuelled,
      carbGrams: carbs,
      proteinGrams: protein,
    },
  };
}

/**
 * Long sessions started with nothing logged beforehand.
 *
 * Gated on DURATION, which is where Galpin puts the line: unfed training is fine
 * up to about an hour and gets harder past it. Below that threshold this stays
 * silent, because he is explicit that a shorter fasted session is not a problem
 * — and because plenty of people prefer it.
 *
 * Only days where the athlete logged meals can answer this. A training day with
 * no meals logged is absent data, not a fasted session, and is excluded upstream
 * in `measureFuelTiming`.
 */
export function longSessionUnfed(
  fuel: FuelTimingSignals,
  stats: UserStats | null,
  periodKey: string,
): Finding | null {
  // Three paired days is the floor for a pattern; below it this is one odd
  // morning, and the athlete already knows about it.
  if (fuel.pairedDays < 3) return null;
  if (fuel.unfedLongSessions < 2) return null;

  const kg = stats?.body_weight_kg ?? null;
  const mins = NUTRITION.fastedDuration.value;

  return {
    ruleId: 'nutrition.timing.long-session-unfed',
    periodKey,
    tldr: `${fuel.unfedLongSessions} long sessions started unfed`,
    action: `Put something in ${mins < 90 ? 'an hour' : 'ninety minutes'} before the sessions that run past ${mins} minutes.`,
    body: `On ${fuel.unfedLongSessions} of the ${fuel.pairedDays} training days where you logged both a start time and meals, nothing was eaten before a session that ran past ${mins} minutes${fuel.meanStartHour != null ? `; your sessions start around ${clock(fuel.meanStartHour)} on average` : ''}. Galpin's line is duration-dependent — "${NUTRITION.fastedDuration.quote}" — and past that it gets harder. His caveat matters here: it also depends on the day before, since topped-off glycogen buys you a fighting chance. He separates can from should, seeing no scenario where training fasted improves performance${kg ? `, and around a hard session his starting figure is ${Math.round(kg * 2.20462 * NUTRITION.hardSessionFuel.value.carbPerLb)} g of carbohydrate` : ''}.`,
    drift: shareOf(fuel.unfedLongSessions, fuel.pairedDays),
    confidence: fuel.pairedDays >= 6 ? 0.55 : 0.35,
    sufficiency: fuel.pairedDays >= 6 ? 'ok' : 'partial',
    claims: [NUTRITION.fastedDuration, NUTRITION.hardSessionFuel],
    observed: {
      unfedLongSessions: fuel.unfedLongSessions,
      unfedSessions: fuel.unfedSessions,
      pairedDays: fuel.pairedDays,
      meanStartHour: fuel.meanStartHour != null ? clock(fuel.meanStartHour) : null,
      thresholdMinutes: mins,
    },
  };
}

/**
 * What the free text says the carbohydrate actually was.
 *
 * DESCRIPTIVE, AND IT SAYS SO. There is no claim in the corpus about rice versus
 * bread versus oats that this could test against, and the operator's own
 * position is that their carbohydrate generally carries fibre — high-fibre bread
 * and so on — so a rule scoring carb "quality" would be inventing both the
 * threshold and the deficiency. What is genuinely useful and genuinely
 * supportable is the mirror: your carbohydrate is overwhelmingly these two or
 * three things, and here is how often a vegetable appeared alongside it.
 *
 * Fires on CONCENTRATION rather than on any source being wrong, and only when
 * enough notes exist to make the share mean something.
 */
export function carbSourceConcentration(
  n: NutritionSignals,
  periodKey: string,
): Finding | null {
  const t = n.text;
  // Notes are optional. Anything under half the meals described and the top
  // share is a fact about note-taking, not about eating.
  if (t.described < 12 || t.described / Math.max(1, t.total) < 0.5) return null;
  if (t.withCarbSource < 8) return null;

  const top = t.carbCounts[0];
  if (!top) return null;
  const share = top.count / t.withCarbSource;
  if (share < 0.5) return null;

  const named = t.carbCounts
    .slice(0, 3)
    .map((c) => `${c.label} (${c.count})`)
    .join(', ');
  const vegShare = t.total ? t.vegMeals / t.total : 0;

  return {
    ruleId: 'nutrition.style.carb-concentration',
    periodKey,
    tldr: `${pct(share)} of your carbs are ${top.label}`,
    action: `Rotate one ${top.label} meal a week to a different source — variety costs nothing here.`,
    body: `Across the ${t.described} meals you described in words, ${t.withCarbSource} named a carbohydrate and ${top.count} of those were ${top.label}: ${named}. A vegetable was tagged or named in ${t.vegMeals} of ${t.total} intakes (${pct(vegShare)})${t.friedMeals > 0 ? `, and ${t.friedMeals} meal${t.friedMeals === 1 ? ' was' : 's were'} described as fried` : ''}. This is a mirror, not a verdict — nothing in the coach's evidence base ranks one carbohydrate source above another, so there is no target here to miss. Notes are optional, so treat this as a read of what you wrote down.`,
    drift: excess(share, 0.5, 0.5),
    confidence: 0.4,
    sufficiency: t.described >= 20 ? 'ok' : 'partial',
    claims: [],
    observed: {
      topSource: top.label,
      topCount: top.count,
      topShare: round(share, 2),
      describedMeals: t.described,
      totalMeals: t.total,
      vegMeals: t.vegMeals,
      friedMeals: t.friedMeals,
    },
  };
}
