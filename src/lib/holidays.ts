// Planned breaks (migration 0049). Pure: no DOM, no storage, no queries.
//
// A holiday is a DATE RANGE, never a workout log, and it is never training.
// The readers allowed to change because of one are deliberately few:
//   - the week streak (lib/streak.ts) treats a mostly-away week as a pause;
//   - the coach (lib/coach/signals.ts) leaves holiday days out of every weekly
//     rate and is told whether the break was active or plain rest;
//   - the calendar and the consistency grid draw it.
// Volume, the body map, sessionLens, PRs and plan adherence never read it.
// Plan adherence needs nothing: its denominator is paced by logging, so a week
// away already costs it nothing (see planAdherence.ts).
import { HOLIDAY, HOLIDAY_KINDS, type HolidayKindKey } from '@/app.config';
import type { Holiday } from '@/lib/types';

/** What every holiday reader needs. `Holiday` rows satisfy it. */
export type HolidayRange = Pick<Holiday, 'kind' | 'starts_on' | 'ends_on'> &
  Partial<Pick<Holiday, 'id' | 'name'>>;

const DAY_MS = 86_400_000;
const dayNo = (ymd: string) => Date.parse(`${ymd.slice(0, 10)}T00:00:00Z`) / DAY_MS;
const fromDayNo = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

export function addDays(ymd: string, n: number): string {
  return fromDayNo(dayNo(ymd) + n);
}

/** Inclusive length in days. */
export function holidayDays(h: Pick<HolidayRange, 'starts_on' | 'ends_on'>): number {
  return dayNo(h.ends_on) - dayNo(h.starts_on) + 1;
}

export function holidayLabel(h: Pick<HolidayRange, 'kind' | 'name'>): string {
  return h.name?.trim() || HOLIDAY_KINDS[h.kind as HolidayKindKey].label;
}

export function isActiveHoliday(h: Pick<HolidayRange, 'kind'>): boolean {
  return HOLIDAY_KINDS[h.kind as HolidayKindKey]?.active ?? false;
}

/** The holiday covering `ymd`, if any. Holidays never overlap (0049). */
export function holidayOn<T extends HolidayRange>(holidays: readonly T[], ymd: string): T | null {
  const d = ymd.slice(0, 10);
  return holidays.find((h) => h.starts_on <= d && d <= h.ends_on) ?? null;
}

/**
 * Every holiday day as a ymd key, optionally clipped to [from, to] inclusive.
 * The set the coach and the streak consult.
 */
export function holidayDayKeys(
  holidays: readonly HolidayRange[],
  from?: string,
  to?: string,
): Set<string> {
  const out = new Set<string>();
  for (const h of holidays) {
    const a = Math.max(dayNo(h.starts_on), from ? dayNo(from) : -Infinity);
    const b = Math.min(dayNo(h.ends_on), to ? dayNo(to) : Infinity);
    for (let n = a; n <= b; n++) out.add(fromDayNo(n));
  }
  return out;
}

export type HolidayDraft = { kind: string; starts_on: string; ends_on: string };

/**
 * Why a draft cannot be saved, or null. `others` are the athlete's existing
 * holidays minus the one being edited. The database enforces order, length and
 * overlap too (0049) — this is the courtesy that says which holiday clashed.
 */
export function validateHoliday(
  draft: HolidayDraft,
  others: readonly HolidayRange[],
): string | null {
  if (!(draft.kind in HOLIDAY_KINDS)) return 'Pick what kind of holiday it was.';
  if (!draft.starts_on || !draft.ends_on) return 'Pick both dates.';
  if (draft.ends_on < draft.starts_on) return 'The end date is before the start date.';
  if (holidayDays(draft) > HOLIDAY.maxDays) {
    return `A holiday can be at most ${HOLIDAY.maxDays} days. Split a longer break in two.`;
  }
  const clash = others.find((h) => draft.starts_on <= h.ends_on && draft.ends_on >= h.starts_on);
  if (clash) return `Overlaps ${holidayLabel(clash)} (${clash.starts_on} to ${clash.ends_on}).`;
  return null;
}

/**
 * What the coach is told about breaks inside its window: how many days to
 * leave out of weekly rates, and how many of them were spent moving.
 */
export interface HolidayContext {
  /** Holiday days inside the window. */
  days: number;
  /** Of those, days on an active holiday (hike / dive / ski). */
  activeDays: number;
  /** The holidays touching the window, oldest first. */
  breaks: { label: string; kind: string; active: boolean; starts_on: string; ends_on: string }[];
}

export function holidayContext(
  holidays: readonly HolidayRange[],
  from: string,
  to: string,
): HolidayContext {
  const touching = holidays
    .filter((h) => h.ends_on >= from && h.starts_on <= to)
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  let days = 0;
  let activeDays = 0;
  for (const h of touching) {
    const n = holidayDayKeys([h], from, to).size;
    days += n;
    if (isActiveHoliday(h)) activeDays += n;
  }
  return {
    days,
    activeDays,
    breaks: touching.map((h) => ({
      label: holidayLabel(h),
      kind: h.kind,
      active: isActiveHoliday(h),
      starts_on: h.starts_on,
      ends_on: h.ends_on,
    })),
  };
}
