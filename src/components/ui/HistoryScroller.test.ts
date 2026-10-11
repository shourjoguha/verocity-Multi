import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDateRange } from './HistoryScroller';

describe('formatDateRange', () => {
  afterEach(() => vi.useRealTimers());

  it('omits the year inside the current year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T12:00:00Z'));
    expect(formatDateRange('2026-03-03', '2026-03-30')).toBe('3 Mar – 30 Mar');
  });

  it('names the year on both ends once the range leaves the current year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
    expect(formatDateRange('2025-12-15', '2026-01-04')).toBe('15 Dec 2025 – 4 Jan 2026');
  });

  it('spells September as Sep', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T12:00:00Z'));
    expect(formatDateRange('2026-08-29', '2026-09-25')).toBe('29 Aug – 25 Sep');
  });

  it('does not shift a day across timezones (parses as UTC)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T12:00:00Z'));
    expect(formatDateRange('2026-01-01', '2026-01-01')).toBe('1 Jan – 1 Jan');
  });
});
