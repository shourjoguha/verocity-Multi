import { describe, expect, it } from 'vitest';
import { MEAL_REPEAT_LIMIT, MEAL_REPEAT_SEED } from '@/app.config';
import { draftFor, normalizeTag, repeatShortcuts, splitTags, toInput } from '@/lib/mealDraft';
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
