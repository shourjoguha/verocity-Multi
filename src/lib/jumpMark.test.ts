import { describe, expect, it } from 'vitest';
import { cmToIn, defaultMarkKind, inToCm, markKindOf, markLabel } from '@/lib/jumpMark';
import { addSet, setItemMark, setItemMarkKind } from '@/lib/logEdits';
import { formatSetActual } from '@/lib/format';
import type { LogDocument, LogItem } from '@/lib/types';

describe('defaultMarkKind', () => {
  it('marks box and depth jumps by height', () => {
    expect(defaultMarkKind('Box Jump')).toBe('height');
    expect(defaultMarkKind('Depth Jump')).toBe('height');
    expect(defaultMarkKind('Hurdle Hop')).toBe('height');
  });

  it('marks horizontal jumps by distance', () => {
    for (const n of ['Broad Jump', 'Lateral Bound', 'Skater Jump', 'Single-Leg Hop', 'Bounding']) {
      expect(defaultMarkKind(n)).toBe('distance');
    }
  });

  it('leaves in-place, loaded and non-jump work unmarked', () => {
    for (const n of ['Jump Rope', 'Pogo Hops', 'Tuck Jump', 'Jump Squat', 'Box Step-up', 'Dumbbell Snatch', 'Med-Ball Throw', 'Back Squat']) {
      expect(defaultMarkKind(n)).toBeNull();
    }
  });
});

describe('markKindOf', () => {
  it('lets the item override the name, including switching off', () => {
    expect(markKindOf({ movement: 'Box Jump' })).toBe('height');
    expect(markKindOf({ movement: 'Box Jump', markKind: 'off' })).toBeNull();
    expect(markKindOf({ movement: 'Med-Ball Throw', markKind: 'distance' })).toBe('distance');
  });
});

describe('units and labels', () => {
  it('converts box inches to whole cm and back', () => {
    expect(inToCm(24)).toBe(61);
    expect(cmToIn(61)).toBe(24);
  });

  it('labels a box with inches and a jump in cm', () => {
    expect(markLabel('height', 61)).toBe('61cm box (24in)');
    expect(markLabel('distance', 212)).toBe('212cm');
    expect(markLabel('distance', undefined)).toBe('');
  });

  it('shows the mark in the compact set line', () => {
    expect(formatSetActual({ reps: 3, mark: 61, completed: true, prefilled: false })).toBe('3 reps 61cm');
  });
});

describe('log edits', () => {
  const item: LogItem = {
    id: 'i',
    movement: 'Box Jump',
    primaryMetric: 'reps',
    sets: [1, 2, 3].map(() => ({ planned: null, notations: [], actual: { reps: 3, completed: false, prefilled: false } })),
  };
  const doc: LogDocument = { sections: [{ key: 'conditioning', groups: [{ id: 'g', kind: 'single', items: [item] }] }] };
  const at = (d: LogDocument) => d.sections[0].groups[0].items[0];

  it('writes a box height to every set', () => {
    expect(at(setItemMark(doc, 0, 0, 0, 61)).sets.every((s) => s.actual.mark === 61)).toBe(true);
  });

  it('keeps logged marks when the field is switched off', () => {
    const off = setItemMarkKind(setItemMark(doc, 0, 0, 0, 61), 0, 0, 0, 'off');
    expect(at(off).markKind).toBe('off');
    expect(at(off).sets[0].actual.mark).toBe(61);
  });

  it('carries the mark onto an added set', () => {
    const added = addSet(setItemMark(doc, 0, 0, 0, 61), 0, 0, 0);
    expect(at(added).sets[3].actual.mark).toBe(61);
  });
});
