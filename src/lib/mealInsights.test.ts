import { describe, expect, it } from 'vitest';
import {
  buildDayInsights,
  fuelByHour,
  macroTags,
  mealsInHour,
  summarizeTiming,
  tagShare,
} from '@/lib/mealInsights';
import type { MealLog } from '@/lib/types';

function meal(overrides: Partial<MealLog>): MealLog {
  return {
    id: Math.random().toString(36).slice(2),
    owner_user_id: 'u',
    log_date: '2026-08-12',
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

describe('fuelByHour', () => {
  it('places intensity at the hour the meal was eaten', () => {
    const fuel = fuelByHour([meal({ eaten_time: '08:30', size: 'heavy' })]);
    // DAY_HOURS starts at 06:00, so 08:00 is index 2.
    expect(fuel[2]).toBe(1);
    expect(fuel[0]).toBe(0);
  });

  it('caps a busy hour at 1', () => {
    const fuel = fuelByHour([
      meal({ eaten_time: '12:00', size: 'heavy' }),
      meal({ eaten_time: '12:40', size: 'heavy' }),
    ]);
    expect(fuel[6]).toBe(1);
  });
});

describe('mealsInHour', () => {
  it('returns only meals whose hour matches', () => {
    const a = meal({ eaten_time: '14:10' });
    const b = meal({ eaten_time: '15:55' });
    expect(mealsInHour([a, b], 14)).toEqual([a]);
  });
});

describe('macroTags', () => {
  it('returns present macros in canonical P→C→F order', () => {
    expect(macroTags(meal({ tags: ['fat', 'protein', 'veg'] }))).toEqual(['protein', 'fat']);
  });
});

describe('buildDayInsights', () => {
  it('orders a day chronologically and derives first/last', () => {
    const [day] = buildDayInsights(
      [
        meal({ log_date: '2026-08-12', eaten_time: '20:00' }),
        meal({ log_date: '2026-08-12', eaten_time: '08:00' }),
      ],
      7,
    );
    expect(day.firstMeal).toBe('08:00');
    expect(day.lastMeal).toBe('20:00');
    expect(day.meals).toHaveLength(2);
  });

  it('limits to the requested number of days, newest first', () => {
    const days = buildDayInsights(
      [
        meal({ log_date: '2026-08-12' }),
        meal({ log_date: '2026-08-11' }),
        meal({ log_date: '2026-08-10' }),
      ],
      2,
    );
    expect(days.map((d) => d.date)).toEqual(['2026-08-12', '2026-08-11']);
  });
});

describe('summarizeTiming', () => {
  it('counts late nights and averages the window', () => {
    const days = buildDayInsights(
      [
        meal({ log_date: '2026-08-12', eaten_time: '08:00' }),
        meal({ log_date: '2026-08-12', eaten_time: '22:00' }),
      ],
      7,
    );
    const summary = summarizeTiming(days);
    expect(summary.averageFirstMeal).toBe('08:00');
    expect(summary.averageLastMeal).toBe('22:00');
    expect(summary.lateNights).toBe(1);
    expect(summary.mealsPerDay).toBe('2.0');
  });

  it('degrades to dashes with no meals', () => {
    const summary = summarizeTiming([]);
    expect(summary.averageFirstMeal).toBe('—');
    expect(summary.lateNights).toBe(0);
  });
});

describe('tagShare', () => {
  it('computes count and share per tag', () => {
    const meals = [meal({ tags: ['protein'] }), meal({ tags: ['protein', 'carbs'] })];
    const rows = tagShare(meals, ['protein', 'carbs', 'fat']);
    expect(rows.find((r) => r.tag === 'protein')).toMatchObject({ count: 2, share: 1 });
    expect(rows.find((r) => r.tag === 'carbs')).toMatchObject({ count: 1, share: 0.5 });
    expect(rows.find((r) => r.tag === 'fat')).toMatchObject({ count: 0, share: 0 });
  });
});
