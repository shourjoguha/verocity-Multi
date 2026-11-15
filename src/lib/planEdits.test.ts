import { describe, expect, it } from 'vitest';
import {
  addBlock,
  addDay,
  addSubroutine,
  copyPlanned,
  moveDay,
  nearestEarlierPlanned,
  removeBlock,
  reorder,
  setBlockEnd,
  setBlockStart,
  setBlockType,
  setDayLabel,
  setExerciseDescription,
  setExerciseRest,
  setExerciseUrl,
  setExerciseWeekNote,
  setPlanned,
} from '@/lib/planEdits';
import { isSubroutine } from '@/lib/subroutine';
import type { ParsedPlan } from '@/lib/types';

const PLAN: ParsedPlan = {
  title: 'Test',
  startDate: null,
  endDate: null,
  blocks: [],
  weeklyTemplate: ['a', 'b'],
  days: [
    { dayKey: 'a', label: 'A', exercises: [{ movement: 'Squat', section: 'primary', primaryMetric: 'weight', plannedByWeek: { 1: '3x5' } }] },
    { dayKey: 'b', label: 'B', exercises: [] },
  ],
};

describe('reorder', () => {
  it('moves an element and is a no-op for equal/out-of-range indices', () => {
    expect(reorder([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(reorder([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
    expect(reorder([1, 2, 3], 0, 9)).toEqual([1, 2, 3]);
  });
});

describe('addSubroutine / subroutine setters', () => {
  it('appends a subroutine exercise with no weeks', () => {
    const next = addSubroutine(PLAN, 0, 'Breathe', 'cooldown', 'Box breathing.');
    const ex = next.days[0].exercises.at(-1)!;
    expect(isSubroutine(ex)).toBe(true);
    expect(ex.movement).toBe('Breathe');
    expect(ex.description).toBe('Box breathing.');
    expect(Object.keys(ex.plannedByWeek)).toHaveLength(0);
  });

  it('patches description and sets/clears the url immutably', () => {
    const withSub = addSubroutine(PLAN, 0, 'Breathe', 'cooldown', 'v1');
    const ei = withSub.days[0].exercises.length - 1;
    const described = setExerciseDescription(withSub, 0, ei, 'v2');
    expect(described.days[0].exercises[ei].description).toBe('v2');
    expect(withSub.days[0].exercises[ei].description).toBe('v1'); // original untouched
    const linked = setExerciseUrl(described, 0, ei, 'https://x.test');
    expect(linked.days[0].exercises[ei].url).toBe('https://x.test');
    expect(setExerciseUrl(linked, 0, ei, '').days[0].exercises[ei].url).toBeUndefined();
  });
});

describe('moveDay', () => {
  it('reorders days and resyncs weeklyTemplate', () => {
    const next = moveDay(PLAN, 0, 1);
    expect(next.days.map((d) => d.dayKey)).toEqual(['b', 'a']);
    expect(next.weeklyTemplate).toEqual(['b', 'a']);
  });
});

describe('setDayLabel', () => {
  it('changes the label but keeps the stable dayKey', () => {
    const next = setDayLabel(PLAN, 0, 'Renamed');
    expect(next.days[0].label).toBe('Renamed');
    expect(next.days[0].dayKey).toBe('a');
  });
});

describe('addDay', () => {
  it('appends a uniquely-keyed empty day', () => {
    const next = addDay(PLAN);
    expect(next.days).toHaveLength(3);
    const keys = next.days.map((d) => d.dayKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(next.weeklyTemplate).toEqual(keys);
  });
});

describe('setPlanned', () => {
  it('sets a week value', () => {
    const next = setPlanned(PLAN, 0, 0, 2, '4x6');
    expect(next.days[0].exercises[0].plannedByWeek).toEqual({ 1: '3x5', 2: '4x6' });
  });

  it('clears a week when the value is blank', () => {
    const next = setPlanned(PLAN, 0, 0, 1, '   ');
    expect(next.days[0].exercises[0].plannedByWeek).toEqual({});
  });
});

describe('setExerciseRest', () => {
  it('sets whole, non-negative seconds and clears on undefined', () => {
    const set = setExerciseRest(PLAN, 0, 0, 90.4);
    expect(set.days[0].exercises[0].restSeconds).toBe(90);
    expect(PLAN.days[0].exercises[0].restSeconds).toBeUndefined(); // original untouched
    expect(setExerciseRest(PLAN, 0, 0, -15).days[0].exercises[0].restSeconds).toBe(0);
    const cleared = setExerciseRest(set, 0, 0, undefined).days[0].exercises[0];
    expect('restSeconds' in cleared).toBe(false);
  });

  it('leaves superset grouping and the weeks alone', () => {
    const grouped: ParsedPlan = {
      ...PLAN,
      days: [{ ...PLAN.days[0], exercises: [{ ...PLAN.days[0].exercises[0], group: { id: 'g', kind: 'superset' } }] }],
    };
    const ex = setExerciseRest(grouped, 0, 0, 60).days[0].exercises[0];
    expect(ex.group).toEqual({ id: 'g', kind: 'superset' });
    expect(ex.plannedByWeek).toEqual({ 1: '3x5' });
  });
});

describe('setExerciseWeekNote', () => {
  it('sets one week and drops an emptied map', () => {
    const noted = setExerciseWeekNote(PLAN, 0, 0, 2, 'hold');
    expect(noted.days[0].exercises[0].notesByWeek).toEqual({ 2: 'hold' });
    const cleared = setExerciseWeekNote(noted, 0, 0, 2, ' ').days[0].exercises[0];
    expect('notesByWeek' in cleared).toBe(false);
  });
});

describe('skip / restore a week', () => {
  // Alternating: programmed in W1 and W3, skipped in W2 and W4.
  const alt = setPlanned(setPlanned(PLAN, 0, 0, 3, '3x3 @85%'), 0, 0, 1, '3x5 @75%');

  it('skipping is clearing the entry', () => {
    const skipped = setPlanned(alt, 0, 0, 3, '');
    expect(skipped.days[0].exercises[0].plannedByWeek).toEqual({ 1: '3x5 @75%' });
  });

  it('restores from the nearest earlier programmed week', () => {
    const ex = alt.days[0].exercises[0];
    expect(nearestEarlierPlanned(ex, 2)).toBe('3x5 @75%');
    expect(nearestEarlierPlanned(ex, 4)).toBe('3x3 @85%');
    expect(nearestEarlierPlanned(ex, 1)).toBeNull();
  });

  it('copyPlanned writes only the listed weeks', () => {
    const next = copyPlanned(alt, 0, 0, 1, [3, 5]);
    expect(next.days[0].exercises[0].plannedByWeek).toEqual({ 1: '3x5 @75%', 3: '3x5 @75%', 5: '3x5 @75%' });
    // Nothing to copy from an empty week.
    expect(copyPlanned(alt, 0, 0, 2, [4])).toEqual(alt);
  });
});

describe('block edits', () => {
  it('addBlock starts at week 1 then after the last block', () => {
    const one = addBlock(PLAN);
    expect(one.blocks).toEqual([{ type: 'accumulation', startWeek: 1, endWeek: 1 }]);
    const two = addBlock(setBlockEnd(one, 0, 4), 'deload');
    expect(two.blocks[1]).toEqual({ type: 'deload', startWeek: 5, endWeek: 5 });
  });

  it('setBlockType / removeBlock', () => {
    const withBlock = setBlockType(addBlock(PLAN), 0, 'realization');
    expect(withBlock.blocks[0].type).toBe('realization');
    expect(removeBlock(withBlock, 0).blocks).toEqual([]);
  });

  it('clamps start ≥ 1 and keeps end ≥ start', () => {
    const b = addBlock(PLAN); // {1,1}
    expect(setBlockStart(b, 0, 0).blocks[0].startWeek).toBe(1);
    const moved = setBlockStart(setBlockEnd(b, 0, 3), 0, 5);
    expect(moved.blocks[0]).toEqual({ type: 'accumulation', startWeek: 5, endWeek: 5 });
  });

  it('setBlockEnd never drops below start', () => {
    const b = setBlockStart(addBlock(PLAN), 0, 3); // {3,3}
    expect(setBlockEnd(b, 0, 1).blocks[0].endWeek).toBe(3);
  });
});
