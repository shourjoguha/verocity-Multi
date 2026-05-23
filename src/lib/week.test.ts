import { describe, expect, it } from 'vitest';
import { daysBetween, weekFromDate } from '@/lib/week';

describe('weekFromDate', () => {
  it('defaults to week 1 with no start date', () => {
    expect(weekFromDate(null, '2026-06-15')).toBe(1);
  });

  it('counts the start day and its first 6 days as week 1', () => {
    expect(weekFromDate('2026-06-01', '2026-06-01')).toBe(1);
    expect(weekFromDate('2026-06-01', '2026-06-07')).toBe(1);
  });

  it('rolls to week 2 on day 7 and week 3 on day 14', () => {
    expect(weekFromDate('2026-06-01', '2026-06-08')).toBe(2);
    expect(weekFromDate('2026-06-01', '2026-06-15')).toBe(3);
  });

  it('clamps dates before the start to week 1', () => {
    expect(weekFromDate('2026-06-08', '2026-06-01')).toBe(1);
  });
});

describe('daysBetween', () => {
  it('is positive when b is after a', () => {
    expect(daysBetween('2026-06-01', '2026-06-08')).toBe(7);
  });

  it('is negative when b is before a', () => {
    expect(daysBetween('2026-06-08', '2026-06-01')).toBe(-7);
  });

  it('is zero for the same day', () => {
    expect(daysBetween('2026-06-01', '2026-06-01')).toBe(0);
  });
});
