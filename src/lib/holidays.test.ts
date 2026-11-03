import { describe, expect, it } from 'vitest';
import { HOLIDAY_KINDS } from '@/app.config';
import {
  addDays,
  holidayContext,
  holidayDayKeys,
  holidayDays,
  holidayLabel,
  holidayOn,
  validateHoliday,
} from '@/lib/holidays';
import type { HolidayKind } from '@/lib/types';
import { readFileSync } from 'node:fs';

const h = (kind: HolidayKind, starts_on: string, ends_on: string, name: string | null = null) => ({
  kind,
  starts_on,
  ends_on,
  name,
});

describe('holiday dates', () => {
  it('counts inclusive days across a month end', () => {
    expect(holidayDays(h('dive', '2026-10-29', '2026-11-02'))).toBe(5);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('lists day keys, clipped to a window', () => {
    const keys = holidayDayKeys([h('hike', '2026-10-12', '2026-10-19')], '2026-10-15', '2026-11-01');
    expect([...keys]).toEqual(['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19']);
  });

  it('finds the holiday covering a day, ends included', () => {
    const list = [h('hike', '2026-09-21', '2026-09-26'), h('dive', '2026-10-12', '2026-10-19')];
    expect(holidayOn(list, '2026-10-19')?.kind).toBe('dive');
    expect(holidayOn(list, '2026-10-20')).toBeNull();
  });

  it('labels by name, else by kind', () => {
    expect(holidayLabel(h('dive', '2026-10-12', '2026-10-19', 'Red Sea'))).toBe('Red Sea');
    expect(holidayLabel(h('dive', '2026-10-12', '2026-10-19', '  '))).toBe('Diving');
  });
});

describe('validateHoliday', () => {
  const others = [h('dive', '2026-10-12', '2026-10-19', 'Red Sea')];
  it('accepts a clean range', () => {
    expect(validateHoliday({ kind: 'ski', starts_on: '2027-01-16', ends_on: '2027-01-23' }, others)).toBeNull();
  });
  it('refuses a reversed range, an overlong one, and an overlap that it names', () => {
    expect(validateHoliday({ kind: 'ski', starts_on: '2027-01-23', ends_on: '2027-01-16' }, others)).toMatch(/before/);
    expect(validateHoliday({ kind: 'ski', starts_on: '2027-01-01', ends_on: '2027-03-15' }, others)).toMatch(/at most/);
    expect(validateHoliday({ kind: 'hike', starts_on: '2026-10-19', ends_on: '2026-10-22' }, others)).toMatch(/Red Sea/);
  });
});

describe('holidayContext', () => {
  it('splits window days into active and rest', () => {
    const ctx = holidayContext(
      [h('hike', '2026-10-01', '2026-10-04'), h('beach', '2026-10-20', '2026-10-30')],
      '2026-10-03',
      '2026-10-25',
    );
    expect(ctx.days).toBe(2 + 6);
    expect(ctx.activeDays).toBe(2);
    expect(ctx.breaks.map((b) => b.active)).toEqual([true, false]);
  });
});

describe('vocabulary stays in step with the database', () => {
  it('HOLIDAY_KINDS keys are exactly the 0049 CHECK list', () => {
    const sql = readFileSync('supabase/migrations/0049_holidays.sql', 'utf8');
    const check = sql.match(/kind in \(([^)]*)\)/)![1];
    const dbKinds = check.split(',').map((s) => s.trim().replace(/'/g, ''));
    expect(Object.keys(HOLIDAY_KINDS).sort()).toEqual(dbKinds.sort());
  });
});
