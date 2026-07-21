import { describe, expect, it } from 'vitest';
import {
  currentProgramWeek,
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

  it("second log of the SAME day is week 2, independent of other days", () => {
    const logs = [log('lower-jump', '2026-05-01'), log('upper', '2026-05-02')];
    expect(nextWeekForDay(logs, PLAN_ID, 'lower-jump', 4)).toBe(2);
    // the once-logged 'upper' day is still on its second session → week 2
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
});

describe('currentProgramWeek', () => {
  it('is 1 for a plan with no logs', () => {
    expect(currentProgramWeek(PLAN_ID, [], 4)).toBe(1);
  });

  it('is the furthest cycle reached across days', () => {
    const logs = [
      log('lower-jump', '2026-05-01'),
      log('lower-jump', '2026-05-08'),
      log('upper', '2026-05-02'),
    ];
    expect(currentProgramWeek(PLAN_ID, logs, 4)).toBe(2);
  });
});
