import { MEAL_MACRO_TAGS } from '@/app.config';
import type { MealLog, MealTagMix } from '@/lib/types';

export type MacroKey = (typeof MEAL_MACRO_TAGS)[number];

// Meal analytics, ported from the reference design's utils/meals.ts and typed to
// MealLog (Verocity's lowercase size keys, 'HH:MM' eaten_time, 'YYYY-MM-DD'
// log_date). Pure functions — the screens compute these from the list they
// already fetched, so no new query.

const SIZE_WEIGHT: Record<string, number> = {
  light: 0.4,
  medium: 0.7,
  heavy: 1,
};

export function sizeWeight(size: string): number {
  return SIZE_WEIGHT[size] ?? 0.7;
}

export function toHours(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h + m / 60;
}

/**
 * The macro split to DRAW for a meal: integer percents over the P/C/F keys it
 * carries, summing to 100, or null when there is nothing honest to draw.
 *
 *   - no macro tags          -> null
 *   - one macro              -> that macro at 100 (true by definition)
 *   - 2+ macros, no tag_mix  -> null ("split not set"), never an even guess
 *   - 2+ macros with a mix   -> the P/C/F values renormalised to 100. Older
 *     rows carry sweet/coffee keys in the same object; they are dropped here
 *     rather than in every reader.
 *
 * Largest-remainder rounding, so the parts still sum to exactly 100.
 */
export function macroMix(tags: string[], tagMix: MealTagMix | null): Partial<Record<MacroKey, number>> | null {
  const macros = MEAL_MACRO_TAGS.filter((k) => tags.includes(k));
  if (macros.length === 0) return null;
  if (macros.length === 1) return { [macros[0]]: 100 };
  if (!tagMix) return null;
  const raw = macros.map((k) => Math.max(0, Number(tagMix[k]) || 0));
  const total = raw.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const exact = raw.map((v) => (v * 100) / total);
  const floored = exact.map(Math.floor);
  let rest = 100 - floored.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((v, i) => [v - floored[i], i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of byRemainder) {
    if (rest <= 0) break;
    floored[i] += 1;
    rest -= 1;
  }
  const out: Partial<Record<MacroKey, number>> = {};
  macros.forEach((k, i) => {
    out[k] = floored[i];
  });
  return out;
}

/**
 * Horizontal positions (0-100) for the Home fuel chart's bars. Each bar sits
 * at the minute it was eaten, except that bars closer than `minGap` are nudged
 * apart and laid side by side, centred on where the group really was — so two
 * meals ten minutes apart read as two bars, and their adjacency still says
 * "closer than the scale can show".
 *
 * Classic 1-D de-overlap: merge neighbours into clusters, centre each cluster
 * on its members' mean, clamp to the track, repeat until nothing overlaps.
 * Returns positions in the INPUT order.
 */
export function layoutFuelBars(minutes: number[], startMin: number, endMin: number, minGap: number): number[] {
  const span = endMin - startMin;
  const want = minutes.map((m) => Math.min(100, Math.max(0, ((m - startMin) / span) * 100)));
  const order = want.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  if (order.length === 0) return [];
  const gap = Math.min(minGap, 100 / Math.max(1, order.length - 1));

  // Each cluster: indices (into `order`) it spans, and its left edge.
  let clusters = order.map((idx) => ({ members: [idx], left: want[idx] }));
  for (;;) {
    for (const c of clusters) {
      const width = (c.members.length - 1) * gap;
      const centre = c.members.reduce((sum, i) => sum + want[i], 0) / c.members.length;
      c.left = Math.min(100 - width, Math.max(0, centre - width / 2));
    }
    const merged: typeof clusters = [];
    let changed = false;
    for (const c of clusters) {
      const prev = merged[merged.length - 1];
      if (prev && prev.left + (prev.members.length - 1) * gap + gap > c.left + 1e-9) {
        prev.members.push(...c.members);
        changed = true;
      } else {
        merged.push({ members: [...c.members], left: c.left });
      }
    }
    clusters = merged;
    if (!changed) break;
  }

  const out = new Array<number>(minutes.length);
  for (const c of clusters) c.members.forEach((idx, k) => (out[idx] = c.left + k * gap));
  return out;
}

// Newest day first; meals within a day newest-first. Self-contained (does not
// assume the caller pre-sorted), so it is safe for either read path.
export function groupByDate(meals: MealLog[]): { date: string; meals: MealLog[] }[] {
  const map = new Map<string, MealLog[]>();
  for (const meal of meals) {
    map.set(meal.log_date, [...(map.get(meal.log_date) ?? []), meal]);
  }
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, list]) => ({
      date,
      meals: [...list].sort((a, b) => (a.eaten_time < b.eaten_time ? 1 : -1)),
    }));
}

export interface DayInsight {
  date: string;
  weekday: string;
  meals: MealLog[];
  firstMeal: string | null;
  lastMeal: string | null;
  hungerBefore: number;
  hungerAfter: number;
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function buildDayInsights(meals: MealLog[], days: number): DayInsight[] {
  return groupByDate(meals)
    .slice(0, days)
    .map(({ date, meals: dayMeals }) => {
      // Ascending within the day so first/last read chronologically.
      const ordered = [...dayMeals].sort((a, b) => (a.eaten_time < b.eaten_time ? -1 : 1));
      const avg = (pick: (m: MealLog) => number) =>
        ordered.length ? ordered.reduce((sum, m) => sum + pick(m), 0) / ordered.length : 0;
      return {
        date,
        weekday: WEEKDAYS[new Date(`${date}T12:00:00`).getDay()],
        meals: ordered,
        firstMeal: ordered[0]?.eaten_time ?? null,
        lastMeal: ordered[ordered.length - 1]?.eaten_time ?? null,
        hungerBefore: avg((m) => m.hunger_before),
        hungerAfter: avg((m) => m.hunger_after),
      };
    });
}

export interface TimingSummary {
  averageFirstMeal: string;
  averageLastMeal: string;
  averageGap: string;
  lateNights: number;
  mealsPerDay: string;
  hungerBefore: number;
  hungerAfter: number;
}

function formatClock(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function summarizeTiming(days: DayInsight[]): TimingSummary {
  const withMeals = days.filter((day) => day.meals.length > 0);
  const mean = (values: number[]) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

  const firsts = withMeals.map((day) => toHours(day.firstMeal as string));
  const lasts = withMeals.map((day) => toHours(day.lastMeal as string));

  return {
    averageFirstMeal: firsts.length ? formatClock(mean(firsts)) : '—',
    averageLastMeal: lasts.length ? formatClock(mean(lasts)) : '—',
    averageGap: firsts.length ? `${mean(lasts.map((v, i) => v - firsts[i])).toFixed(1)}h` : '—',
    lateNights: withMeals.filter((day) => toHours(day.lastMeal as string) >= 21).length,
    mealsPerDay: withMeals.length ? mean(withMeals.map((day) => day.meals.length)).toFixed(1) : '0',
    hungerBefore: mean(withMeals.map((day) => day.hungerBefore)),
    hungerAfter: mean(withMeals.map((day) => day.hungerAfter)),
  };
}

export function tagShare(
  meals: MealLog[],
  tags: readonly string[],
): { tag: string; count: number; share: number }[] {
  return tags.map((tag) => {
    const count = meals.filter((meal) => meal.tags.includes(tag)).length;
    return { tag, count, share: meals.length ? count / meals.length : 0 };
  });
}
