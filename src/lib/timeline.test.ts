import { describe, expect, it } from 'vitest';
import { buildTimeline, DAY_NAMES, ymd } from '@/lib/timeline';
import { tagColor } from '@/lib/tags';
import type { LogDocument, LogStatus, Plan, PlanDay, WorkoutLog } from '@/lib/types';

const NOW = new Date(2026, 4, 25, 12, 0, 0); // 2026-05-25, midday local

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function makeDay(
  label: string,
  dayKey = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, ''),
): PlanDay {
  return { dayKey, label, exercises: [] };
}

function makePlan(opts: { end_date: string | null; days: PlanDay[] }): Plan {
  return {
    id: 'p1',
    owner_user_id: 'u1',
    name: 'Test plan',
    start_date: '2026-05-01',
    end_date: opts.end_date,
    source_markdown: null,
    parsed: {
      title: 'Test plan',
      startDate: '2026-05-01',
      endDate: opts.end_date,
      blocks: [],
      weeklyTemplate: opts.days.map((d) => d.dayKey),
      days: opts.days,
    },
    is_active: true,
    is_public: false,
    created_at: '2026-05-01T00:00:00Z',
  };
}

function makeLog(opts: {
  log_date: string;
  status?: LogStatus;
  tags?: string[];
  activity_type?: string | null;
  day_key?: string | null;
  total_seconds?: number | null;
}): WorkoutLog {
  return {
    id: `l-${opts.log_date}`,
    owner_user_id: 'u1',
    plan_id: 'p1',
    session_id: null,
    log_date: opts.log_date,
    day_key: opts.day_key ?? null,
    week_number: null,
    status: opts.status ?? 'done',
    started_at: null,
    ended_at: null,
    total_seconds: opts.total_seconds ?? null,
    hr_avg: null,
    hr_max: null,
    notes: null,
    activity_type: opts.activity_type ?? null,
    tags: opts.tags ?? [],
    data: {} as LogDocument,
    source: 'manual',
    garmin_activity_id: null,
    created_at: `${opts.log_date}T00:00:00Z`,
  };
}

describe('buildTimeline', () => {
  it('with no logs spans today −30 … +14 days, all blank, exactly one today', () => {
    const points = buildTimeline(makePlan({ end_date: null, days: [] }), [], NOW);
    expect(points).toHaveLength(45);
    expect(points[0].date).toBe(ymd(addDays(NOW, -30)));
    expect(points[points.length - 1].date).toBe(ymd(addDays(NOW, 14)));
    expect(points.every((p) => p.state === 'blank')).toBe(true);
    const todays = points.filter((p) => p.isToday);
    expect(todays).toHaveLength(1);
    expect(todays[0].date).toBe(ymd(NOW));
  });

  it('does not paint future days from the plan — blank until logged', () => {
    const weekday = DAY_NAMES[NOW.getDay()]; // today's weekday name
    const plan = makePlan({ end_date: null, days: [makeDay(`${weekday} — Lower A (Squat-Dominant)`)] });
    const points = buildTimeline(plan, [], NOW);

    // Today and future days matching a scheduled weekday are no longer "planned".
    expect(points.find((p) => p.date === ymd(NOW))!.state).toBe('blank');
    expect(points.find((p) => p.date === ymd(addDays(NOW, 7)))!.state).toBe('blank');
    expect(points.every((p) => p.state === 'blank')).toBe(true);
  });

  it('marks logged days as "done", colored by tag, labelled from the matching plan day', () => {
    const logDate = ymd(addDays(NOW, -3));
    const plan = makePlan({
      end_date: null,
      days: [makeDay('Monday — Lower A (Squat-Dominant)', 'monday-lower-a-squat-dominant')],
    });
    const log = makeLog({
      log_date: logDate,
      status: 'done',
      tags: ['sport'],
      day_key: 'monday-lower-a-squat-dominant',
    });

    const points = buildTimeline(plan, [log], NOW);
    const p = points.find((x) => x.date === logDate)!;
    expect(p.state).toBe('done');
    expect(p.color).toBe(tagColor('sport'));
    expect(p.sessions).toEqual([[tagColor('sport')]]);
    expect(p.fullLabel).toBe('Lower A (Squat-Dominant)');
  });

  it('stacks a session with multiple tags into distinct colors', () => {
    const logDate = ymd(addDays(NOW, -2));
    const log = makeLog({ log_date: logDate, tags: ['strength', 'mobility'] });
    const points = buildTimeline(makePlan({ end_date: null, days: [] }), [log], NOW);
    const p = points.find((x) => x.date === logDate)!;
    expect(p.sessions).toEqual([[tagColor('strength'), tagColor('mobility')]]);
  });

  it('splits a multi-session day into one entry per session', () => {
    const logDate = ymd(addDays(NOW, -2));
    const logs = [
      makeLog({ log_date: logDate, tags: ['strength'] }),
      makeLog({ log_date: logDate, tags: ['endurance', 'mobility'] }),
    ];
    const points = buildTimeline(makePlan({ end_date: null, days: [] }), logs, NOW);
    const p = points.find((x) => x.date === logDate)!;
    expect(p.sessions).toHaveLength(2);
    expect(p.sessions[0]).toEqual([tagColor('strength')]);
    expect(p.sessions[1]).toEqual([tagColor('endurance'), tagColor('mobility')]);
    expect(p.fullLabel).toContain('×2');
  });

  it('carries per-session seconds and their sum, defaulting a null duration to 0', () => {
    const logDate = ymd(addDays(NOW, -2));
    const restDate = ymd(addDays(NOW, -1));
    const logs = [
      makeLog({ log_date: logDate, tags: ['strength'], total_seconds: 3600 }),
      makeLog({ log_date: logDate, tags: ['endurance'], total_seconds: null }),
    ];
    const points = buildTimeline(makePlan({ end_date: null, days: [] }), logs, NOW);

    const done = points.find((x) => x.date === logDate)!;
    expect(done.sessionSeconds).toEqual([3600, 0]);
    expect(done.seconds).toBe(3600);

    const rest = points.find((x) => x.date === restDate)!;
    expect(rest.sessionSeconds).toEqual([]);
    expect(rest.seconds).toBe(0);
  });

  it('counts in_progress as done and falls back to activity_type for the label', () => {
    const logDate = ymd(addDays(NOW, -1));
    const log = makeLog({ log_date: logDate, status: 'in_progress', activity_type: 'Run', day_key: null });
    const points = buildTimeline(makePlan({ end_date: null, days: [] }), [log], NOW);
    const p = points.find((x) => x.date === logDate)!;
    expect(p.state).toBe('done');
    expect(p.fullLabel).toBe('Run');
  });

  it('anchors the window start to the EARLIEST logged day, however far back', () => {
    // 35 consecutive done logs ending yesterday → window starts at the oldest.
    const logs = Array.from({ length: 35 }, (_, i) => makeLog({ log_date: ymd(addDays(NOW, -(i + 1))) }));
    const points = buildTimeline(makePlan({ end_date: null, days: [] }), logs, NOW);
    expect(points[0].date).toBe(ymd(addDays(NOW, -35)));
    expect(points[0].state).toBe('done');
    expect(points[points.length - 1].date).toBe(ymd(addDays(NOW, 14)));
  });

  it('reaches back years, so the home strip has history to scroll into', () => {
    // A window capped at the 30th most recent logged day left nothing to the
    // left of the strip's opening view — this is the regression guard for it.
    const logs = [
      makeLog({ log_date: ymd(addDays(NOW, -800)) }),
      ...Array.from({ length: 40 }, (_, i) => makeLog({ log_date: ymd(addDays(NOW, -(i + 1))) })),
    ];
    const points = buildTimeline(makePlan({ end_date: null, days: [] }), logs, NOW);
    expect(points[0].date).toBe(ymd(addDays(NOW, -800)));
    expect(points.find((p) => p.date === ymd(addDays(NOW, -800)))?.state).toBe('done');
    expect(points).toHaveLength(800 + 14 + 1);
  });

  it('works with no plan: today −30 … +14 days, all blank', () => {
    const points = buildTimeline(null, [], NOW);
    expect(points).toHaveLength(45);
    expect(points.every((p) => p.state === 'blank')).toBe(true);
    expect(points.filter((p) => p.isToday)).toHaveLength(1);
  });

  it('keeps rolling ≥10 days into the future even when the plan has already ended', () => {
    // A plan whose end_date is in the past must NOT truncate the window (the
    // "stuck ribbon" bug) — it always runs through today + 14.
    const points = buildTimeline(makePlan({ end_date: ymd(addDays(NOW, -3)), days: [] }), [], NOW);
    expect(points[points.length - 1].date).toBe(ymd(addDays(NOW, 14)));
    const futureDays = points.filter((p) => p.date > ymd(NOW));
    expect(futureDays.length).toBeGreaterThanOrEqual(10);
  });
});
