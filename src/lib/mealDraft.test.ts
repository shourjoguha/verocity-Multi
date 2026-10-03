import { describe, expect, it } from 'vitest';
import {
  applyPreset,
  clearPreset,
  differsFromPreset,
  draftFor,
  moveDivider,
  placeholderMix,
  presetInputFromDraft,
  toDraft,
  toggleTag,
  toInput,
} from '@/lib/mealDraft';
import type { MealLog, MealPreset } from '@/lib/types';

function meal(overrides: Partial<MealLog>): MealLog {
  return {
    id: 'm',
    owner_user_id: 'u',
    log_date: '2026-08-10',
    eaten_time: '08:00',
    size: 'medium',
    kind: 'meal',
    source: 'home',
    tags: [],
    tag_mix: null,
    carb_fibre_pct: null,
    preset_id: null,
    note: null,
    hunger_before: 4,
    hunger_after: 1,
    photo_path: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function preset(overrides: Partial<MealPreset> = {}): MealPreset {
  return {
    id: 'p1',
    owner_user_id: 'u',
    name: 'Oats',
    size: 'medium',
    kind: 'meal',
    source: 'home',
    tags: ['protein', 'carbs', 'fat'],
    tag_mix: { protein: 25, carbs: 60, fat: 15 },
    carb_fibre_pct: 25,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

const NOW = new Date(2026, 9, 3, 12, 7);

describe('draftFor', () => {
  it('snack sets kind=snack, size=light', () => {
    const d = draftFor({ kind: 'snack' }, NOW);
    expect(d.kind).toBe('snack');
    expect(d.size).toBe('light');
    expect(d.tags).toEqual(['protein', 'carbs', 'fat']);
  });

  it('meal is all defaults, every macro ticked, split and fibre not set', () => {
    const d = draftFor({ kind: 'meal' }, NOW);
    expect(d).toMatchObject({
      kind: 'meal',
      size: 'medium',
      tags: ['protein', 'carbs', 'fat'],
      tagMix: null,
      carbFibrePct: null,
      presetId: null,
    });
    expect(d.time).toBe('12:05');
  });

  it('preset keeps its own tags rather than the all-macro default', () => {
    const d = draftFor({ kind: 'preset', preset: preset({ tags: ['protein'], tag_mix: null, carb_fibre_pct: null }) }, NOW);
    expect(d.tags).toEqual(['protein']);
  });

  it('preset prefills every meal field and records where it started', () => {
    const d = draftFor({ kind: 'preset', preset: preset() }, NOW);
    expect(d).toMatchObject({
      size: 'medium',
      tags: ['protein', 'carbs', 'fat'],
      tagMix: { protein: 25, carbs: 60, fat: 15 },
      carbFibrePct: 25,
      presetId: 'p1',
    });
    expect(d.time).toBe('12:05');
  });
});

describe('applyPreset / clearPreset', () => {
  it('keeps the time and notes of the draft it is applied to', () => {
    const base = { ...draftFor({ kind: 'meal' }, NOW), time: '07:30', notes: 'after run' };
    const d = applyPreset(base, preset());
    expect(d.time).toBe('07:30');
    expect(d.notes).toBe('after run');
  });

  it('clearing returns to a plain draft with the same time and no preset', () => {
    const d = clearPreset({ ...applyPreset(draftFor({ kind: 'meal' }, NOW), preset()), time: '07:30' }, NOW);
    expect(d).toMatchObject({ time: '07:30', tags: ['protein', 'carbs', 'fat'], tagMix: null, presetId: null });
  });
});

describe('toggleTag', () => {
  it('resets the split when the set of macros changes', () => {
    const d = { ...draftFor({ kind: 'meal' }, NOW), tags: ['protein', 'carbs'], tagMix: { protein: 60, carbs: 40 } };
    expect(toggleTag(d, 'fat').tagMix).toBeNull();
  });

  it('keeps the split when only an extra (sweet/coffee) changes', () => {
    const d = { ...draftFor({ kind: 'meal' }, NOW), tags: ['protein', 'carbs'], tagMix: { protein: 60, carbs: 40 } };
    expect(toggleTag(d, 'coffee').tagMix).toEqual({ protein: 60, carbs: 40 });
  });

  it('drops the fibre share with the carbs — it is a share of nothing otherwise', () => {
    const d = { ...draftFor({ kind: 'meal' }, NOW), tags: ['protein', 'carbs'], carbFibrePct: 50 };
    expect(toggleTag(d, 'carbs').carbFibrePct).toBeNull();
    expect(toggleTag(d, 'fat').carbFibrePct).toBe(50);
  });
});

describe('split bar', () => {
  it('placeholder is an even split in whole steps, summing to 100', () => {
    expect(placeholderMix(['protein', 'carbs'])).toEqual({ protein: 50, carbs: 50 });
    expect(placeholderMix(['protein', 'carbs', 'fat'])).toEqual({ protein: 30, carbs: 30, fat: 40 });
  });

  it('moving a divider changes only its two neighbours and snaps to the step', () => {
    const mix = { protein: 30, carbs: 30, fat: 40 };
    expect(moveDivider(mix, ['protein', 'carbs', 'fat'], 0, 41)).toEqual({ protein: 40, carbs: 20, fat: 40 });
    expect(moveDivider(mix, ['protein', 'carbs', 'fat'], 1, 80)).toEqual({ protein: 30, carbs: 50, fat: 20 });
  });

  it('never squeezes a neighbour below one step', () => {
    const mix = { protein: 50, carbs: 50 };
    expect(moveDivider(mix, ['protein', 'carbs'], 0, 100)).toEqual({ protein: 95, carbs: 5 });
    expect(moveDivider(mix, ['protein', 'carbs'], 0, -20)).toEqual({ protein: 5, carbs: 95 });
  });
});

describe('toInput', () => {
  it('writes no split for a single macro and no fibre without carbs', () => {
    const d = { ...draftFor({ kind: 'meal' }, NOW), tags: ['protein'], tagMix: { protein: 100 }, carbFibrePct: 50 };
    const input = toInput(d, null);
    expect(input.tag_mix).toBeNull();
    expect(input.carb_fibre_pct).toBeNull();
  });

  it('writes an unset split as null, never as a placeholder', () => {
    const d = { ...draftFor({ kind: 'meal' }, NOW), tags: ['protein', 'carbs'] };
    expect(toInput(d, null).tag_mix).toBeNull();
  });

  it('carries the split, fibre and preset link', () => {
    const d = draftFor({ kind: 'preset', preset: preset() }, NOW);
    expect(toInput(d, 'u/x.jpg')).toMatchObject({
      tag_mix: { protein: 25, carbs: 60, fat: 15 },
      carb_fibre_pct: 25,
      preset_id: 'p1',
      photo_path: 'u/x.jpg',
    });
  });

  it('trims an empty note to null and keeps a real one trimmed', () => {
    expect(toInput({ ...draftFor({ kind: 'meal' }, NOW), notes: '   ' }, null).note).toBeNull();
    expect(toInput({ ...draftFor({ kind: 'meal' }, NOW), notes: '  rice  ' }, null).note).toBe('rice');
  });
});

describe('toDraft', () => {
  it('keeps a legacy tag on edit so saving does not drop it', () => {
    const d = toDraft(meal({ tags: ['protein', 'veg'] }));
    expect(toInput(d, null).tags).toEqual(['protein', 'veg']);
  });

  it('reads only the P/C/F keys of an older mix, renormalised', () => {
    const d = toDraft(meal({ tags: ['protein', 'carbs', 'sweet'], tag_mix: { protein: 45, carbs: 45, sweet: 10 } }));
    expect(d.tagMix).toEqual({ protein: 50, carbs: 50 });
  });
});

describe('saved meals', () => {
  it('saves only vocabulary tags', () => {
    const d = { ...draftFor({ kind: 'meal' }, NOW), tags: ['protein', 'veg'] };
    expect(presetInputFromDraft(d, '  Eggs ').tags).toEqual(['protein']);
    expect(presetInputFromDraft(d, '  Eggs ').name).toBe('Eggs');
  });

  it('an untouched draft does not differ from its saved meal', () => {
    const p = preset();
    const d = { ...draftFor({ kind: 'preset', preset: p }, NOW), time: '06:00', notes: 'x', hungerBefore: 1 };
    expect(differsFromPreset(d, p)).toBe(false);
  });

  it('changing size, a macro, the split or the fibre share counts as a change', () => {
    const p = preset();
    const d = draftFor({ kind: 'preset', preset: p }, NOW);
    expect(differsFromPreset({ ...d, size: 'heavy' }, p)).toBe(true);
    expect(differsFromPreset(toggleTag(d, 'fat'), p)).toBe(true);
    expect(differsFromPreset({ ...d, tagMix: { protein: 30, carbs: 55, fat: 15 } }, p)).toBe(true);
    expect(differsFromPreset({ ...d, carbFibrePct: 50 }, p)).toBe(true);
  });
});
