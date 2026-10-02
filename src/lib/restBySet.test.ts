import { describe, expect, it } from 'vitest';
import { TIMERS } from '@/app.config';
import { addSet, restBeforeSet, setSetRest } from '@/lib/logEdits';
import { classifyIntent } from '@/lib/coach/intent';
import { logsToCsv } from '@/lib/exportData';
import type { LogDocument, LogGroup, LogItem, LogSet, WorkoutLog } from '@/lib/types';

const set = (rest?: number): LogSet => ({
  planned: null,
  notations: [],
  actual: { weight: 100, reps: 5, completed: true, prefilled: false, ...(rest != null ? { rest } : {}) },
});
const item = (sets: LogSet[], restSeconds = 60): LogItem => ({ id: 'i', movement: 'Back Squat', primaryMetric: 'reps', restSeconds, sets });
const doc = (it: LogItem): LogDocument => ({ sections: [{ key: 'primary', groups: [{ id: 'g', kind: 'single', items: [it] }] }] });
const at = (d: LogDocument) => d.sections[0].groups[0].items[0];

describe('rest presets', () => {
  it('offers 45 and 75 between the existing tags, in order', () => {
    expect(TIMERS.restPresets).toEqual([0, 30, 45, 60, 75, 90, 120, 180, 300]);
  });
});

describe('vary rest by set', () => {
  it('sets and clears one set without touching the others', () => {
    let d = doc(item([set(), set(), set()]));
    d = setSetRest(d, 0, 0, 0, 2, 180);
    expect(at(d).sets.map((s) => s.actual.rest)).toEqual([undefined, undefined, 180]);
    d = setSetRest(d, 0, 0, 0, 2, null);
    expect('rest' in at(d).sets[2].actual).toBe(false);
  });

  it("falls back to the movement's tag", () => {
    const it = item([set(), set(), set(180)], 60);
    expect([0, 1, 2].map((k) => restBeforeSet(it, k))).toEqual([60, 60, 180]);
  });

  it('carries a set rest onto a set added with +', () => {
    expect(at(addSet(doc(item([set(), set(180)])), 0, 0, 0)).sets[2].actual.rest).toBe(180);
  });

  it('exports the rest that applied to each set', () => {
    const log = { log_date: '2026-10-03', status: 'done', data: doc(item([set(), set(180)], 60)) } as unknown as WorkoutLog;
    const [header, ...rows] = logsToCsv([log]).split('\n');
    const col = header.split(',').indexOf('rest_s');
    expect(rows.map((r) => r.split(',')[col])).toEqual(['60', '180']);
  });
});

describe('coach reads the set rest first', () => {
  const group = (it: LogItem): LogGroup => ({ id: 'g', kind: 'single', items: [it] });

  it('a long rest on one set makes that set strength work', () => {
    const it = item([set()], 60);
    expect(classifyIntent({ item: it, group: group(it), restBoundarySeconds: 120 }).intent).not.toBe('strength');
    const v = classifyIntent({ item: it, group: group(it), setRestSeconds: 180, restBoundarySeconds: 120 });
    expect(v.intent).toBe('strength');
    expect(v.restSeconds).toBe(180);
    expect(v.restAssumed).toBe(false);
  });
});
