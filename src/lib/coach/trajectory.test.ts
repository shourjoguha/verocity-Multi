import { describe, expect, it } from 'vitest';
import { checkinDelta, mergeSeries, readingsByRule, trajectoryLabel } from '@/lib/coach/trajectory';
import { recurrence, type Reading } from '@/lib/coach/recurrence';
import type { CoachObservation } from '@/lib/types';

const series = (...drifts: number[]): Reading[] =>
  drifts.map((drift, i) => ({
    observedOn: `2026-09-${String(i + 1).padStart(2, '0')}`,
    drift,
    fired: drift > 0.1,
  }));

function obs(rule: string, day: string, drift: number, fired = drift > 0.1): CoachObservation {
  return {
    id: `${rule}-${day}`, owner_user_id: 'u', rule_id: rule, observed_on: day, drift,
    confidence: 0.8, sufficiency: 'ok', fired, sessions: 8, observed: null, created_at: day,
  };
}

describe('trajectoryLabel', () => {
  it('reads one live reading as new, and one clean reading as nothing', () => {
    expect(trajectoryLabel(series(0.6))).toBe('new');
    expect(trajectoryLabel(series(0.05))).toBeNull();
    expect(trajectoryLabel([])).toBeNull();
  });

  it('calls a series that ends at or under the floor resolving', () => {
    expect(trajectoryLabel(series(0.7, 0.4, 0.1))).toBe('resolving');
  });

  it('measures a relapse from the best BEFORE the latest reading', () => {
    // Best 0.2, now 0.62: a climb of 0.42 off the athlete's own best.
    expect(trajectoryLabel(series(0.7, 0.55, 0.2, 0.35, 0.62))).toBe('came-back');
  });

  it('catches a climb of exactly the material amount (the one-ulp trap)', () => {
    expect(trajectoryLabel(series(0.5, 0.2, 0.35))).toBe('came-back');
  });

  it('separates a falling series from a flat one by recurrence’s own slope', () => {
    expect(trajectoryLabel(series(0.9, 0.8, 0.7, 0.6, 0.5))).toBe('improving');
    expect(trajectoryLabel(series(0.48, 0.5, 0.47, 0.5, 0.49))).toBe('persisting');
  });

  it('agrees with recurrence() on the same numbers', () => {
    // A rule acted on at 0.8, readings since falling to 0.2 then back to 0.45.
    const since = series(0.6, 0.4, 0.2);
    const r = recurrence({
      status: 'acted', drift: 0.45, fired: true, newSessions: 6, since,
      decidedOn: '2026-08-20', driftAtDecision: 0.8, today: new Date('2026-09-04T12:00:00Z'),
    });
    expect(r.reason).toBe('regressing');
    expect(trajectoryLabel([...since, { observedOn: '2026-09-04', drift: 0.45, fired: true }])).toBe(
      'came-back',
    );
  });
});

describe('mergeSeries', () => {
  it('keeps the worst member per day and fires if any member fired', () => {
    const a = series(0.2, 0.6);
    const b = series(0.5, 0.05);
    expect(mergeSeries([a, b]).map((r) => [r.drift, r.fired])).toEqual([
      [0.5, true],
      [0.6, true],
    ]);
  });
});

describe('readingsByRule', () => {
  it('groups by rule, oldest first', () => {
    const m = readingsByRule([obs('a', '2026-09-08', 0.3), obs('a', '2026-09-01', 0.5), obs('b', '2026-09-01', 0.2)]);
    expect(m.get('a')!.map((r) => r.observedOn)).toEqual(['2026-09-01', '2026-09-08']);
    expect(m.get('b')!.length).toBe(1);
  });
});

describe('checkinDelta', () => {
  it('is null until there are two check-in days', () => {
    expect(checkinDelta([obs('a', '2026-09-01', 0.5)])).toBeNull();
  });

  it('counts new, still and cleared from `fired` on the last two days', () => {
    const d = checkinDelta([
      obs('a', '2026-09-01', 0.5), obs('b', '2026-09-01', 0.5), obs('c', '2026-08-25', 0.5),
      obs('a', '2026-09-08', 0.6), obs('b', '2026-09-08', 0.05), obs('d', '2026-09-08', 0.4),
    ]);
    expect(d).toEqual({ on: '2026-09-08', fresh: 1, still: 1, cleared: 1 });
  });
});
