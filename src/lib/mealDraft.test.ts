import { describe, expect, it } from 'vitest';
import { MEAL_REPEAT_LIMIT, MEAL_REPEAT_SEED } from '@/app.config';
import {
  defaultTagMix,
  draftFor,
  mixKeysOrdered,
  normalizeTag,
  recomputeMix,
  repeatShortcuts,
  setMixValue,
  splitTags,
  toDraft,
  toInput,
} from '@/lib/mealDraft';
import type { MealLog } from '@/lib/types';

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
    note: null,
    hunger_before: 4,
    hunger_after: 1,
    photo_path: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('draftFor', () => {
  it('snack preset sets kind=snack, size=light', () => {
    const draft = draftFor({ kind: 'snack' });
    expect(draft.kind).toBe('snack');
    expect(draft.size).toBe('light');
  });

  it('meal preset sets kind=meal, size=medium (the default)', () => {
    const draft = draftFor({ kind: 'meal' });
    expect(draft.kind).toBe('meal');
    expect(draft.size).toBe('medium');
  });

  it('custom preset is all defaults with no tags', () => {
    const draft = draftFor({ kind: 'custom' });
    expect(draft.kind).toBe('meal');
    expect(draft.size).toBe('medium');
    expect(draft.source).toBe('home');
    expect(draft.tags).toEqual([]);
    expect(draft.customTags).toEqual([]);
  });

  it('repeat preset preselects the tag as a custom tag on a meal draft', () => {
    const draft = draftFor({ kind: 'repeat', tag: 'post-workout' });
    expect(draft.kind).toBe('meal');
    expect(draft.customTags).toContain('post-workout');
  });
});

describe('toInput', () => {
  it('merges tags + customTags into one array and drops photoUrl', () => {
    const draft = draftFor({ kind: 'custom' });
    draft.tags = ['protein'];
    draft.customTags = ['post-workout'];
    draft.photoUrl = 'blob:whatever';
    const input = toInput(draft, 'u/abc.jpg');
    expect(input.tags).toEqual(['protein', 'post-workout']);
    expect('photoUrl' in input).toBe(false);
    expect(input.photo_path).toBe('u/abc.jpg');
  });

  it('trims an empty note to null', () => {
    const draft = draftFor({ kind: 'custom' });
    draft.notes = '   ';
    const input = toInput(draft, null);
    expect(input.note).toBeNull();
  });

  it('keeps a non-empty note trimmed', () => {
    const draft = draftFor({ kind: 'custom' });
    draft.notes = '  worth remembering  ';
    const input = toInput(draft, null);
    expect(input.note).toBe('worth remembering');
  });
});

describe('splitTags', () => {
  it('separates suggested tags from custom tags by set difference', () => {
    const { suggested, custom } = splitTags(['protein', 'post-workout']);
    expect(suggested).toEqual(['protein']);
    expect(custom).toEqual(['post-workout']);
  });
});

describe('normalizeTag', () => {
  it('trims, collapses inner whitespace, and lowercases', () => {
    expect(normalizeTag('  Post   Workout ')).toBe('post workout');
  });

  it('returns null for a tag that is empty after trimming', () => {
    expect(normalizeTag('   ')).toBeNull();
  });
});

describe('repeatShortcuts', () => {
  it('orders distinct custom tags newest meal first', () => {
    const meals = [
      meal({ tags: ['post-workout', 'meal-prep'] }), // newest
      meal({ tags: ['travel'] }),
    ];
    const shortcuts = repeatShortcuts(meals);
    expect(shortcuts.slice(0, 3)).toEqual(['post-workout', 'meal-prep', 'travel']);
  });

  it('dedupes a custom tag repeated across meals, keeping the newest position', () => {
    const meals = [meal({ tags: ['post-workout'] }), meal({ tags: ['post-workout', 'travel'] })];
    const shortcuts = repeatShortcuts(meals);
    expect(shortcuts.filter((t) => t === 'post-workout')).toHaveLength(1);
    expect(shortcuts.indexOf('post-workout')).toBeLessThan(shortcuts.indexOf('travel'));
  });

  it('unions MEAL_REPEAT_SEED rather than duplicating it', () => {
    const meals = [meal({ tags: ['post-workout'] })];
    const shortcuts = repeatShortcuts(meals);
    expect(shortcuts.filter((t) => t === MEAL_REPEAT_SEED[0])).toHaveLength(1);
  });

  it('includes the seed when no meals have custom tags yet', () => {
    expect(repeatShortcuts([])).toEqual([...MEAL_REPEAT_SEED]);
  });

  it('caps at MEAL_REPEAT_LIMIT', () => {
    const meals = Array.from({ length: MEAL_REPEAT_LIMIT + 5 }, (_, i) => meal({ tags: [`tag-${i}`] }));
    expect(repeatShortcuts(meals)).toHaveLength(MEAL_REPEAT_LIMIT);
  });
});

const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);

describe('defaultTagMix', () => {
  it('is empty for no tags', () => {
    expect(defaultTagMix([])).toEqual({});
  });

  it('splits protein-only across protein and fat 80/20', () => {
    expect(defaultTagMix(['protein'])).toEqual({ protein: 80, fat: 20 });
  });

  it('splits protein + carbs 60/40', () => {
    expect(defaultTagMix(['protein', 'carbs'])).toEqual({ protein: 60, carbs: 40 });
  });

  it('splits protein + carbs + veg 40/40/20', () => {
    expect(defaultTagMix(['protein', 'carbs', 'veg'])).toEqual({ protein: 40, carbs: 40, veg: 20 });
  });

  it('gives coffee/sweet a flat 5 each and splits the rest by ratio', () => {
    const mix = defaultTagMix(['protein', 'carbs', 'coffee']);
    expect(mix.coffee).toBe(5);
    // 95 split 60/40 -> 57 / 38
    expect(mix.protein).toBe(57);
    expect(mix.carbs).toBe(38);
    expect(sum(mix)).toBe(100);
  });

  it('splits an unlisted combo (incl. custom tags) evenly', () => {
    expect(defaultTagMix(['protein', 'fat'])).toEqual({ protein: 50, fat: 50 });
    const custom = defaultTagMix(['ramen', 'protein']);
    expect(sum(custom)).toBe(100);
    expect(custom.ramen).toBe(50);
  });

  it('splits a coffee-only meal to 100', () => {
    expect(defaultTagMix(['coffee'])).toEqual({ coffee: 100 });
  });

  it('always sums to 100 for a range of combos', () => {
    for (const combo of [
      ['protein'],
      ['carbs'],
      ['protein', 'carbs'],
      ['protein', 'carbs', 'veg'],
      ['protein', 'carbs', 'veg', 'sweet'],
      ['sweet', 'coffee'],
      ['protein', 'coffee', 'sweet'],
      ['a', 'b', 'c'],
    ]) {
      expect(sum(defaultTagMix(combo)), combo.join('+')).toBe(100);
    }
  });
});

describe('setMixValue (n-1 auto-balance)', () => {
  it('drags one tag and the last tag absorbs the difference', () => {
    const mix = { protein: 60, carbs: 40 };
    const next = setMixValue(mix, 'protein', 70);
    expect(next).toEqual({ protein: 70, carbs: 30 });
    expect(sum(next)).toBe(100);
  });

  it('clamps so the balancer never goes negative', () => {
    const mix = { protein: 40, carbs: 40, veg: 20 };
    // protein pushed past what leaves veg (the balancer) >= 0: carbs stays 40,
    // so protein maxes at 60 and veg lands at 0.
    const next = setMixValue(mix, 'protein', 95);
    expect(next.protein).toBe(60);
    expect(next.veg).toBe(0);
    expect(sum(next)).toBe(100);
  });

  it('ignores a drag on the balancer (last) tag', () => {
    const mix = { protein: 60, carbs: 40 };
    expect(setMixValue(mix, 'carbs', 10)).toEqual(mix);
  });

  it('is a no-op for a single-tag mix', () => {
    expect(setMixValue({ coffee: 100 }, 'coffee', 40)).toEqual({ coffee: 100 });
  });
});

describe('mixKeysOrdered', () => {
  it('orders known tags by MEAL_TAGS then custom alphabetically, balancer last', () => {
    expect(mixKeysOrdered({ carbs: 40, protein: 60 })).toEqual(['protein', 'carbs']);
    expect(mixKeysOrdered({ zeta: 10, protein: 90 })).toEqual(['protein', 'zeta']);
  });
});

describe('mix persistence', () => {
  it('recomputeMix seeds from the current selection', () => {
    const draft = recomputeMix({ ...draftFor({ kind: 'meal' }), tags: ['protein', 'carbs'] });
    expect(draft.tagMix).toEqual({ protein: 60, carbs: 40 });
  });

  it('toInput writes the mix, or null when empty', () => {
    const base = draftFor({ kind: 'meal' });
    expect(toInput({ ...base, tagMix: {} }, null).tag_mix).toBeNull();
    expect(toInput({ ...base, tagMix: { protein: 60, carbs: 40 } }, null).tag_mix).toEqual({
      protein: 60,
      carbs: 40,
    });
  });

  it('toDraft restores a saved mix and falls back to the default when absent', () => {
    expect(toDraft(meal({ tags: ['protein', 'carbs'], tag_mix: { protein: 70, carbs: 30 } })).tagMix).toEqual({
      protein: 70,
      carbs: 30,
    });
    // Older meal: tags but no saved mix -> seeded default.
    expect(toDraft(meal({ tags: ['protein', 'carbs'], tag_mix: null })).tagMix).toEqual({
      protein: 60,
      carbs: 40,
    });
  });
});
