import { describe, expect, it } from 'vitest';
import { getMealLogs } from '@/lib/queries';

// Regression guard for two read-boundary bugs in getMealLogs/normalizeMealLog.
//
// 1. Postgres `time` serialises as 'HH:MM:SS'. <input type="time"> only
//    accepts 'HH:MM' and silently renders BLANK for anything longer, so
//    normalizeMealLog trims it before any component sees it.
// 2. size/kind/source are unconstrained `text` columns (no check constraint —
//    see 0032_meal_logs.sql), so a stored value is not guaranteed to be a key
//    app.config.ts knows. Unknown values fall back to MEAL_DEFAULTS rather
//    than reaching the UI, which always assumes a selection.

/** Minimal PostgREST stand-in: `.from().select().order().order().limit()` → `{ data }`. */
function clientReturning(data: unknown) {
  return {
    from: () => ({
      select: () => ({
        order: () => ({
          order: () => ({
            limit: async () => ({ data }),
          }),
        }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const BASE = {
  id: 'm1',
  owner_user_id: 'u1',
  log_date: '2026-08-10',
  note: null,
  hunger_before: 4,
  hunger_after: 1,
  photo_path: null,
  created_at: '',
  updated_at: '',
};

describe('getMealLogs normalisation', () => {
  it('trims the Postgres time serialisation to HH:MM', async () => {
    const rows = await getMealLogs(
      100,
      clientReturning([{ ...BASE, eaten_time: '10:30:00', size: 'medium', kind: 'meal', source: 'home', tags: [] }]),
    );
    expect(rows[0].eaten_time).toBe('10:30');
  });

  it('coerces null tags to an empty array', async () => {
    const rows = await getMealLogs(
      100,
      clientReturning([{ ...BASE, eaten_time: '08:00:00', size: 'medium', kind: 'meal', source: 'home', tags: null }]),
    );
    expect(rows[0].tags).toEqual([]);
  });

  it('falls back an unrecognised size to the default', async () => {
    const rows = await getMealLogs(
      100,
      clientReturning([
        { ...BASE, eaten_time: '08:00:00', size: 'enormous', kind: 'meal', source: 'home', tags: [] },
      ]),
    );
    expect(rows[0].size).toBe('medium');
  });

  it('does not let a prototype-chain key like "toString" pass as a size', async () => {
    const rows = await getMealLogs(
      100,
      clientReturning([
        { ...BASE, eaten_time: '08:00:00', size: 'toString', kind: 'meal', source: 'home', tags: [] },
      ]),
    );
    expect(rows[0].size).toBe('medium');
  });

  it('returns [] rather than throwing on an empty result', async () => {
    expect(await getMealLogs(100, clientReturning([]))).toEqual([]);
  });

  it('returns [] rather than throwing on a null result', async () => {
    expect(await getMealLogs(100, clientReturning(null))).toEqual([]);
  });
});
