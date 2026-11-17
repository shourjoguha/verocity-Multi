import { describe, expect, it } from 'vitest';
import { ENDURANCE_INTENSITY, type SectionKey } from '@/app.config';
import { summarizeBodyLoad } from '@/lib/bodyLoad';
import { itemIntensity, rpeFromHeartRate } from '@/lib/enduranceIntensity';
import type { LogItem, LogSet, WorkoutLog } from '@/lib/types';

const set = (actual: Partial<LogSet['actual']>): LogSet => ({
  planned: null,
  notations: [],
  actual: { completed: true, prefilled: false, ...actual },
});
const item = (movement: string, sets: LogSet[]): LogItem => ({ id: `i-${movement}`, movement, primaryMetric: 'time', sets });
const log = (sections: { key: SectionKey; items: LogItem[] }[], extra: Partial<WorkoutLog> = {}): WorkoutLog =>
  ({
    id: extra.id ?? 'l1',
    status: 'done',
    tags: [],
    activity_type: null,
    hr_avg: null,
    hr_max: null,
    data: { sections: sections.map((s) => ({ key: s.key, groups: [{ id: `g-${s.key}`, kind: 'single', items: s.items }] })) },
    ...extra,
  }) as unknown as WorkoutLog;

const HR = { resting: 50, peak: 187 };
const D = ENDURANCE_INTENSITY.defaults;

describe('rpeFromHeartRate — % of heart-rate reserve', () => {
  it('maps the reserve onto the zone table', () => {
    // (avg - 50) / 137
    expect(rpeFromHeartRate(120, 50, 187)?.zone).toBe(1); // 51%
    expect(rpeFromHeartRate(140, 50, 187)?.zone).toBe(2); // 66%
    expect(rpeFromHeartRate(150, 50, 187)?.zone).toBe(3); // 73%
    expect(rpeFromHeartRate(165, 50, 187)?.zone).toBe(4); // 84%
    expect(rpeFromHeartRate(175, 50, 187)?.rpe).toBe(9.5); // 91%
  });

  it('says nothing without all three numbers', () => {
    expect(rpeFromHeartRate(150, null, 187)).toBeNull();
    expect(rpeFromHeartRate(150, 50, null)).toBeNull();
    expect(rpeFromHeartRate(null, 50, 187)).toBeNull();
    expect(rpeFromHeartRate(150, 190, 187)).toBeNull();
  });
});

describe('itemIntensity — rated RPE, then heart rate (activities only), then the default', () => {
  const tennis = item('Tennis', [set({ time: 3600 })]);

  it('uses a rated RPE first', () => {
    const rated = item('Tennis', [set({ time: 3600, rpe: 9, rpeRated: true })]);
    const l = log([{ key: 'conditioning', items: [rated] }], { activity_type: 'Tennis', hr_avg: 120 });
    expect(itemIntensity(l, rated, 'conditioning', HR)).toBe(9);
  });

  it('reads an activity from its heart rate when unrated', () => {
    const l = log([{ key: 'conditioning', items: [tennis] }], { activity_type: 'Tennis', tags: ['sport'], hr_avg: 165 });
    expect(itemIntensity(l, tennis, 'conditioning', HR)).toBe(8.5);
  });

  it('falls back to the sport default without heart rate', () => {
    const l = log([{ key: 'conditioning', items: [tennis] }], { activity_type: 'Tennis', tags: ['sport'] });
    expect(itemIntensity(l, tennis, 'conditioning', HR)).toBe(D.sport);
  });

  it('never reads a finisher from the session heart rate', () => {
    const swing = item('Kettlebell Swing', [set({ reps: 15 })]);
    const l = log([{ key: 'conditioning', items: [swing] }], { hr_avg: 120 });
    expect(itemIntensity(l, swing, 'conditioning', HR)).toBe(D.circuit);
  });
});

describe('summarizeBodyLoad — conditioning blocks and endurance tiers', () => {
  it('counts a finisher after lifting as endurance, hard, with no warm-up', () => {
    const l = log(
      [
        { key: 'primary', items: [item('Back Squat', [set({ weight: 100, reps: 5, rest: 180 }), set({ weight: 100, reps: 5 })])] },
        { key: 'conditioning', items: [item('Kettlebell Swing', [set({ reps: 15 }), set({ reps: 15 })]), item('Box Jump', [set({ reps: 10 })])] },
      ],
      { total_seconds: 3600 },
    );
    const s = summarizeBodyLoad([l]);
    const block = Object.values(s.conditioningBlockMinutes).reduce((a, b) => a + b, 0);
    expect(block).toBeGreaterThan(0);
    expect(s.conditioningBlockMinutes.plyometric).toBeGreaterThan(0);
    expect(s.enduranceTiers.hard).toBeCloseTo(block, 5);
    expect(s.enduranceTiers.light).toBe(0);
  });

  it('gives an activity its warm-up, and routes it by movement, not block', () => {
    const tennis = log([{ key: 'conditioning', items: [item('Tennis', [set({ time: 3600 })])] }], {
      activity_type: 'Tennis',
      tags: ['sport'],
      hr_avg: 165,
      total_seconds: 3600,
    });
    const s = summarizeBodyLoad([tennis], {}, { restingHr: 50, peakHr: 187 });
    expect(Object.values(s.conditioningBlockMinutes).every((v) => v === 0)).toBe(true);
    expect(s.enduranceTiers.light).toBeCloseTo(ENDURANCE_INTENSITY.warmupMinutes, 5);
    expect(s.enduranceTiers.hard).toBeCloseTo(60 - ENDURANCE_INTENSITY.warmupMinutes, 5);
  });

  it('keeps a yoga activity out of endurance', () => {
    const yoga = log([{ key: 'conditioning', items: [item('Yoga', [set({ time: 3600 })])] }], {
      activity_type: 'Yoga',
      total_seconds: 3600,
    });
    const s = summarizeBodyLoad([yoga]);
    expect(s.modalityMinutes.mobility).toBeGreaterThan(0);
    expect(s.enduranceTiers.light + s.enduranceTiers.hard).toBe(0);
  });
});
