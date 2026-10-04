import { describe, expect, it } from 'vitest';
import { toWeeks, windowPoints } from '@/lib/activityWindow';
import type { TimelinePoint } from '@/lib/timeline';

function day(date: string, sessions: { colors: string[]; seconds: number }[] = [], isToday = false): TimelinePoint {
  return {
    date,
    state: sessions.length ? 'done' : 'blank',
    sessions: sessions.map((s) => s.colors),
    sessionSeconds: sessions.map((s) => s.seconds),
    seconds: sessions.reduce((a, s) => a + s.seconds, 0),
    color: sessions[0]?.colors[0] ?? 'transparent',
    isToday,
    fullLabel: sessions.length ? 'Done' : 'Rest',
  };
}

// 2026-09-01 … 2026-09-20, today last.
const run = Array.from({ length: 20 }, (_, i) => day(`2026-09-${String(i + 1).padStart(2, '0')}`, [], i === 19));

describe('windowPoints', () => {
  it('keeps the last N days, ending on today', () => {
    const w = windowPoints(run, 14);
    expect(w).toHaveLength(14);
    expect(w[0].date).toBe('2026-09-07');
    expect(w[13].isToday).toBe(true);
  });

  it('pads the front with rest days when the history is shorter than the window', () => {
    const w = windowPoints(run, 28);
    expect(w).toHaveLength(28);
    expect(w[0].date).toBe('2026-08-24');
    expect(w.slice(0, 8).every((p) => p.state === 'blank' && !p.isToday)).toBe(true);
    expect(w[8].date).toBe('2026-09-01');
  });

  it('returns everything for the all-time window', () => {
    expect(windowPoints(run, null)).toBe(run);
  });
});

describe('toWeeks', () => {
  it('buckets seven days back from today, so the last bucket ends on today', () => {
    const weeks = toWeeks(run);
    expect(weeks.map((w) => [w.start, w.end])).toEqual([
      ['2026-09-01', '2026-09-06'],
      ['2026-09-07', '2026-09-13'],
      ['2026-09-14', '2026-09-20'],
    ]);
    expect(weeks.map((w) => w.isCurrent)).toEqual([false, false, true]);
  });

  it('sums time and sessions, and colours a week by its dominant tag by time', () => {
    const pts = [
      day('2026-09-14', [{ colors: ['red'], seconds: 1800 }]),
      day('2026-09-15', [
        { colors: ['blue'], seconds: 3600 },
        { colors: ['red'], seconds: 600 },
      ]),
      ...Array.from({ length: 5 }, (_, i) => day(`2026-09-${16 + i}`)),
    ];
    const [w] = toWeeks(pts);
    expect(w.sessions).toBe(3);
    expect(w.seconds).toBe(6000);
    expect(w.color).toBe('blue');
  });

  it('leaves an empty week without a colour', () => {
    expect(toWeeks(run.slice(-7))[0].color).toBeNull();
  });
});
