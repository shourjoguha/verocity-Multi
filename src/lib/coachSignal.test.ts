import { afterEach, describe, expect, it, vi } from 'vitest';
import { COACH_SEEN_STORAGE_KEY, coachSignal, getCoachSeenAt } from '@/lib/coachSignal';
import type { Recommendation } from '@/lib/types';

const NOW = Date.parse('2026-10-03T12:00:00Z');
const DAY = 86_400_000;

function rec(over: Partial<Recommendation>): Recommendation {
  return {
    id: Math.random().toString(36),
    owner_user_id: 'u',
    status: 'open',
    drift_score: null,
    confidence: null,
    tldr: null,
    action: null,
    body_md: null,
    disposition: null,
    disposition_note: null,
    linked_log_id: null,
    snooze_until: null,
    created_at: new Date(NOW - DAY).toISOString(),
    rule_id: null,
    period_key: null,
    pack_version: null,
    evidence: null,
    ...over,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('coachSignal', () => {
  it('counts open and lapsed-snooze rows as live, and nothing decided or still snoozed', () => {
    const recs = [
      rec({}),
      rec({ status: 'snoozed', snooze_until: new Date(NOW - 1000).toISOString() }),
      rec({ status: 'snoozed', snooze_until: new Date(NOW + DAY).toISOString() }),
      rec({ status: 'acted' }),
      rec({ status: 'dismissed' }),
    ];
    expect(coachSignal(recs, null, NOW).live).toBe(2);
  });

  it('only counts live rows created after the last visit as unseen', () => {
    const seenAt = NOW - 2 * DAY;
    const recs = [
      rec({ created_at: new Date(NOW - 3 * DAY).toISOString() }),
      rec({ created_at: new Date(NOW - DAY).toISOString() }),
      rec({ created_at: new Date(NOW - DAY).toISOString(), status: 'dismissed' }),
    ];
    expect(coachSignal(recs, seenAt, NOW)).toEqual({ live: 2, unseen: 1 });
  });

  // Opening Coach is what stops the loop; the badge stays while the finding is true.
  it('goes quiet on motion but keeps the count once seen', () => {
    const recs = [rec({}), rec({})];
    expect(coachSignal(recs, NOW, NOW)).toEqual({ live: 2, unseen: 0 });
  });

  it('treats a device that never opened Coach as having seen nothing', () => {
    expect(coachSignal([rec({})], null, NOW).unseen).toBe(1);
  });
});

describe('getCoachSeenAt', () => {
  it('reads a stored timestamp and rejects junk', () => {
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => (k === COACH_SEEN_STORAGE_KEY ? String(NOW) : null) } });
    expect(getCoachSeenAt()).toBe(NOW);
    vi.stubGlobal('window', { localStorage: { getItem: () => 'nope' } });
    expect(getCoachSeenAt()).toBeNull();
    vi.stubGlobal('window', { localStorage: { getItem: () => null } });
    expect(getCoachSeenAt()).toBeNull();
  });

  it('returns null rather than throwing when storage is blocked', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('SecurityError');
        },
      },
    });
    expect(getCoachSeenAt()).toBeNull();
  });
});
