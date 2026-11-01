import { describe, expect, it } from 'vitest';
import { summarizeSets } from '@/lib/setSummary';
import type { SetActual } from '@/lib/types';

const s = (a: Partial<SetActual>): SetActual => ({ completed: true, prefilled: false, rpeRated: true, ...a });

describe('summarizeSets', () => {
  it('writes the load once per run and lists the reps', () => {
    const out = summarizeSets([
      s({ weight: 20, reps: 4, rpe: 8.5 }),
      s({ weight: 15, reps: 5, rpe: 8 }),
      s({ weight: 15, reps: 5, rpe: 8 }),
      s({ weight: 15, reps: 5, rpe: 9 }),
      s({ weight: 15, reps: 4, rpe: 9 }),
    ]);
    expect(out.line).toBe('20kg × 4 · 15kg × 5, 5, 5, 4');
    expect(out.count).toBe(5);
    expect(out.rpe).toBe('@8–9');
  });

  it('gives bare reps a unit and calories theirs', () => {
    expect(summarizeSets([s({ reps: 8 }), s({ reps: 8 })]).line).toBe('8, 8 reps');
    expect(summarizeSets([s({ calories: 15 }), s({ calories: 5 })]).line).toBe('15, 5 cal');
  });

  it('keeps a secondary field as a shared extra instead of mixing it into the list', () => {
    const out = summarizeSets([s({ weight: 2.5, reps: 5, time: 300 }), s({ weight: 2.5, reps: 5, time: 300 })]);
    expect(out.line).toBe('2.5kg × 5, 5 · 5m');
  });

  it('ignores RPE the athlete never rated', () => {
    expect(summarizeSets([s({ reps: 8, rpe: 7, rpeRated: false })]).rpe).toBeNull();
    expect(summarizeSets([s({ reps: 8, rpe: 7 }), s({ reps: 8, rpe: 7 })]).rpe).toBe('@7');
  });

  it('drops empty sets and says so when nothing is left', () => {
    const out = summarizeSets([s({}), s({})]);
    expect(out).toEqual({ line: '—', count: 0, rpe: null });
  });
});
