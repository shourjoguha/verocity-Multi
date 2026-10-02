import { describe, expect, it } from 'vitest';
import { addSet, copyForward, patchSetActual } from '@/lib/logEdits';
import type { LogDocument, LogSet, SetActual } from '@/lib/types';

const set = (a: Partial<SetActual> = {}, notations: string[] = []): LogSet => ({
  planned: '10 RPE8',
  notations,
  actual: { completed: false, prefilled: false, ...a },
});

const doc = (sets: LogSet[]): LogDocument => ({
  sections: [{ key: 'primary', groups: [{ id: 'g', kind: 'single', items: [{ id: 'i', movement: 'Iso-Lateral Row', primaryMetric: 'reps', sets }] }] }],
});

const sets = (d: LogDocument) => d.sections[0].groups[0].items[0].sets;
const done = (a: Partial<SetActual>, n: string[] = []) => set({ ...a, completed: true }, n);

describe('copyForward', () => {
  it('copies into the next existing set and never adds one', () => {
    const d = doc([done({ weight: 45, reps: 10, rpe: 8 }), set(), set()]);
    const { doc: out, outcome } = copyForward(d, 0, 0, 0, 0);
    expect(outcome).toBe('copied');
    expect(sets(out)).toHaveLength(3);
    expect(sets(out)[1].actual).toMatchObject({ weight: 45, reps: 10, rpe: 8, completed: false, prefilled: true });
  });

  it('copies into the next set even when every set is done', () => {
    const d = doc([done({ weight: 45, reps: 10 }), done({ weight: 40, reps: 12 }), done({ weight: 40, reps: 12 })]);
    const { doc: out, outcome } = copyForward(d, 0, 0, 0, 0);
    expect(outcome).toBe('copied');
    expect(sets(out)).toHaveLength(3);
    expect(sets(out)[1].actual).toMatchObject({ weight: 45, reps: 10, completed: true });
  });

  it('adds a new set from the last one only when every set is done', () => {
    const d = doc([done({ weight: 45, reps: 10 }), done({ weight: 47.5, reps: 10, rpe: 9 }, ['/side', '(p)'])]);
    const { doc: out, outcome } = copyForward(d, 0, 0, 0, 1);
    expect(outcome).toBe('added');
    expect(sets(out)).toHaveLength(3);
    expect(sets(out)[2].actual).toMatchObject({ weight: 47.5, reps: 10, rpe: 9, completed: false });
    expect(sets(out)[2].notations).toEqual(['/side', '(p)']);
  });

  it('does nothing on the last set while a set is still open', () => {
    // The 30 Sep iso-row case: 4 prescribed, copy pressed on set 4 before it was logged.
    const d = doc([done({ reps: 10 }), done({ reps: 10 }), done({ reps: 10 }), set({ weight: 47.5, reps: 10 })]);
    const { doc: out, outcome } = copyForward(d, 0, 0, 0, 3);
    expect(outcome).toBe('last-open');
    expect(out).toBe(d);
    expect(sets(out)).toHaveLength(4);
  });
});

describe('addSet (+ button)', () => {
  it('copies every logged metric and the notations of the last set', () => {
    const d = doc([
      done({ weight: 40, reps: 12, rpe: 7 }),
      done({ weight: 45, reps: 10, rpe: 8.5, time: 30, distance: 20, calories: 12 }, ['/side']),
    ]);
    const added = sets(addSet(d, 0, 0, 0))[2];
    expect(added.actual).toEqual({
      weight: 45,
      reps: 10,
      rpe: 8.5,
      time: 30,
      distance: 20,
      calories: 12,
      completed: false,
      prefilled: true,
    });
    expect(added.notations).toEqual(['/side']);
    expect(added.planned).toBe('10 RPE8');
  });

  it('carries fields it was never told about', () => {
    const d = patchSetActual(doc([set()]), 0, 0, 0, 0, { completed: true, mark: 61 } as Partial<SetActual>);
    expect((sets(addSet(d, 0, 0, 0))[1].actual as SetActual & { mark?: number }).mark).toBe(61);
  });

  it('opens on the default RPE when the last set had none', () => {
    expect(sets(addSet(doc([done({ reps: 5 })]), 0, 0, 0))[1].actual.rpe).toBeTypeOf('number');
  });
});
