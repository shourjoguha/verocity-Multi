import { describe, expect, it } from 'vitest';
import { compressPrescription, digestDay, regularWeeks } from '@/lib/planSummary';
import type { ParsedPlan, PlanExercise } from '@/lib/types';

const ex = (plannedByWeek: Record<number, string>, extra: Partial<PlanExercise> = {}): PlanExercise => ({
  movement: 'Front Squat',
  section: 'primary',
  primaryMetric: 'reps',
  plannedByWeek,
  ...extra,
});

// Cooking the Base's shape: accumulation 1–6, deload 7, intensification 8.
const plan: ParsedPlan = {
  title: 'T',
  startDate: null,
  endDate: null,
  blocks: [
    { type: 'accumulation', startWeek: 1, endWeek: 6 },
    { type: 'deload', startWeek: 7, endWeek: 7 },
    { type: 'intensification', startWeek: 8, endWeek: 8 },
  ],
  weeklyTemplate: [],
  days: [],
};

describe('regularWeeks', () => {
  it('drops deload weeks', () => {
    expect(regularWeeks(plan)).toEqual([1, 2, 3, 4, 5, 6, 8]);
  });
  it('falls back to every week when the plan is all deload', () => {
    expect(regularWeeks({ ...plan, blocks: [{ type: 'deload', startWeek: 1, endWeek: 2 }] })).toEqual([1, 2]);
  });
});

describe('compressPrescription', () => {
  const weeks = regularWeeks(plan);

  it('ranges sets and reps, ignores the deload week, strips RPE and load', () => {
    const fs = ex({ 1: '5x5 @80kg RPE7', 2: '5x3-5 RPE8', 6: '5x3-5 RPE8', 7: '3x3 RPE6', 8: '5x3-5 RPE8' });
    expect(compressPrescription(fs, weeks)).toBe('5 × 3–5');
  });

  it('keeps /side', () => {
    expect(compressPrescription(ex({ 1: '6x5/side @17.5kg RPE8', 2: '6x5/side RPE8' }), weeks)).toBe('6 × 5/side');
  });

  it('reads a substitution arrow and +% marks', () => {
    expect(compressPrescription(ex({ 1: '→Back Squat 3x4 R9', 2: '4x5 +5% R8' }), weeks)).toBe('3–4 × 4–5');
  });

  it('renders time in minutes when whole, seconds otherwise', () => {
    expect(compressPrescription(ex({ 1: '1x360', 2: '1x600' }, { primaryMetric: 'time' }), weeks)).toBe('1 × 6–10 min');
    expect(compressPrescription(ex({ 1: '2x45' }, { primaryMetric: 'time' }), weeks)).toBe('2 × 45s');
  });

  it('labels distance and calories', () => {
    expect(compressPrescription(ex({ 1: '1x500' }, { primaryMetric: 'distance' }), weeks)).toBe('1 × 500 m');
    expect(compressPrescription(ex({ 1: '5x15 RPE8' }, { primaryMetric: 'cal' }), weeks)).toBe('5 × 15 cal');
  });

  it('reads count-only forms', () => {
    expect(compressPrescription(ex({ 1: 'x4 trips', 2: 'x3 trips' }), weeks)).toBe('3–4 trips');
  });

  it('is null when no regular week has a readable prescription', () => {
    expect(compressPrescription(ex({ 1: '', 7: '3x3' }), weeks)).toBeNull();
  });
});

describe('digestDay', () => {
  it('counts prep instead of listing it, and skips subroutines', () => {
    const day = {
      dayKey: 'a',
      label: 'Squat',
      exercises: [
        ex({ 1: '1x500' }, { section: 'warmup', movement: 'Zone 2' }),
        ex({ 1: '5x5' }),
        ex({}, { kind: 'subroutine', movement: 'Notes' }),
        ex({ 1: '2x60' }, { section: 'cooldown', movement: 'Couch stretch' }),
      ],
    };
    expect(digestDay(day, [1])).toEqual({
      rows: [{ movement: 'Front Squat', prescription: '5 × 5' }],
      prepCount: 2,
    });
  });
});
