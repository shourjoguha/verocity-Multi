import { describe, expect, it } from 'vitest';
import {
  blockForWeek,
  currentProgramWeek,
  dayCycleStatus,
  nextWeekForDay,
  planWeekByLog,
  planWeekCount,
} from '@/lib/progression';
import type { LogStatus, ParsedPlan, WorkoutLog } from '@/lib/types';

const PLAN_ID = 'p1';

function parsed(): ParsedPlan {
  return {
    title: 'Test plan',
    startDate: null,
    endDate: null,
    blocks: [{ type: 'accumulation', startWeek: 1, endWeek: 4 }],
    weeklyTemplate: ['lower-jump', 'upper'],
    days: [
      {
        dayKey: 'lower-jump',
        label: 'Lower — Jump',
        exercises: [
          {
            movement: 'squat',
            section: 'primary',
            primaryMetric: 'weight',
            plannedByWeek: { 1: '3x5', 2: '3x4', 3: '3x3', 4: '3x2' },
          },
        ],
      },
      { dayKey: 'upper', label: 'Upper', exercises: [] },
    ],
  };
}

let seq = 0;
function log(dayKey: string, logDate: string, status: LogStatus = 'done'): WorkoutLog {
  seq += 1;
  return {
    id: `l${seq}`,
    owner_user_id: 'u1',
    plan_id: PLAN_ID,
    session_id: null,
    log_date: logDate,
    day_key: dayKey,
    week_number: 99, // deliberately stale — must never drive the result
    status,
    started_at: null,
    ended_at: null,
    total_seconds: null,
    hr_avg: null,
    hr_max: null,
    notes: null,
    activity_type: null,
    tags: [],
    data: { sections: [] },
    source: 'manual',
    garmin_activity_id: null,
    created_at: `${logDate}T00:00:0${seq % 10}Z`,
  };
}

describe('planWeekCount', () => {
  it('is the max across block ranges and planned-by-week keys', () => {
    expect(planWeekCount(parsed())).toBe(4);
  });
});

describe('nextWeekForDay', () => {
  it('first log of a day is week 1', () => {
    expect(nextWeekForDay([], PLAN_ID, 'lower-jump', 4)).toBe(1);
  });

  it('a day already logged in the cycle opens the next one; an unlogged day is still in it', () => {
    const logs = [log('lower-jump', '2026-05-01')];
    expect(nextWeekForDay(logs, PLAN_ID, 'lower-jump', 4)).toBe(2);
    expect(nextWeekForDay(logs, PLAN_ID, 'upper', 4)).toBe(1);
  });

  it('a skipped day does not lag: it joins the cycle every other day is in', () => {
    // lower twice with no upper between → cycle 1 closed without upper.
    const logs = [log('lower-jump', '2026-05-01'), log('lower-jump', '2026-05-08')];
    expect(nextWeekForDay(logs, PLAN_ID, 'upper', 4)).toBe(2);
  });

  it('cancelled logs do not advance the week', () => {
    const logs = [log('lower-jump', '2026-05-01', 'cancelled')];
    expect(nextWeekForDay(logs, PLAN_ID, 'lower-jump', 4)).toBe(1);
  });

  it('clamps to the plan week count', () => {
    const logs = Array.from({ length: 6 }, (_, i) => log('lower-jump', `2026-05-0${i + 1}`));
    expect(nextWeekForDay(logs, PLAN_ID, 'lower-jump', 4)).toBe(4);
  });
});

describe('planWeekByLog', () => {
  it('assigns each log its cycle week from logging order, ignoring stored week_number', () => {
    const a = log('lower-jump', '2026-05-01');
    const b = log('lower-jump', '2026-05-08');
    const c = log('upper', '2026-05-02');
    const map = planWeekByLog(PLAN_ID, [b, a, c], 4);
    expect(map.get(a.id)).toBe(1); // earlier date → week 1 despite input order
    expect(map.get(b.id)).toBe(2);
    expect(map.get(c.id)).toBe(1);
  });

  it('stamps a day logged after a skipped cycle with the shared cycle, not its own count', () => {
    // THE DRIFT. Per-day counters stamped upper's 2nd log week 2 while lower
    // was on week 3, so the days hit their deload weeks at different times.
    const l1 = log('lower-jump', '2026-05-01');
    const u1 = log('upper', '2026-05-02');
    const l2 = log('lower-jump', '2026-05-08'); // cycle 2, upper skipped
    const l3 = log('lower-jump', '2026-05-15');
    const u2 = log('upper', '2026-05-16');
    const map = planWeekByLog(PLAN_ID, [l1, u1, l2, l3, u2], 4);
    expect([l1, u1, l2, l3, u2].map((l) => map.get(l.id))).toEqual([1, 1, 2, 3, 3]);
  });
});

describe('byLoggedOrder', () => {
  it('orders same-day sessions by start time, not by when the row was entered', () => {
    // Evening session backdated after this morning's was already logged.
    const morning = { ...log('lower-jump', '2026-05-01'), started_at: '2026-05-01T07:00:00Z', created_at: '2026-05-01T07:00:00Z' };
    const evening = { ...log('upper', '2026-05-01'), started_at: '2026-05-01T18:00:00Z', created_at: '2026-05-02T09:00:00Z' };
    const backdated = { ...log('upper', '2026-05-01'), started_at: '2026-05-01T06:00:00Z', created_at: '2026-05-02T09:30:00Z' };
    const map = planWeekByLog(PLAN_ID, [morning, evening, backdated], 4);
    // backdated upper (06:00) → morning lower (07:00) → evening upper repeats → cycle 2
    expect(map.get(backdated.id)).toBe(1);
    expect(map.get(morning.id)).toBe(1);
    expect(map.get(evening.id)).toBe(2);
  });
});

describe('dayCycleStatus', () => {
  it('counts closed cycles a day was missing from, and finishes past the last cycle', () => {
    const logs = [
      log('lower-jump', '2026-05-01'),
      log('upper', '2026-05-02'),
      log('lower-jump', '2026-05-08'),
      log('lower-jump', '2026-05-15'),
    ];
    expect(dayCycleStatus(logs, PLAN_ID, 'upper', 4)).toEqual({ next: 3, missed: 1 });
    expect(dayCycleStatus(logs, PLAN_ID, 'lower-jump', 4)).toEqual({ next: 4, missed: 0 });
    const more = [...logs, log('lower-jump', '2026-05-22')];
    expect(dayCycleStatus(more, PLAN_ID, 'lower-jump', 4).next).toBe(5);
  });
});

describe('currentProgramWeek', () => {
  it('is 1 for a plan with no logs', () => {
    expect(currentProgramWeek(PLAN_ID, [], 4)).toBe(1);
  });

  it('is the cycle in progress across days', () => {
    const logs = [
      log('lower-jump', '2026-05-01'),
      log('lower-jump', '2026-05-08'),
      log('upper', '2026-05-02'),
    ];
    expect(currentProgramWeek(PLAN_ID, logs, 4)).toBe(2);
  });
});

describe('blockForWeek', () => {
  const blocks = [
    { type: 'accumulation' as const, startWeek: 1, endWeek: 4 },
    { type: 'deload' as const, startWeek: 5, endWeek: 5 },
    { type: 'intensification' as const, startWeek: 6, endWeek: 8 },
  ];

  it('reads the block spanning a week', () => {
    expect(blockForWeek(blocks, 4)).toBe('accumulation');
    expect(blockForWeek(blocks, 5)).toBe('deload');
    expect(blockForWeek(blocks, 6)).toBe('intensification');
  });

  it('is null outside every block', () => {
    expect(blockForWeek(blocks, 9)).toBeNull();
    expect(blockForWeek([], 1)).toBeNull();
  });
});
