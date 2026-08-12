import { MEAL_MACRO_TAGS } from '@/app.config';
import type { MealLog } from '@/lib/types';

// Meal analytics, ported from the reference design's utils/meals.ts and typed to
// MealLog (Verocity's lowercase size keys, 'HH:MM' eaten_time, 'YYYY-MM-DD'
// log_date). Pure functions — the screens compute these from the list they
// already fetched, so no new query.

// Hours rendered across every fuel/timing band: 06:00 → 23:00.
export const DAY_HOURS: number[] = Array.from({ length: 18 }, (_, i) => i + 6);

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

export function formatHour(hour: number): string {
  return String(hour).padStart(2, '0');
}

export function mealsInHour(meals: MealLog[], hour: number): MealLog[] {
  return meals.filter((meal) => Math.floor(toHours(meal.eaten_time)) === hour);
}

/**
 * Literal meal-timing heatmap: position is the hour eaten and intensity is the
 * logged portion category (capped at 1). It does not estimate calories.
 */
export function fuelByHour(meals: MealLog[]): number[] {
  return DAY_HOURS.map((hour) => {
    const portions = mealsInHour(meals, hour).reduce((sum, m) => sum + sizeWeight(m.size), 0);
    return Math.min(1, portions);
  });
}

// The macro tags a meal carries, in canonical macro order (P → C → F).
export function macroTags(meal: MealLog): string[] {
  return MEAL_MACRO_TAGS.filter((tag) => meal.tags.includes(tag));
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
  fuel: number[];
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
        fuel: fuelByHour(ordered),
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
