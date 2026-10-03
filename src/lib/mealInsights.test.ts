import { describe, expect, it } from 'vitest';
import {
  buildDayInsights,
  fuelByHour,
  layoutFuelBars,
  macroMix,
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

describe('macroMix', () => {
  it('is null with no macros, and 100 for a lone macro', () => {
    expect(macroMix(['coffee'], null)).toBeNull();
    expect(macroMix(['protein', 'sweet'], null)).toEqual({ protein: 100 });
  });

  it('is null — not an even guess — when 2+ macros have no split', () => {
    expect(macroMix(['protein', 'carbs'], null)).toBeNull();
  });

  it('drops non-macro keys and renormalises to exactly 100', () => {
    expect(macroMix(['protein', 'carbs', 'fat'], { protein: 33, carbs: 33, fat: 33, coffee: 1 })).toEqual({
      protein: 34,
      carbs: 33,
      fat: 33,
    });
  });
});

describe('layoutFuelBars', () => {
  const at = (h: number, m = 0) => h * 60 + m;

  it('places well-spaced meals at their real time', () => {
    expect(layoutFuelBars([at(12), at(18)], at(6), at(24), 4)).toEqual([(6 / 18) * 100, (12 / 18) * 100]);
  });

  it('nudges close meals apart, side by side, centred on where they were', () => {
    const [a, b] = layoutFuelBars([at(12, 0), at(12, 10)], at(6), at(24), 4);
    expect(b - a).toBeCloseTo(4);
    expect((a + b) / 2).toBeCloseTo(((at(12, 5) - at(6)) / at(18)) * 100);
  });

  it('keeps input order and clamps a cluster inside the track', () => {
    const xs = layoutFuelBars([at(23, 55), at(23, 50), at(23, 59)], at(6), at(24), 4);
    expect(Math.max(...xs)).toBeLessThanOrEqual(100);
    expect(xs[1]).toBeLessThan(xs[0]);
    expect(xs[0]).toBeLessThan(xs[2]);
  });

  it('merges a nudged cluster into a neighbour it now overlaps', () => {
    const xs = layoutFuelBars([at(12), at(12, 5), at(12, 50)], at(6), at(24), 4).sort((a, b) => a - b);
    expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(4 - 1e-9);
    expect(xs[2] - xs[1]).toBeGreaterThanOrEqual(4 - 1e-9);
  });
});
