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
import type { Finding } from '@/lib/coach/types';
import type { NutritionSignals, TrainingSignals } from '@/lib/coach/signals';
import type { MealLog, UserStats } from '@/lib/types';

const round = (n: number, d = 0) => Number(n.toFixed(d));
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
    drift: round(Math.min(1, gapDays / Math.max(1, byDay.size)), 2),
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
    drift: round(Math.min(1, (hunger - 4) / 1), 2),
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
    drift: round(Math.min(1, unfuelled / Math.max(1, n.trainingDays)), 2),
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
