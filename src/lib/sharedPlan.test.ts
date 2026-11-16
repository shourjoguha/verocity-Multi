import { describe, expect, it } from 'vitest';
import { planToSave, readSharedPlanPayload } from '@/lib/sharedPlan';

const parsed = {
  title: 'Strength block',
  startDate: '2026-04-20',
  endDate: '2026-06-14',
  blocks: [{ type: 'accumulation', startWeek: 1, endWeek: 8 }],
  weeklyTemplate: ['mon'],
  days: [
    {
      dayKey: 'mon',
      label: 'Monday',
      exercises: [{ movement: 'Squat', section: 'primary', primaryMetric: 'weight', plannedByWeek: { 1: '3x5' } }],
    },
  ],
};
const payload = { name: 'Strength block', start_date: '2026-04-20', end_date: '2026-06-14', parsed, source_markdown: null };

describe('readSharedPlanPayload', () => {
  it('reads a valid plan and counts its days', () => {
    const r = readSharedPlanPayload(payload);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dayCount).toBe(1);
      expect(r.value.start_date).toBe('2026-04-20');
    }
  });

  it('rejects hostile shapes without throwing', () => {
    expect(readSharedPlanPayload(null).ok).toBe(false);
    expect(readSharedPlanPayload({ parsed: { title: 'x', days: 'nope', blocks: [] } }).ok).toBe(false);
    expect(readSharedPlanPayload({ parsed: { ...parsed, days: [{ dayKey: 'a', label: 'a', exercises: [null] }] } }).ok).toBe(false);
    expect(readSharedPlanPayload({ parsed: { ...parsed, days: [{ dayKey: 'a', label: 'a' }] } }).ok).toBe(false);
  });

  it('rejects a plan validateParsedPlan refuses', () => {
    expect(readSharedPlanPayload({ ...payload, parsed: { ...parsed, days: [] } }).ok).toBe(false);
  });

  it('rejects a javascript: link on an exercise', () => {
    const bad = {
      ...parsed,
      days: [{ ...parsed.days[0], exercises: [{ movement: 'Breathe', section: 'primary', primaryMetric: 'weight', plannedByWeek: {}, url: 'javascript:alert(1)' }] }],
    };
    expect(readSharedPlanPayload({ ...payload, parsed: bad }).ok).toBe(false);
  });
});

describe('planToSave', () => {
  it('shifts the dates and keeps the plan body', () => {
    const r = readSharedPlanPayload(payload);
    if (!r.ok) throw new Error('fixture');
    const out = planToSave(r.value, '2026-05-04');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.parsed.startDate).toBe('2026-05-04');
      expect(out.parsed.endDate).toBe('2026-06-28');
      expect(out.parsed.days).toBe(r.value.parsed.days);
    }
  });
});
