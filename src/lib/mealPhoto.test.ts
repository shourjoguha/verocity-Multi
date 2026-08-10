import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fitWithin, todayLocal } from '@/lib/mealPhoto';

describe('fitWithin', () => {
  it('scales a landscape photo down to the longest edge', () => {
    expect(fitWithin(4032, 3024, 1280)).toEqual({ width: 1280, height: 960 });
  });

  it('scales a portrait photo down to the longest edge', () => {
    expect(fitWithin(3024, 4032, 1280)).toEqual({ width: 960, height: 1280 });
  });

  it('never upscales a photo already smaller than the max edge', () => {
    expect(fitWithin(800, 600, 1280)).toEqual({ width: 800, height: 600 });
  });

  it('scales a square photo to a square', () => {
    expect(fitWithin(2000, 2000, 1280)).toEqual({ width: 1280, height: 1280 });
  });
});

describe('todayLocal', () => {
  // `new Date().toISOString().slice(0,10)` — the bug this module deliberately
  // does NOT repeat (see the doc comment on todayLocal) — reads the UTC date.
  // For a timezone behind UTC (e.g. US Pacific, UTC-8), UTC crosses midnight
  // several hours before the local clock does, so that pattern reports
  // "tomorrow" while it is still "today" locally. Pin TZ to reproduce that
  // window deterministically regardless of the runner's own timezone.
  const originalTz = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'America/Los_Angeles'; // UTC-7/-8
  });

  afterAll(() => {
    process.env.TZ = originalTz;
  });

  it('returns the local day, not the UTC day, once UTC has already rolled to tomorrow', () => {
    // 2026-08-10 23:00 UTC = 2026-08-10 16:00 America/Los_Angeles (PDT, UTC-7).
    // UTC has not rolled over yet here, so pick a later UTC instant instead:
    // 2026-08-11 04:00 UTC = 2026-08-10 21:00 PDT — UTC says the 11th, local
    // says the 10th.
    const d = new Date(Date.UTC(2026, 7, 11, 4, 0, 0));
    expect(d.toISOString().slice(0, 10)).toBe('2026-08-11');
    expect(todayLocal(d)).toBe('2026-08-10');
  });

  it('pads single-digit month and day', () => {
    const d = new Date(Date.UTC(2026, 0, 5, 20, 0, 0)); // 2026-01-05 12:00 PST
    expect(todayLocal(d)).toBe('2026-01-05');
  });
});
