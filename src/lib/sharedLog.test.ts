import { describe, expect, it } from 'vitest';
import { FRIENDS } from '@/app.config';
import {
  buildAcceptedLogRow,
  choosePlanDay,
  classifyBulkAccept,
  isSafeUrl,
  logsByDate,
  movementOverlap,
  planDayOverlap,
  sameDayOverlap,
  sanitiseSharedLog,
  unionLogs,
  validateLogDocument,
  validateSharedLogPayload,
} from '@/lib/sharedLog';
import type { LogDocument, LogItem, LogStatus, Plan, WorkoutLog } from '@/lib/types';

function item(movement: string, extra: Partial<LogItem> = {}): LogItem {
  return {
    id: `i-${movement}`,
    movement,
    primaryMetric: 'reps',
    sets: [
      {
        planned: '5',
        actual: { weight: 100, reps: 5, rpe: 8, completed: true, prefilled: false, rpeRated: true },
        notations: [],
      },
    ],
    ...extra,
  };
}

function doc(...movements: string[]): LogDocument {
  return {
    sections: [
      { key: 'primary', groups: movements.map((m) => ({ id: `g-${m}`, kind: 'single' as const, items: [item(m)] })) },
    ],
  };
}

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

const counter = () => {
  let n = 0;
  return () => `new-${++n}`;
};

describe('validateLogDocument — rejects, never repairs', () => {
  it('accepts a normal document and drops session and unknown keys', () => {
    const input = { ...doc('Back Squat'), session: { vibe: { sleep: 1, energy: 1, soreness: 5 } }, junk: 1 };
    const r = validateLogDocument(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual(doc('Back Squat'));
    expect('session' in r.value).toBe(false);
  });

  it.each([
    ['not an object', 'nope'],
    ['sections not an array', { sections: {} }],
    ['unknown section key', { sections: [{ key: 'bogus', groups: [] }] }],
    ['duplicate section key', { sections: [{ key: 'primary', groups: [] }, { key: 'primary', groups: [] }] }],
  ])('rejects %s', (_label, input) => {
    expect(validateLogDocument(input).ok).toBe(false);
  });

  const withItem = (over: Record<string, unknown>) => ({
    sections: [{ key: 'primary', groups: [{ id: 'g', kind: 'single', items: [{ ...item('Squat'), ...over }] }] }],
  });
  const withActual = (over: Record<string, unknown>) =>
    withItem({ sets: [{ planned: null, notations: [], actual: { completed: true, prefilled: false, ...over } }] });

  it.each([
    ['unknown metric key', withItem({ primaryMetric: 'joules' })],
    ['empty movement name', withItem({ movement: '   ' })],
    ['over-long movement name', withItem({ movement: 'x'.repeat(FRIENDS.limits.nameChars + 1) })],
    ['negative weight', withActual({ weight: -5 })],
    ['NaN reps', withActual({ reps: Number.NaN })],
    ['Infinity time', withActual({ time: Number.POSITIVE_INFINITY })],
    ['string weight', withActual({ weight: '100' })],
    ['rpe above scale', withActual({ rpe: 11 })],
    ['unknown actual field', withActual({ watts: 300 })],
    ['missing completed', withItem({ sets: [{ planned: null, notations: [], actual: { prefilled: false } }] })],
    ['too many sets', withItem({ sets: Array.from({ length: FRIENDS.limits.setsPerItem + 1 }, () => item('x').sets[0]) })],
    ['javascript: url', withItem({ kind: 'subroutine', url: 'javascript:alert(1)', sets: [] })],
    ['data: url', withItem({ kind: 'subroutine', url: 'data:text/html,<script>', sets: [] })],
    ['relative url', withItem({ kind: 'subroutine', url: '/app/you', sets: [] })],
    ['bad group kind', { sections: [{ key: 'primary', groups: [{ id: 'g', kind: 'giant', items: [] }] }] }],
    ['too many groups', { sections: [{ key: 'primary', groups: Array.from({ length: FRIENDS.limits.groupsPerSection + 1 }, (_, i) => ({ id: `g${i}`, kind: 'single', items: [] })) }] }],
  ])('rejects %s', (_label, input) => {
    expect(validateLogDocument(input).ok).toBe(false);
  });

  it('accepts an https subroutine link', () => {
    expect(validateLogDocument(withItem({ kind: 'subroutine', url: 'https://example.com/drill', sets: [] })).ok).toBe(true);
  });

  it('isSafeUrl allows http(s) only', () => {
    expect(isSafeUrl('http://a.b')).toBe(true);
    expect(isSafeUrl('https://a.b/c?d')).toBe(true);
    expect(isSafeUrl('JavaScript:alert(1)')).toBe(false);
    expect(isSafeUrl('vbscript:x')).toBe(false);
    expect(isSafeUrl('not a url')).toBe(false);
  });
});

describe('validateSharedLogPayload', () => {
  const good = {
    log_date: '2026-11-10',
    started_at: '2026-11-10T17:00:00Z',
    ended_at: null,
    total_seconds: 3600,
    activity_type: null,
    tags: ['strength'],
    data: doc('Back Squat'),
    movements: [
      { name: 'Zercher Hold', category: null, tags: [], default_metrics: ['time'], primary_metric: 'time', default_rest_seconds: 90, taxonomy: null },
    ],
  };
  it('accepts the RPC shape', () => {
    expect(validateSharedLogPayload(good).ok).toBe(true);
  });
  it.each([
    ['bad date', { ...good, log_date: '10/11/2026' }],
    ['bad timestamp', { ...good, started_at: 'yesterday' }],
    ['negative duration', { ...good, total_seconds: -1 }],
    ['duration over a day', { ...good, total_seconds: FRIENDS.limits.totalSeconds + 1 }],
    ['non-string tag', { ...good, tags: [1] }],
    ['bad movement metric', { ...good, movements: [{ ...good.movements[0], primary_metric: 'zz' }] }],
    ['bad data', { ...good, data: { sections: 'x' } }],
  ])('rejects %s', (_label, input) => {
    expect(validateSharedLogPayload(input).ok).toBe(false);
  });
});

describe('sanitiseSharedLog', () => {
  it('regenerates ids, marks sets prefilled with an unrated RPE, keeps completed', () => {
    const input: LogDocument = {
      ...doc('Back Squat', 'Bench Press'),
      session: { vibe: { sleep: 3, energy: 3, soreness: 3 } },
    };
    const out = sanitiseSharedLog(input, counter());
    expect('session' in out).toBe(false);
    const groups = out.sections[0].groups;
    const ids = [...groups.map((g) => g.id), ...groups.flatMap((g) => g.items.map((i) => i.id))];
    expect(new Set(ids).size).toBe(4);
    expect(ids.every((id) => id.startsWith('new-'))).toBe(true);
    for (const set of groups.flatMap((g) => g.items.flatMap((i) => i.sets))) {
      expect(set.actual.prefilled).toBe(true);
      expect(set.actual.rpeRated).toBe(false);
      expect(set.actual.completed).toBe(true);
      expect(set.actual.rpe).toBe(8); // the value stays; it just is not theirs
    }
    // input untouched
    expect(input.sections[0].groups[0].id).toBe('g-Back Squat');
    expect(input.sections[0].groups[0].items[0].sets[0].actual.rpeRated).toBe(true);
  });
});

describe('movementOverlap (§5.5)', () => {
  it('is shared names also in mine ÷ shared names, normalised, subroutines excluded', () => {
    const shared = doc('Back Squat', 'Bench Press', 'Pull-ups');
    shared.sections[0].groups.push({ id: 's', kind: 'single', items: [item('Warm-up notes', { kind: 'subroutine', sets: [] })] });
    const mine = doc('back squat', 'Pull-up', 'Row');
    expect(movementOverlap(shared, mine)).toBeCloseTo(2 / 3);
  });
  it('is 0 for a shared log with no movements', () => {
    expect(movementOverlap({ sections: [] }, doc('Squat'))).toBe(0);
  });
  it('sameDayOverlap takes the highest same-day counted log and skips review/cancelled rows', () => {
    const shared = doc('Back Squat', 'Bench Press');
    const logs = [
      wlog({ log_date: '2026-11-10', data: doc('Back Squat') }),
      wlog({ log_date: '2026-11-10', data: doc('Back Squat', 'Bench Press'), status: 'needs_review' }),
      wlog({ log_date: '2026-11-10', data: doc('Back Squat', 'Bench Press'), status: 'cancelled' }),
      wlog({ log_date: '2026-11-11', data: doc('Back Squat', 'Bench Press') }),
    ];
    const hit = sameDayOverlap(shared, '2026-11-10', logs);
    expect(hit?.log.id).toBe(logs[0].id);
    expect(hit?.overlap).toBe(0.5);
    expect(sameDayOverlap(shared, '2026-11-12', logs)).toBeNull();
  });
});

describe('unionLogs (§5.5)', () => {
  it('keeps mine, appends only what mine lacks, collapses a thinned superset to single', () => {
    const mine = doc('Back Squat');
    const shared: LogDocument = {
      sections: [
        {
          key: 'primary',
          groups: [{ id: 'ss', kind: 'superset', items: [item('back squat', { id: 'a' }), item('Bench Press', { id: 'b' })] }],
        },
        {
          key: 'accessory',
          groups: [
            { id: 'c3', kind: 'circuit', items: [item('Curl', { id: 'c' }), item('Dip', { id: 'd' }), item('Back Squat', { id: 'e' })] },
            { id: 'dup', kind: 'single', items: [item('Back Squat', { id: 'f' })] },
          ],
        },
      ],
    };
    const { doc: out, addedItemIds } = unionLogs(mine, shared);
    expect(addedItemIds).toEqual(['b', 'c', 'd']);
    const primary = out.sections.find((s) => s.key === 'primary')!;
    expect(primary.groups[0]).toEqual(mine.sections[0].groups[0]);
    expect(primary.groups[1].kind).toBe('single');
    expect(primary.groups[1].items.map((i) => i.id)).toEqual(['b']);
    const accessory = out.sections.find((s) => s.key === 'accessory')!;
    expect(accessory.groups).toHaveLength(1); // the all-duplicate group is dropped
    expect(accessory.groups[0].kind).toBe('circuit');
    expect(mine.sections[0].groups).toHaveLength(1); // input untouched
  });

  it('inserts a missing section in canonical order', () => {
    const mine: LogDocument = {
      sections: [
        { key: 'warmup', groups: [{ id: 'w', kind: 'single', items: [item('Row Erg')] }] },
        { key: 'conditioning', groups: [{ id: 'k', kind: 'single', items: [item('Burpee')] }] },
      ],
    };
    const shared: LogDocument = { sections: [{ key: 'primary', groups: [{ id: 'p', kind: 'single', items: [item('Deadlift')] }] }] };
    expect(unionLogs(mine, shared).doc.sections.map((s) => s.key)).toEqual(['warmup', 'primary', 'conditioning']);
  });

  it('appends a movement once even when the shared log repeats it', () => {
    const shared = doc('Lunge', 'Lunge');
    expect(unionLogs(doc('Squat'), shared).addedItemIds).toHaveLength(1);
  });
});

describe('choosePlanDay (§12.3)', () => {
  const plan: Plan = {
    id: 'plan',
    owner_user_id: 'me',
    name: 'Mine',
    start_date: '2026-05-01',
    end_date: null,
    source_markdown: null,
    is_active: true,
    is_public: false,
    created_at: '2026-05-01T00:00:00Z',
    parsed: {
      title: 'Mine',
      startDate: '2026-05-01',
      endDate: null,
      blocks: [{ type: 'accumulation', startWeek: 1, endWeek: 6 }],
      weeklyTemplate: ['lower', 'upper'],
      days: [
        {
          dayKey: 'lower',
          label: 'Lower',
          exercises: [
            { movement: 'Back Squat', section: 'primary', primaryMetric: 'reps', plannedByWeek: { 1: '3x5' } },
            { movement: 'Romanian Deadlift', section: 'secondary', primaryMetric: 'reps', plannedByWeek: { 1: '3x8' } },
          ],
        },
        {
          dayKey: 'upper',
          label: 'Upper',
          exercises: [
            { movement: 'Bench Press', section: 'primary', primaryMetric: 'reps', plannedByWeek: { 1: '3x5' } },
            { movement: 'Pull-up', section: 'secondary', primaryMetric: 'reps', plannedByWeek: { 1: '3x8' } },
          ],
        },
      ],
    },
  };
  const planLog = (day: string, date: string, status: LogStatus = 'done') =>
    wlog({ log_date: date, plan_id: 'plan', day_key: day, status });

  it('picks the best-matching day, counting minor swaps (compareMovements), and stamps the next week', () => {
    const logs = [planLog('lower', '2026-05-04'), planLog('upper', '2026-05-06')];
    const link = choosePlanDay({ doc: doc('Bench Press', 'Lat Pulldown'), logDate: '2026-05-08', plan, logs });
    expect(link).toEqual({ plan_id: 'plan', day_key: 'upper', week_number: 2 });
  });

  it('returns null below the threshold (a major swap does not count)', () => {
    expect(planDayOverlap(['Overhead Press'], ['Bench Press', 'Pull-up'])).toBe(0);
    expect(choosePlanDay({ doc: doc('Overhead Press'), logDate: '2026-05-08', plan, logs: [] })).toBeNull();
    // one of two prescribed + two extras: 2·1 / (3 + 2) = 0.4 < threshold
    expect(FRIENDS.planMatchThreshold).toBeGreaterThan(0.4);
    expect(choosePlanDay({ doc: doc('Back Squat', 'Curl', 'Dip'), logDate: '2026-05-08', plan, logs: [] })).toBeNull();
  });

  it('refuses a date before the first plan log — the backdated-row trap', () => {
    const logs = [planLog('lower', '2026-05-10'), planLog('upper', '2026-05-12')];
    expect(choosePlanDay({ doc: doc('Back Squat', 'Romanian Deadlift'), logDate: '2026-05-03', plan, logs })).toBeNull();
    expect(choosePlanDay({ doc: doc('Back Squat', 'Romanian Deadlift'), logDate: '2026-05-10', plan, logs })?.day_key).toBe('lower');
  });

  it('ignores needs_review and cancelled rows when finding the first plan log', () => {
    const logs = [planLog('lower', '2026-05-02', 'needs_review'), planLog('lower', '2026-05-03', 'cancelled'), planLog('lower', '2026-05-10')];
    expect(choosePlanDay({ doc: doc('Back Squat', 'Romanian Deadlift'), logDate: '2026-05-05', plan, logs })).toBeNull();
  });

  it('with no plan logs yet, falls back to the plan start date', () => {
    expect(choosePlanDay({ doc: doc('Back Squat', 'Romanian Deadlift'), logDate: '2026-04-20', plan, logs: [] })).toBeNull();
    expect(choosePlanDay({ doc: doc('Back Squat', 'Romanian Deadlift'), logDate: '2026-05-02', plan, logs: [] })).toEqual({
      plan_id: 'plan',
      day_key: 'lower',
      week_number: 1,
    });
  });

  it('returns null with no active plan', () => {
    expect(choosePlanDay({ doc: doc('Back Squat'), logDate: '2026-05-02', plan: null, logs: [] })).toBeNull();
  });
});

describe('buildAcceptedLogRow', () => {
  const payload = {
    log_date: '2026-11-10',
    started_at: '2026-11-10T17:00:00Z',
    ended_at: '2026-11-10T18:00:00Z',
    total_seconds: 3600,
    activity_type: null,
    tags: ['strength'],
    data: { ...doc('Back Squat'), session: { vibe: { sleep: 1, energy: 1, soreness: 1 } } },
    movements: [],
    // A hostile sender adding fields the RPC never sends:
    notes: 'private',
    hr_avg: 150,
    garmin_activity_id: 'x',
    plan_id: 'theirs',
  };

  it('builds the insert row from allow-listed fields with the receiver plan link', () => {
    const r = buildAcceptedLogRow(payload, 'needs_review', { plan_id: 'mine', day_key: 'lower', week_number: 3 }, 'item-1', counter());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.value).sort()).toEqual(
      ['activity_type', 'data', 'day_key', 'ended_at', 'log_date', 'plan_id', 'shared_item_id', 'source', 'started_at', 'status', 'tags', 'total_seconds', 'week_number'].sort(),
    );
    expect(r.value).toMatchObject({ status: 'needs_review', plan_id: 'mine', day_key: 'lower', week_number: 3, shared_item_id: 'item-1', source: 'manual' });
    expect('session' in r.value.data).toBe(false);
    expect(r.value.data.sections[0].groups[0].items[0].sets[0].actual).toMatchObject({ prefilled: true, rpeRated: false });
  });

  it('nulls the plan link when none is given', () => {
    const r = buildAcceptedLogRow(payload, 'done', null, 'item-1');
    expect(r.ok && [r.value.plan_id, r.value.day_key, r.value.week_number]).toEqual([null, null, null]);
  });

  it('rejects an invalid payload', () => {
    expect(buildAcceptedLogRow({ ...payload, log_date: 'soon' }, 'done', null, 'x').ok).toBe(false);
  });
});

describe('classifyBulkAccept (§12.1)', () => {
  it('sends same-day conflicts with counted logs to review; siblings never conflict with each other', () => {
    const items = [
      { id: 'a', item_date: '2026-11-10' },
      { id: 'b', item_date: '2026-11-11' },
      { id: 'c', item_date: '2026-11-11' },
      { id: 'd', item_date: '2026-11-12' },
      { id: 'e', item_date: '2026-11-13' },
    ];
    const mine = logsByDate([
      wlog({ log_date: '2026-11-10' }),
      wlog({ log_date: '2026-11-12', status: 'cancelled' }),
      wlog({ log_date: '2026-11-13', status: 'needs_review' }),
      wlog({ log_date: '2026-11-13', status: 'in_progress' }),
    ]);
    const { done, needsReview } = classifyBulkAccept(items, mine);
    expect(needsReview.map((i) => i.id)).toEqual(['a', 'e']);
    expect(done.map((i) => i.id)).toEqual(['b', 'c', 'd']);
  });
});
