import { describe, expect, it } from 'vitest';
import { FRIENDS } from '@/app.config';
import {
  confirmPatch,
  duplicateChoice,
  nextReviewHref,
  parseQueue,
  queueCandidates,
  reviewHref,
} from '@/lib/reviewFlow';
import { canLinkOnDate, planLinkFloor, planLinkFor, sanitiseSharedLog, unionLogs } from '@/lib/sharedLog';
import type { LogDocument, LogStatus, Plan, WorkoutLog } from '@/lib/types';

let seq = 0;
function wlog(over: Partial<WorkoutLog> & { log_date: string }): WorkoutLog {
  seq += 1;
  return {
    id: `l${seq}`,
    owner_user_id: 'me',
    plan_id: null,
    session_id: null,
    day_key: null,
    week_number: null,
    status: 'done',
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
    created_at: `${over.log_date}T00:00:0${seq % 10}Z`,
    ...over,
  };
}

describe('parseQueue', () => {
  it('keeps order, drops junk and repeats', () => {
    expect(parseQueue('a1, b2,,a1,<script>,c-3')).toEqual(['a1', 'b2', 'c-3']);
    expect(parseQueue(null)).toEqual([]);
    expect(parseQueue('')).toEqual([]);
  });

  it('caps at one batch — the URL is user-editable', () => {
    const raw = Array.from({ length: FRIENDS.batchMaxItems + 10 }, (_, i) => `id${i}`).join(',');
    expect(parseQueue(raw)).toHaveLength(FRIENDS.batchMaxItems);
  });
});

describe('reviewHref', () => {
  it('carries the queue only when it names more than this log', () => {
    expect(reviewHref('x')).toBe('/app/log?logId=x&edit=1');
    expect(reviewHref('x', ['x'])).toBe('/app/log?logId=x&edit=1');
    expect(reviewHref('x', ['x', 'y'])).toBe('/app/log?logId=x&edit=1&queue=x%2Cy');
    expect(reviewHref('m', [], { combine: 'r' })).toBe('/app/log?logId=m&edit=1&combine=r');
  });
});

describe('queue stepping', () => {
  it('tries the rest of the queue, then the ones before, never the current', () => {
    expect(queueCandidates(['a', 'b', 'c', 'd'], 'b')).toEqual(['c', 'd', 'a']);
    expect(queueCandidates(['a', 'b'], 'zz')).toEqual(['a', 'b']);
    expect(queueCandidates([], 'a')).toEqual([]);
  });

  const waiting = (entries: [string, LogStatus][]) => new Map(entries.map(([id, status]) => [id, { status }]));

  it('moves to the next row that is still needs_review', () => {
    const q = ['a', 'b', 'c'];
    const db = waiting([
      ['a', 'needs_review'],
      ['b', 'done'], // confirmed from the inbox meanwhile
      ['c', 'needs_review'],
    ]);
    expect(nextReviewHref(q, 'a', db)).toBe(reviewHref('c', q));
  });

  it('wraps to an earlier one the user skipped', () => {
    const q = ['a', 'b', 'c'];
    expect(nextReviewHref(q, 'c', waiting([['a', 'needs_review']]))).toBe(reviewHref('a', q));
  });

  it('returns to the inbox after the last, and when rows are gone', () => {
    const q = ['a', 'b'];
    expect(nextReviewHref(q, 'b', waiting([['a', 'done']]))).toBe('/app/inbox');
    expect(nextReviewHref(q, 'a', new Map())).toBe('/app/inbox');
    expect(nextReviewHref([], 'a', new Map())).toBe('/app/inbox');
  });
});

describe('confirmPatch', () => {
  it('confirms as done with the chosen link', () => {
    expect(confirmPatch({ plan_id: 'p', day_key: 'lower', week_number: 3 })).toEqual({
      status: 'done',
      plan_id: 'p',
      day_key: 'lower',
      week_number: 3,
    });
  });

  it('with no link, writes all three fields null — never a half link', () => {
    expect(confirmPatch(null)).toEqual({ status: 'done', plan_id: null, day_key: null, week_number: null });
  });
});

describe('duplicateChoice', () => {
  it('rounds the overlap and clamps it', () => {
    expect(duplicateChoice({ log: { garmin_activity_id: null, source: 'manual' }, overlap: 0.625 }).percent).toBe(63);
    expect(duplicateChoice({ log: { garmin_activity_id: null, source: 'manual' }, overlap: 1.4 }).percent).toBe(100);
  });

  it('disables Use shared when my original carries a Garmin activity', () => {
    expect(duplicateChoice({ log: { garmin_activity_id: null, source: 'manual' }, overlap: 0.5 }).canUseShared).toBe(true);
    expect(duplicateChoice({ log: { garmin_activity_id: 'g1', source: 'manual' }, overlap: 0.5 }).canUseShared).toBe(false);
    expect(duplicateChoice({ log: { garmin_activity_id: null, source: 'garmin' }, overlap: 0.5 }).canUseShared).toBe(false);
  });
});

describe('Counts toward — floor and manual pick (§5.6, §12.3)', () => {
  const plan = {
    id: 'plan',
    start_date: '2026-05-01',
    parsed: {
      title: 'Mine',
      startDate: '2026-05-01',
      endDate: null,
      blocks: [{ type: 'accumulation', startWeek: 1, endWeek: 6 }],
      weeklyTemplate: ['lower', 'upper'],
      days: [
        { dayKey: 'lower', label: 'Lower', exercises: [] },
        { dayKey: 'upper', label: 'Upper', exercises: [] },
      ],
    },
  } as unknown as Plan;
  const planLog = (day: string, date: string, status: LogStatus = 'done') =>
    wlog({ log_date: date, plan_id: 'plan', day_key: day, status });

  it('the floor is the first counted plan log, else the plan start', () => {
    expect(planLinkFloor(plan, [])).toBe('2026-05-01');
    expect(planLinkFloor(plan, [planLog('lower', '2026-05-02', 'needs_review'), planLog('upper', '2026-05-09')])).toBe(
      '2026-05-09',
    );
    expect(canLinkOnDate(plan, [planLog('upper', '2026-05-09')], '2026-05-08')).toBe(false);
    expect(canLinkOnDate(plan, [planLog('upper', '2026-05-09')], '2026-05-09')).toBe(true);
  });

  it('a manual pick stamps the week that day is next logged in', () => {
    const logs = [planLog('lower', '2026-05-04'), planLog('upper', '2026-05-06')];
    expect(planLinkFor(plan, 'lower', logs)).toEqual({ plan_id: 'plan', day_key: 'lower', week_number: 2 });
  });

  it('the log being linked must be left out, or its own link pushes it a week on', () => {
    const self = planLog('lower', '2026-05-04');
    expect(planLinkFor(plan, 'lower', [self]).week_number).toBe(2);
    expect(planLinkFor(plan, 'lower', []).week_number).toBe(1);
  });
});

describe('Combine path (§5.5)', () => {
  const set = { planned: '5', actual: { weight: 100, reps: 5, completed: true, prefilled: false, rpeRated: true }, notations: [] };
  const mine: LogDocument = {
    sections: [
      { key: 'primary', groups: [{ id: 'my-g', kind: 'single', items: [{ id: 'my-i', movement: 'Back Squat', primaryMetric: 'reps', sets: [set] }] }] },
    ],
  };
  // What the review row holds: the payload, sanitised at accept.
  let n = 0;
  const review = sanitiseSharedLog(
    {
      sections: [
        {
          key: 'primary',
          groups: [
            {
              id: 'their-g',
              kind: 'superset',
              items: [
                { id: 't1', movement: 'back squat', primaryMetric: 'reps', sets: [set] },
                { id: 't2', movement: 'Bench Press', primaryMetric: 'reps', sets: [set] },
              ],
            },
          ],
        },
      ],
    },
    () => `fresh-${++n}`,
  );

  it('keeps my log first and untouched, and marks only what came in', () => {
    const { doc, addedItemIds } = unionLogs(mine, review);
    expect(doc.sections[0].groups[0]).toEqual(mine.sections[0].groups[0]);
    expect(addedItemIds).toHaveLength(1);
    const added = doc.sections[0].groups[1];
    expect(added.kind).toBe('single');
    expect(added.items[0].movement).toBe('Bench Press');
    expect(addedItemIds[0]).toBe(added.items[0].id);
    // The friend's numbers stay marked as theirs, not my rated effort.
    expect(added.items[0].sets[0].actual).toMatchObject({ prefilled: true, rpeRated: false });
  });
});
