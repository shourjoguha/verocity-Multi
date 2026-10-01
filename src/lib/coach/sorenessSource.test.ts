import { describe, expect, it } from 'vitest';
import { runCoach } from '@/lib/coach/evaluate';
import { READINESS } from '@/lib/coach/knowledge';
import type { LogItem, VibeCheck, WorkoutLog } from '@/lib/types';

function item(movement: string): LogItem {
  return {
    id: movement,
    movement,
    primaryMetric: 'weight',
    sets: Array.from({ length: 4 }, () => ({
      planned: null,
      notations: [],
      actual: { completed: true, prefilled: false, weight: 60, reps: 8 },
    })),
  } as unknown as LogItem;
}

function log(id: string, date: string, type: string, movements: string[], vibe?: VibeCheck): WorkoutLog {
  return {
    id,
    log_date: date,
    status: 'done',
    activity_type: type,
    day_key: null,
    tags: [],
    total_seconds: 3600,
    data: {
      sections: [{ key: 'main', groups: [{ id: 'g', kind: 'single', items: movements.map(item) }] }],
      ...(vibe ? { session: { vibe } } : {}),
    },
  } as unknown as WorkoutLog;
}

const run = (logs: WorkoutLog[]) =>
  runCoach({ logs, meals: [], stats: null, existing: [], today: new Date('2026-09-10T12:00:00Z') }).findings.find(
    (f) => f.ruleId === 'training.recovery.soreness-source',
  );

describe('training.recovery.soreness-source', () => {
  const twoBack = log('a', '2026-09-08', 'Legs + core', ['Front Squat', 'Landmine Twist', 'Ab Wheel Rollout']);
  const oneBack = log('b', '2026-09-09', 'Conditioning', ['Sled Push']);

  it('names both sessions for the quads and only the earlier one for the core', () => {
    const report = log('c', '2026-09-10', 'Upper', [], {
      sleep: 3,
      energy: 3,
      soreness: 3,
      sore: ['quads', 'core'],
    });
    const f = run([twoBack, oneBack, report])!;
    expect(f).toBeDefined();
    expect(f.body).toMatch(/Quads: .*Legs \+ core 2 days before.* and Conditioning the day before.* both loaded it/);
    expect(f.body).toMatch(/Core: Legs \+ core 2 days before \(Ab Wheel Rollout, Landmine Twist\) is the only session/);
    expect(f.body).toMatch(/Conditioning the day before didn't load it, so this is delayed soreness/);
    // Never claims the soreness adds up: the corpus has no repeated-bout claim.
    expect(f.body).not.toMatch(/cumulative|adds up|stack/i);
    expect(f.claims.map((c) => c.id)).toEqual([READINESS.domsPeak.id, READINESS.trainSore.id]);
    expect(f.periodKey).toBe('2026-09-10');
  });

  it('turns "train it" into "train it lighter" at high soreness, citing that claim instead', () => {
    const report = log('c', '2026-09-10', 'Upper', [], { sleep: 3, energy: 3, soreness: 4, sore: ['quads'] });
    const f = run([twoBack, oneBack, report])!;
    expect(f.action).toMatch(/RPE 6/);
    expect(f.claims.map((c) => c.id)).toContain(READINESS.respondLighter.id);
  });

  it('stays silent with no area named, or on a stale report', () => {
    const noArea = log('c', '2026-09-10', 'Upper', [], { sleep: 3, energy: 3, soreness: 4 });
    expect(run([twoBack, oneBack, noArea])).toBeUndefined();
    const stale = log('c', '2026-08-20', 'Upper', [], { sleep: 3, energy: 3, soreness: 4, sore: ['quads'] });
    expect(run([twoBack, oneBack, stale])).toBeUndefined();
  });

  it('writes no clean reading when it stays silent — "not asked" is not "not sore"', () => {
    const plain = ['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08'].map((d, i) =>
      log(`p${i}`, d, 'Legs', ['Back Squat']),
    );
    const out = runCoach({
      logs: plain,
      meals: [],
      stats: null,
      existing: [
        {
          id: 'r1',
          rule_id: 'training.recovery.soreness-source',
          status: 'acted',
          created_at: '2026-08-30T00:00:00Z',
          drift_score: 0.5,
        } as never,
      ],
      today: new Date('2026-09-10T12:00:00Z'),
    });
    expect(out.observations.map((o) => o.rule_id)).not.toContain('training.recovery.soreness-source');
    expect(out.resolved).not.toContain('training.recovery.soreness-source');
  });
});
