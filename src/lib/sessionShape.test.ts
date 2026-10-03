import { describe, expect, it } from 'vitest';
import { SESSION_SHAPE, type SectionKey } from '@/app.config';
import { blockCounts, hrEffort, percentile, sessionShaper } from '@/lib/sessionShape';
import type { LogSet, WorkoutLog } from '@/lib/types';

function set(completed = true): LogSet {
  return { planned: null, actual: { reps: 5, completed, prefilled: false }, notations: [] };
}

function log(
  tag: string,
  sections: Partial<Record<SectionKey, number>> = {},
  hr: [number | null, number | null] = [null, null],
): WorkoutLog {
  return {
    tags: [tag],
    activity_type: null,
    hr_avg: hr[0],
    hr_max: hr[1],
    data: {
      sections: Object.entries(sections).map(([key, n]) => ({
        key: key as SectionKey,
        groups: [{ id: key, kind: 'single', items: [{ id: key, movement: 'X', primaryMetric: 'reps', sets: Array.from({ length: n }, () => set()) }] }],
      })),
    },
  } as unknown as WorkoutLog;
}

const { minHeight } = SESSION_SHAPE;

describe('percentile', () => {
  it('interpolates and ignores zeros', () => {
    expect(percentile([0, 10, 20], 50)).toBe(15);
    expect(percentile([], 90)).toBeNull();
  });

  it('p90 stays below a single outlier where p98 would not', () => {
    const main = [17, 18, 19, 16, 22, 10, 34];
    expect(percentile(main, 90)!).toBeLessThan(27);
    expect(percentile(main, 98)!).toBeGreaterThan(32);
  });
});

describe('blockCounts', () => {
  it('merges primary and secondary into main and counts completed sets only', () => {
    const l = log('strength', { warmup: 2, primary: 3, secondary: 4 });
    l.data.sections[1].groups[0].items[0].sets.push(set(false));
    expect(blockCounts(l)).toEqual({ warmup: 2, main: 7 });
  });
});

describe('sessionShaper — set sessions', () => {
  it('width is the share of sets, height compares with the same block in the same tag', () => {
    const big = log('strength', { primary: 20, accessory: 10 });
    const small = log('strength', { primary: 10, accessory: 10 });
    const shape = sessionShaper([big, small])(small);
    expect(shape?.kind).toBe('sets');
    if (shape?.kind !== 'sets') return;
    expect(shape.blocks.map((b) => [b.key, b.share])).toEqual([['main', 0.5], ['accessory', 0.5]]);
    const main = shape.blocks[0];
    const accessory = shape.blocks[1];
    expect(main.height).toBeLessThan(accessory.height);
    expect(accessory.height).toBe(1);
  });

  it('does not compare across tags', () => {
    const strength = log('strength', { primary: 10 });
    const hyrox = log('hyrox', { primary: 40 });
    const shape = sessionShaper([strength, hyrox])(strength);
    expect(shape?.kind === 'sets' && shape.blocks[0].height).toBe(1);
  });

  it('keeps tiny blocks visible and returns null for an empty session', () => {
    const tiny = log('strength', { primary: 1 });
    const shaper = sessionShaper([tiny, log('strength', { primary: 100 }), log('strength', { primary: 100 })]);
    const shape = shaper(tiny);
    expect(shape?.kind === 'sets' && shape.blocks[0].height).toBeGreaterThanOrEqual(minHeight);
    expect(shaper(log('strength'))).toBeNull();
  });
});

describe('sessionShaper — heart-rate sessions', () => {
  it('average dominates; max is a slight bonus', () => {
    expect(hrEffort(152, 171)).toBeGreaterThan(hrEffort(138, 184));
    expect(hrEffort(150, 190) - hrEffort(150, 170)).toBeLessThan(4);
  });

  it('sport and endurance use heart rate, ignoring set counts', () => {
    const hard = log('endurance', { conditioning: 1 }, [160, 180]);
    const easy = log('sport', { conditioning: 30 }, [130, 170]);
    const shaper = sessionShaper([hard, easy]);
    const a = shaper(hard);
    const b = shaper(easy);
    expect(a?.kind).toBe('hr');
    expect(b?.kind).toBe('hr');
    if (a?.kind !== 'hr' || b?.kind !== 'hr') return;
    expect(a.height).toBeGreaterThan(b.height);
  });

  it('a missing heart rate is reported, not guessed', () => {
    const none = log('sport');
    expect(sessionShaper([none])(none)).toEqual({ kind: 'no-hr' });
  });
});
