import { describe, expect, it } from 'vitest';
import {
  addBlock,
  addDay,
  addSubroutine,
  moveDay,
  removeBlock,
  reorder,
  setBlockEnd,
  setBlockStart,
  setBlockType,
  setDayLabel,
  setExerciseDescription,
  setExerciseUrl,
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
