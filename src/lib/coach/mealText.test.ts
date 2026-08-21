import { describe, expect, it } from 'vitest';
import { readMealText, summarizeMealText } from '@/lib/coach/mealText';

// Notes modelled on the vocabulary that actually appears in a real log —
// including its typos. The fixtures themselves are scrubbed of free text (see
// __fixtures__/README.md), so the text reader is exercised on literals instead,
// which is also the only way to assert on a specific phrase.
describe('readMealText', () => {
  it('names the carbohydrate, not just that there was one', () => {
    expect(readMealText('Fish and rice').carbs).toEqual(['rice']);
    expect(readMealText('Eggs and toast').carbs).toEqual(['bread']);
    expect(readMealText('Shrimp pasta').carbs).toEqual(['pasta']);
    expect(readMealText('Chicken, buckwheat, broccoli').carbs).toEqual(['grain']);
  });

  it('reads more than one source from one meal', () => {
    const r = readMealText('Tuna sandwich with rice on the side');
    expect(r.carbs).toContain('bread');
    expect(r.carbs).toContain('rice');
  });

  it('survives the typos real notes contain', () => {
    expect(readMealText('Cerial').carbs).toEqual(['cereal']);
  });

  it('does not find a vegetable inside a nut', () => {
    // 'peas' matches inside 'peanuts' without a word boundary, and a bag of
    // nuts silently becomes a vegetable. This exact string is from a real log.
    expect(readMealText('Cashes, almond and pea nuts').veg).toBe(false);
    expect(readMealText('Chicken, buckwheat, broccoli').veg).toBe(true);
  });

  it('surfaces preparation only where the athlete volunteered it', () => {
    expect(readMealText('Fish and chips, all fried').preparation).toContain('fried');
    expect(readMealText('Fish and rice').preparation).toHaveLength(0);
  });

  it('distinguishes a blank note from a note that named nothing', () => {
    expect(readMealText(null).hasText).toBe(false);
    expect(readMealText('   ').hasText).toBe(false);
    // Said something, named no carb — NOT the same as "ate no carbs".
    const r = readMealText('Leftovers');
    expect(r.hasText).toBe(true);
    expect(r.carbs).toHaveLength(0);
  });
});

describe('summarizeMealText', () => {
  const meal = (note: string | null, tags: string[] = []) => ({ note, tags });

  it('counts sources and treats the veg TAG as authoritative', () => {
    const s = summarizeMealText([
      meal('Fish and rice'),
      meal('Cod and rice'),
      meal(null, ['veg']), // tagged, no note — must still count as a vegetable
      meal('Eggs and toast'),
    ]);
    expect(s.total).toBe(4);
    expect(s.described).toBe(3);
    expect(s.carbCounts[0]).toMatchObject({ key: 'rice', count: 2 });
    expect(s.vegMeals).toBe(1);
  });

  it('does not double-count a meal both tagged and described as veg', () => {
    const s = summarizeMealText([meal('Chicken and broccoli', ['veg'])]);
    expect(s.vegMeals).toBe(1);
  });
});
