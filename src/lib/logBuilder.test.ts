import { describe, expect, it } from 'vitest';
import {
  buildBlankLog,
  buildLogFromPlanDay,
  buildLogFromSession,
  firstWeekWithContent,
  frameFromLogDocument,
  frameFromPlanDay,
  parsePlanned,
  resolveWeek,
} from '@/lib/logBuilder';
import type { LogDocument, PlanDay, SessionFrame } from '@/lib/types';

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

  it('treats a trailing-empty count form as that many label-less sets', () => {
    expect(parsePlanned('3x')).toEqual({ count: 3, label: '' });
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

const FRAME: SessionFrame = {
  exercises: [
    { movement: 'Leg Press', section: 'accessory', primaryMetric: 'weight', planned: '3x12' },
    { movement: 'Back Squat', section: 'primary', primaryMetric: 'weight', planned: '5x3' },
  ],
};

describe('buildLogFromSession', () => {
  it('orders sections canonically and expands planned strings into sets', () => {
    const doc = buildLogFromSession(FRAME);
    expect(doc.sections.map((s) => s.key)).toEqual(['primary', 'accessory']);
    const squat = doc.sections[0].groups[0].items[0];
    expect(squat.movement).toBe('Back Squat');
    expect(squat.sets).toHaveLength(5);
    expect(squat.sets[0].planned).toBe('3');
  });

  it('wraps each exercise in its own single-kind group', () => {
    const doc = buildLogFromSession(FRAME);
    for (const section of doc.sections) {
      for (const group of section.groups) {
        expect(group.kind).toBe('single');
        expect(group.items).toHaveLength(1);
      }
    }
  });

  it('falls back to a blank doc for an empty frame so the logger is usable', () => {
    expect(buildLogFromSession({ exercises: [] })).toEqual(buildBlankLog());
  });
});

describe('firstWeekWithContent / resolveWeek', () => {
  // Back Squat: W1,W2 ; Leg Press: W1 only.
  it('finds the earliest week with any content', () => {
    expect(firstWeekWithContent(DAY)).toBe(1);
  });

  it('keeps the preferred week when it has content', () => {
    expect(resolveWeek(DAY, 2)).toBe(2);
  });

  it('falls back to the first content week when the preferred week is empty', () => {
    // Week 9 is past everything programmed → fall back to week 1.
    expect(resolveWeek(DAY, 9)).toBe(1);
  });
});

describe('frameFromPlanDay', () => {
  it('collapses a plan day at a week into a flat frame, dropping empty rows', () => {
    const frame = frameFromPlanDay(DAY, 2);
    // Leg Press has no W2 column → empty planned → dropped.
    expect(frame.exercises).toHaveLength(1);
    expect(frame.exercises[0]).toEqual({
      movement: 'Back Squat',
      section: 'primary',
      primaryMetric: 'weight',
      planned: '4x5',
      notes: undefined,
    });
  });
});

describe('frameFromLogDocument', () => {
  it('reconstructs a planned string from set count and dominant label', () => {
    const doc: LogDocument = {
      sections: [
        {
          key: 'primary',
          groups: [
            {
              id: 'g1',
              kind: 'single',
              items: [
                {
                  id: 'i1',
                  movement: 'Bench Press',
                  primaryMetric: 'weight',
                  sets: [
                    { planned: '5', actual: { completed: true, prefilled: false }, notations: [] },
                    { planned: '5', actual: { completed: true, prefilled: false }, notations: [] },
                    { planned: '3', actual: { completed: true, prefilled: false }, notations: [] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const frame = frameFromLogDocument(doc);
    expect(frame.exercises).toHaveLength(1);
    expect(frame.exercises[0].planned).toBe('3x5'); // 3 sets, dominant label "5"
  });

  it('falls back to the set count when no planned labels exist', () => {
    const doc: LogDocument = {
      sections: [
        {
          key: 'conditioning',
          groups: [
            {
              id: 'g1',
              kind: 'single',
              items: [
                {
                  id: 'i1',
                  movement: 'Row',
                  primaryMetric: 'distance',
                  sets: [
                    { planned: null, actual: { completed: true, prefilled: false }, notations: [] },
                    { planned: null, actual: { completed: true, prefilled: false }, notations: [] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const frame = frameFromLogDocument(doc);
    expect(frame.exercises[0].planned).toBe('2x');
  });

  it('round-trips set count back through buildLogFromSession for unplanned sets', () => {
    const doc: LogDocument = {
      sections: [
        {
          key: 'conditioning',
          groups: [
            {
              id: 'g1',
              kind: 'single',
              items: [
                {
                  id: 'i1',
                  movement: 'Row',
                  primaryMetric: 'distance',
                  sets: [
                    { planned: null, actual: { completed: true, prefilled: false }, notations: [] },
                    { planned: null, actual: { completed: true, prefilled: false }, notations: [] },
                    { planned: null, actual: { completed: true, prefilled: false }, notations: [] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const rebuilt = buildLogFromSession(frameFromLogDocument(doc));
    const item = rebuilt.sections[0].groups[0].items[0];
    expect(item.sets).toHaveLength(3); // not collapsed to 1
    expect(item.sets[0].planned).toBeNull();
  });
});
