import { describe, expect, it } from 'vitest';
import {
  buildBlankLog,
  buildLogFromPlanDay,
  buildLogFromSession,
  daysToMiniSessions,
  firstWeekWithContent,
  frameFromLogDocument,
  frameFromPlanDay,
  parsePlanned,
  reduceLogDocument,
  resolveWeek,
} from '@/lib/logBuilder';
import type { LogDocument, ParsedPlan, PlanDay, SessionFrame } from '@/lib/types';

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

describe('reduceLogDocument (minis)', () => {
  // warmup + primary + secondary + accessory, one item each.
  const full: LogDocument = {
    sections: (['warmup', 'primary', 'secondary', 'accessory'] as const).map((key) => ({
      key,
      groups: [
        {
          id: `g-${key}`,
          kind: 'single' as const,
          items: [{ id: `i-${key}`, movement: key, primaryMetric: 'weight' as const, sets: [] }],
        },
      ],
    })),
  };

  it('express keeps only warmup + primary', () => {
    const doc = reduceLogDocument(full, 'express');
    expect(doc.sections.map((s) => s.key)).toEqual(['warmup', 'primary']);
  });

  it('half keeps warmup + primary + secondary', () => {
    const doc = reduceLogDocument(full, 'half');
    expect(doc.sections.map((s) => s.key)).toEqual(['warmup', 'primary', 'secondary']);
  });

  it('falls back to the first section when no preset section is present', () => {
    const conditioningOnly: LogDocument = {
      sections: [{ key: 'conditioning', groups: [{ id: 'g', kind: 'single', items: [{ id: 'i', movement: 'Row', primaryMetric: 'distance', sets: [] }] }] }],
    };
    const doc = reduceLogDocument(conditioningOnly, 'express');
    expect(doc.sections.map((s) => s.key)).toEqual(['conditioning']);
  });
});

describe('daysToMiniSessions', () => {
  const plan: ParsedPlan = {
    title: 'Block',
    startDate: null,
    endDate: null,
    blocks: [],
    weeklyTemplate: ['mon', 'empty'],
    days: [
      DAY,
      { dayKey: 'empty', label: 'Empty', exercises: [] },
    ],
  };

  it('turns each non-empty day into a mini session tagged to the plan', () => {
    const minis = daysToMiniSessions(plan, 'plan-1');
    expect(minis).toHaveLength(1); // the empty day is dropped
    expect(minis[0]).toMatchObject({
      name: 'Monday',
      source_plan_id: 'plan-1',
      source_day_key: 'mon',
      is_mini: true,
    });
    expect(minis[0].frame.exercises.length).toBeGreaterThan(0);
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

describe('subroutines round-trip', () => {
  const planDay: PlanDay = {
    dayKey: 'mon',
    label: 'Monday',
    exercises: [
      { movement: 'Back Squat', section: 'primary', primaryMetric: 'weight', plannedByWeek: { 1: '3x5' } },
      {
        kind: 'subroutine',
        movement: 'Box breathing',
        section: 'cooldown',
        primaryMetric: 'reps',
        plannedByWeek: {},
        description: '5 rounds of 4-4-4-4.',
        url: 'https://example.com/breathe',
      },
    ],
  };

  it('builds a subroutine log item with no sets and carries the text/link', () => {
    const doc = buildLogFromPlanDay(planDay, 1);
    const cooldown = doc.sections.find((s) => s.key === 'cooldown')!;
    const item = cooldown.groups[0].items[0];
    expect(item.kind).toBe('subroutine');
    expect(item.movement).toBe('Box breathing');
    expect(item.sets).toHaveLength(0);
    expect(item.description).toBe('5 rounds of 4-4-4-4.');
    expect(item.url).toBe('https://example.com/breathe');
  });

  it('keeps a subroutine when collapsing a plan day into a frame (not dropped for empty planned)', () => {
    const frame = frameFromPlanDay(planDay, 1);
    const sub = frame.exercises.find((e) => e.movement === 'Box breathing')!;
    expect(sub.kind).toBe('subroutine');
    expect(sub.description).toBe('5 rounds of 4-4-4-4.');
    expect(sub.url).toBe('https://example.com/breathe');
  });

  it('round-trips a subroutine through frameFromLogDocument → buildLogFromSession', () => {
    const built = buildLogFromPlanDay(planDay, 1);
    const rebuilt = buildLogFromSession(frameFromLogDocument(built));
    const item = rebuilt.sections.find((s) => s.key === 'cooldown')!.groups[0].items[0];
    expect(item.kind).toBe('subroutine');
    expect(item.sets).toHaveLength(0);
    expect(item.description).toBe('5 rounds of 4-4-4-4.');
    expect(item.url).toBe('https://example.com/breathe');
  });
});
