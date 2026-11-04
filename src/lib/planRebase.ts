import type { ParsedPlan } from '@/lib/types';
import { todayLocal } from '@/lib/mealPhoto';

// Program length in weeks, from the blocks (the authored structure), never
// from the author's calendar dates — those were edited by hand on real plans.
export function planWeeks(parsed: ParsedPlan): number {
  return Math.max(1, ...parsed.blocks.map((b) => b.endWeek));
}

/**
 * Re-base an adopted plan onto the adopter's calendar: start on `today`
 * (local day), end after the program's own week count. An open-ended source
 * (endDate null) stays open-ended. Everything else is untouched — ParsedPlan
 * is a frozen contract and the days/weeks are relative already.
 */
export function rebasePlanDates(parsed: ParsedPlan, today: Date): ParsedPlan {
  const startDate = todayLocal(today);
  let endDate: string | null = null;
  if (parsed.endDate) {
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + planWeeks(parsed) * 7 - 1);
    endDate = todayLocal(end);
  }
  return { ...parsed, startDate, endDate };
}
