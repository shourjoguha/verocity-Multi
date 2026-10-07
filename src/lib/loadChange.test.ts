import { describe, expect, it } from 'vitest';
import { buildLoadIndex, formatLoadChanges, loadChanges } from '@/lib/loadChange';
import type { WorkoutLog } from '@/lib/types';

type S = { w?: number; r?: number; done?: boolean; n?: string[] };
function log(
  id: string,
  date: string,
  sections: Record<string, Record<string, S[]>>,
  status = 'done',
): WorkoutLog {
  return {
    id,
    log_date: date,
    status,
    tags: [],
    data: {
      sections: Object.entries(sections).map(([key, items]) => ({
        key,
        groups: [
          {
            id: key,
            kind: 'single',
            items: Object.entries(items).map(([movement, sets]) => ({
              id: movement,
              movement,
              primaryMetric: 'reps',
              sets: sets.map((x) => ({
                planned: null,
                notations: x.n ?? [],
                actual: { weight: x.w, reps: x.r ?? 5, completed: x.done ?? true, prefilled: false },
              })),
            })),
          },
        ],
      })),
    },
  } as unknown as WorkoutLog;
}

const wk1 = log('a', '2026-09-29', {
  primary: { 'Front Squat': [{ w: 80 }, { w: 80 }], 'Landmine Row': [{ w: 12.5 }] },
});
const wk2 = log('b', '2026-10-06', {
  warmup: { 'Front Squat': [{ w: 40 }] },
  primary: { 'Front Squat': [{ w: 80 }, { w: 85 }, { w: 85 }, { w: 86 }], 'Landmine Row': [{ w: 12.5 }] },
});

describe('loadChanges', () => {
  const index = buildLoadIndex([wk1, wk2]);

  it('compares mean working load with the last earlier session, warm-up excluded', () => {
    expect(loadChanges(wk2, index)).toEqual([
      { movement: 'Front Squat', delta: 4 },
      { movement: 'Landmine Row', delta: 0 },
    ]);
  });

  it('says nothing about a movement done for the first time', () => {
    expect(loadChanges(wk1, index)).toEqual([]);
  });

  it('skips sets with no weight and sets not completed', () => {
    const l = log('c', '2026-10-13', {
      primary: { 'Front Squat': [{ w: 90 }, { w: 200, done: false }], 'Push-up': [{}] },
    });
    expect(loadChanges(l, buildLoadIndex([wk1, wk2, l]))).toEqual([{ movement: 'Front Squat', delta: 6 }]);
  });

  it('keeps a variation on its own line', () => {
    const v = log('d', '2026-10-13', { primary: { 'Front Squat': [{ w: 60, n: ['(v)'] }] } });
    expect(loadChanges(v, buildLoadIndex([wk1, wk2, v]))).toEqual([]);
  });

  it('ignores sessions that are not finished', () => {
    const open = log('e', '2026-10-01', { primary: { 'Front Squat': [{ w: 120 }] } }, 'in_progress');
    expect(loadChanges(wk2, buildLoadIndex([wk1, open, wk2]))[0]).toEqual({
      movement: 'Front Squat',
      delta: 4,
    });
  });
});

// The formatter glues each item with no-break characters; read them as plain.
const plain = (s: string | null) => s?.replace(/\u00a0/g, ' ').replace(/\u2011/g, '-') ?? null;

describe('formatLoadChanges', () => {
  it('prints the top three, compactly, with a count for the rest', () => {
    expect(
      plain(formatLoadChanges([
        { movement: 'Front Squat', delta: 4 },
        { movement: 'Snatch', delta: -2 },
        { movement: 'Row', delta: 2.5 },
        { movement: 'Curl', delta: 0 },
      ])),
    ).toBe('Front Squat +4 · Snatch −2 · Row +2.5 · +1 more');
  });

  it('marks an unchanged load with =', () => {
    expect(plain(formatLoadChanges([{ movement: 'Row', delta: 0.01 }]))).toBe('Row =');
  });

  it('never breaks a line inside one movement', () => {
    const s = formatLoadChanges([{ movement: 'Iso-lateral Row', delta: 2.5 }]) as string;
    expect(s).not.toMatch(/[ -]/);
  });

  it('returns null when nothing compares', () => {
    expect(formatLoadChanges([])).toBeNull();
  });
});
