import { describe, expect, it } from 'vitest';
import { planWeeks, rebasePlanDates } from '@/lib/planRebase';
import type { ParsedPlan } from '@/lib/types';

const base: ParsedPlan = {
  title: 'T',
  startDate: '2026-04-20',
  endDate: '2026-10-31',
  blocks: [
    { type: 'accumulation', startWeek: 1, endWeek: 4 },
    { type: 'deload', startWeek: 5, endWeek: 8 },
  ],
  weeklyTemplate: ['a'],
  days: [{ dayKey: 'a', label: 'A', exercises: [] }],
};

describe('rebasePlanDates', () => {
  it('starts today and ends after the block-derived week count, not the source span', () => {
    const out = rebasePlanDates(base, new Date(2026, 10, 4));
    expect(out.startDate).toBe('2026-11-04');
    expect(out.endDate).toBe('2026-12-29'); // 8 weeks, inclusive
  });

  it('keeps an open-ended source open-ended', () => {
    expect(rebasePlanDates({ ...base, endDate: null }, new Date(2026, 10, 4)).endDate).toBeNull();
  });

  it('leaves the plan body untouched', () => {
    const out = rebasePlanDates(base, new Date(2026, 10, 4));
    expect(out.days).toBe(base.days);
    expect(out.blocks).toBe(base.blocks);
  });

  it('planWeeks reads the last block', () => {
    expect(planWeeks(base)).toBe(8);
  });
});
