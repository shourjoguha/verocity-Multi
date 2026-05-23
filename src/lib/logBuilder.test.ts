import { describe, expect, it } from 'vitest';
import { addMovement, buildBlankLog, buildLogFromPlanDay, parsePlanned } from '@/lib/logBuilder';
import type { PlanDay } from '@/lib/types';

describe('parsePlanned', () => {
  it('splits "3x5" into count and label', () => {
    expect(parsePlanned('3x5')).toEqual({ count: 3, label: '5' });
  });

  it('accepts the unicode × separator', () => {
    expect(parsePlanned('5×3')).toEqual({ count: 5, label: '3' });
  });

  it('keeps the remainder of the label after the count', () => {
    expect(parsePlanned('4x8 @70%')).toEqual({ count: 4, label: '8 @70%' });
  });

  it('tolerates surrounding spaces', () => {
    expect(parsePlanned('  3 x 5 ')).toEqual({ count: 3, label: '5' });
  });

  it('falls back to a single set for unstructured strings', () => {
    expect(parsePlanned('AMRAP')).toEqual({ count: 1, label: 'AMRAP' });
  });

  it('never produces a count below 1', () => {
    expect(parsePlanned('0x5')).toEqual({ count: 1, label: '5' });
  });
});

const DAY: PlanDay = {
  dayKey: 'mon',
  label: 'Monday',
  exercises: [
    { movement: 'Leg Press', section: 'accessory', primaryMetric: 'weight', plannedByWeek: { 1: '3x12' } },
    { movement: 'Back Squat', section: 'primary', primaryMetric: 'weight', plannedByWeek: { 1: '3x5', 2: '4x5' } },
  ],
};

describe('buildLogFromPlanDay', () => {
  it('orders sections canonically regardless of exercise order', () => {
    const doc = buildLogFromPlanDay(DAY, 1);
    expect(doc.sections.map((s) => s.key)).toEqual(['primary', 'accessory']);
  });

  it('expands the week planned string into that many sets', () => {
    const doc = buildLogFromPlanDay(DAY, 1);
    const squat = doc.sections[0].groups[0].items[0];
    expect(squat.movement).toBe('Back Squat');
    expect(squat.sets).toHaveLength(3);
    expect(squat.sets[0].planned).toBe('5');
    expect(squat.primaryMetric).toBe('weight');
  });

  it('uses the requested week and falls back to a single blank set when absent', () => {
    const doc = buildLogFromPlanDay(DAY, 2);
    const squat = doc.sections[0].groups[0].items[0];
    expect(squat.sets).toHaveLength(4); // W2 = 4x5
    const legPress = doc.sections[1].groups[0].items[0];
    expect(legPress.sets).toHaveLength(1); // no W2 entry
    expect(legPress.sets[0].planned).toBeNull();
  });

  it('wraps each exercise in its own single-kind group', () => {
    const doc = buildLogFromPlanDay(DAY, 1);
    for (const section of doc.sections) {
      for (const group of section.groups) {
        expect(group.kind).toBe('single');
        expect(group.items).toHaveLength(1);
      }
    }
  });
});

describe('buildBlankLog', () => {
  it('returns one empty accessory section', () => {
    expect(buildBlankLog()).toEqual({ sections: [{ key: 'accessory', groups: [] }] });
  });
});

describe('addMovement', () => {
  it('appends a single-set group to an existing section without mutating the input', () => {
    const doc = buildBlankLog();
    const next = addMovement(doc, 'accessory', 'Curl', 'weight');
    expect(doc.sections[0].groups).toHaveLength(0); // original untouched
    expect(next.sections[0].groups).toHaveLength(1);
    const item = next.sections[0].groups[0].items[0];
    expect(item.movement).toBe('Curl');
    expect(item.sets).toHaveLength(1);
    expect(next.sections[0].groups[0].kind).toBe('single');
  });

  it('creates the section when it does not exist yet', () => {
    const next = addMovement(buildBlankLog(), 'conditioning', 'Row', 'distance');
    const section = next.sections.find((s) => s.key === 'conditioning');
    expect(section).toBeDefined();
    expect(section!.groups[0].items[0].primaryMetric).toBe('distance');
  });
});
