import { describe, expect, it } from 'vitest';
import {
  addBlock,
  addDay,
  moveDay,
  removeBlock,
  reorder,
  setBlockEnd,
  setBlockStart,
  setBlockType,
  setDayLabel,
  setPlanned,
} from '@/lib/planEdits';
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
