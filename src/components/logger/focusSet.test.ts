import { describe, expect, it } from 'vitest';
import { RPE } from '@/app.config';
import type { LogGroup, LogItem, LogSet, SetActual } from '@/lib/types';
import {
  copyPreviousPatch,
  firstOpenSet,
  nextOpenSet,
  previousLoggedSet,
  rpeScale,
  rpeTapPatch,
  selectedRpe,
} from './focusSet';

const set = (completed: boolean, extra: Partial<SetActual> = {}): LogSet => ({
  planned: null,
  actual: { completed, prefilled: false, ...extra },
  notations: [],
});
const item = (id: string, sets: LogSet[]): LogItem => ({ id, movement: id, primaryMetric: 'reps', sets });

describe('nextOpenSet', () => {
  it('is the first open set of a single movement', () => {
    const g: LogGroup = { id: 'g', kind: 'single', items: [item('a', [set(true), set(false), set(false)])] };
    expect(nextOpenSet(g)).toEqual({ ii: 0, ki: 1 });
  });

  it('alternates a superset by round, in member order', () => {
    const g: LogGroup = {
      id: 'g',
      kind: 'superset',
      items: [item('a', [set(true), set(false)]), item('b', [set(false), set(false)])],
    };
    // Round 1: a done, b open → b set 1 before a set 2.
    expect(nextOpenSet(g)).toEqual({ ii: 1, ki: 0 });
  });

  it('skips subroutines and is null when everything is logged', () => {
    const sub: LogItem = { id: 's', movement: 'note', primaryMetric: 'reps', sets: [], kind: 'subroutine' };
    const g: LogGroup = { id: 'g', kind: 'superset', items: [sub, item('a', [set(true)])] };
    expect(nextOpenSet(g)).toBeNull();
    expect(firstOpenSet(sub)).toBe(-1);
  });
});

describe('previousLoggedSet', () => {
  it('reads the last LOGGED set before the live one, not merely the one before', () => {
    const it = item('a', [set(true), set(false), set(false)]);
    expect(previousLoggedSet(it, 2)).toBe(0);
    expect(previousLoggedSet(it, 0)).toBe(-1);
  });
});

describe('copyPreviousPatch — RPE provenance', () => {
  it('copies measured fields, never completion, and stamps prefilled', () => {
    const p = copyPreviousPatch({ completed: true, prefilled: false, weight: 150, reps: 5, rest: 180 });
    expect(p).toEqual({ prefilled: true, weight: 150, reps: 5 });
    expect('completed' in p).toBe(false);
  });

  it('leaves RPE untouched when the source RPE was only seeded', () => {
    const p = copyPreviousPatch({ completed: true, prefilled: true, weight: 100, rpe: 8, rpeRated: false });
    expect('rpe' in p).toBe(false);
    expect('rpeRated' in p).toBe(false);
  });

  it('copies a RATED RPE as a rating — the copy key is an explicit choice', () => {
    const p = copyPreviousPatch({ completed: true, prefilled: false, weight: 100, rpe: 8.5, rpeRated: true });
    expect(p.rpe).toBe(8.5);
    expect(p.rpeRated).toBe(true);
  });
});

describe('inline RPE picker', () => {
  it('shows nothing selected for a seeded, defaulted or pre-field RPE', () => {
    expect(selectedRpe({ completed: false, prefilled: true, rpe: RPE.default, rpeRated: false })).toBeNull();
    expect(selectedRpe({ completed: false, prefilled: true, rpe: 8 })).toBeNull();
    expect(selectedRpe({ completed: false, prefilled: true, rpe: 8, rpeRated: true })).toBe(8);
  });

  it('rates on tap, and withdraws the rating on a second tap of the same value', () => {
    const a: SetActual = { completed: false, prefilled: true, rpe: 7, rpeRated: false };
    expect(rpeTapPatch(a, 7)).toEqual({ rpe: 7, rpeRated: true });
    expect(rpeTapPatch({ ...a, rpeRated: true }, 7)).toEqual({ rpeRated: false });
    expect(rpeTapPatch({ ...a, rpeRated: true }, 8)).toEqual({ rpe: 8, rpeRated: true });
  });

  it('spans the configured scale', () => {
    const s = rpeScale();
    expect(s[0]).toBe(RPE.pickerMin);
    expect(s[s.length - 1]).toBe(RPE.max);
    // A rated value below the row's start pulls the start down to include it.
    expect(rpeScale(5.5)[0]).toBe(5.5);
    expect(rpeScale(8)[0]).toBe(RPE.pickerMin);
  });
});
