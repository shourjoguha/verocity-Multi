import type { ParsedPlan } from '@/lib/types';
import { todayLocal } from '@/lib/mealPhoto';
import { addDays } from '@/lib/holidays';

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

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Move a plan a friend sent onto the receiver's chosen start date. The end
 * date travels with it by the same number of days, so the program keeps the
 * sender's span; a source with no start date falls back to the block-derived
 * week count, and an open-ended source stays open-ended. Never touches the
 * days or blocks, and a malformed `start` returns the plan unchanged.
 */
export function shiftPlanStart(parsed: ParsedPlan, start: string): ParsedPlan {
  if (!YMD.test(start) || Number.isNaN(Date.parse(`${start}T00:00:00Z`))) return parsed;
  if (!parsed.endDate) return { ...parsed, startDate: start, endDate: null };
  const from = parsed.startDate && YMD.test(parsed.startDate) ? parsed.startDate : null;
  const span = from ? daysBetween(from, parsed.endDate) : planWeeks(parsed) * 7 - 1;
  return { ...parsed, startDate: start, endDate: addDays(start, span) };
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
