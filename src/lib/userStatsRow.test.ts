import { describe, expect, it } from 'vitest';
import { getUserStats } from '@/lib/queries';
import { isExperienceKey } from '@/app.config';

// Regression guard for a blank /app/you.
//
// The database does not enforce what `UserStats` claims: `experience` is an
// unconstrained `text` column (migration 0031 says so deliberately) and a row
// predating a jsonb column can surface null where the type promises an array.
// The UI indexes `EXPERIENCE_LEVELS[row.experience]` and reads `.blurb` /
// `.label` off it, and calls `.length` on the arrays — so an unrecognised
// string was `undefined.blurb` and a null array was `null.length`, either of
// which threw during render and took the whole island down. The page went
// blank, which also meant the user could not correct the data that broke it.
//
// getUserStats normalises at the boundary. These assert it, against exactly the
// shapes that crashed rather than against a tidy row.

/** Minimal PostgREST stand-in: `.from().select().maybeSingle()` → `{ data }`. */
function clientReturning(data: unknown) {
  return {
    from: () => ({
      select: () => ({
        maybeSingle: async () => ({ data }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const BASE = {
  owner_user_id: 'u1',
  body_weight_kg: 86,
  height_cm: 185,
  birth_year: 1991,
  gender: 'male',
  body_type: null,
  preferred_plan_weeks: 8,
  days_per_week: 4,
  onboarded_at: null,
  updated_at: '',
  created_at: '',
};

describe('isExperienceKey', () => {
  it('accepts the configured keys and rejects anything else', () => {
    expect(isExperienceKey('intermediate')).toBe(true);
    expect(isExperienceKey('elite')).toBe(false);
    expect(isExperienceKey(null)).toBe(false);
    expect(isExperienceKey('')).toBe(false);
    // Not a key just because Object has it.
    expect(isExperienceKey('toString')).toBe(false);
  });
});

describe('getUserStats normalisation', () => {
  it('drops an experience value the config does not know', async () => {
    const row = await getUserStats(
      clientReturning({ ...BASE, experience: 'elite', equipment: [], disciplines: [], goals: [], injuries: [] }),
    );
    expect(row?.experience).toBeNull();
  });

  it('keeps a valid experience value', async () => {
    const row = await getUserStats(
      clientReturning({ ...BASE, experience: 'advanced', equipment: [], disciplines: [], goals: [], injuries: [] }),
    );
    expect(row?.experience).toBe('advanced');
  });

  it('coerces null jsonb columns to empty arrays', async () => {
    const row = await getUserStats(
      clientReturning({
        ...BASE,
        experience: 'intermediate',
        equipment: null,
        disciplines: null,
        goals: null,
        injuries: null,
      }),
    );
    // `.length` on any of these is what blanked the page.
    expect(row?.equipment).toEqual([]);
    expect(row?.disciplines).toEqual([]);
    expect(row?.goals).toEqual([]);
    expect(row?.injuries).toEqual([]);
  });

  it('coerces a non-array jsonb value rather than passing it through', async () => {
    const row = await getUserStats(
      clientReturning({ ...BASE, experience: null, equipment: {}, disciplines: 'barbell', goals: 0, injuries: [] }),
    );
    expect(row?.equipment).toEqual([]);
    expect(row?.disciplines).toEqual([]);
    expect(row?.goals).toEqual([]);
  });

  it('preserves populated arrays and the scalar fields', async () => {
    const row = await getUserStats(
      clientReturning({
        ...BASE,
        experience: 'intermediate',
        equipment: ['barbell', 'rack'],
        disciplines: ['hyrox'],
        goals: [{ key: 'strength', label: 'Strength', weight: 3 }],
        injuries: [],
      }),
    );
    expect(row?.equipment).toEqual(['barbell', 'rack']);
    expect(row?.disciplines).toEqual(['hyrox']);
    expect(row?.goals).toHaveLength(1);
    expect(row?.body_weight_kg).toBe(86);
  });

  it('returns null when there is no row, rather than a normalised empty one', async () => {
    expect(await getUserStats(clientReturning(null))).toBeNull();
  });
});
