// Four findings that were true to the code and false to the athlete, each from
// a "Noted" on the live page (2026-10-13): a run of training days that had
// already been broken by rest, a "Cleared" that was the coach moving its own
// ruler, strength judged on sets that were never strength work, and a closing
// card taking a lead slot from a real problem.

import { describe, expect, it } from 'vitest';
import { TRAINING } from '@/lib/coach/knowledge';
import { RULE_IMPACT, byImpact } from '@/lib/coach/impact';
import {
  DEFINITION_CHANGES,
  claimValueChanges,
  closingFinding,
  definitionChangesSince,
  outcomeKind,
  subjectOf,
} from '@/lib/coach/outcome';
import { recurrence } from '@/lib/coach/recurrence';
import { currentTrainingRun, measureTraining } from '@/lib/coach/signals';
import { consecutiveDays, loadedTooLight } from '@/lib/coach/rules/training';
import type { Recommendation, SetActual, UserStats, WorkoutLog } from '@/lib/types';

const opts = {
  heavyFraction: TRAINING.strengthIntensityModerate.value,
  strengthRepMax: TRAINING.strengthReps.value,
  hypertrophyReps: TRAINING.hypertrophyReps.value,
  nearFailureRpe: TRAINING.hypertrophyProximityToFailure.value,
  allOutRpe: TRAINING.vo2AllOut.value,
  heavyRestSeconds: TRAINING.strengthRest.value,
};

/** A done session on `date`, optionally tagged. Sections are filled by callers. */
function session(date: string, tags: string[] = [], sections: unknown[] = []): WorkoutLog {
  return {
    id: `log-${date}-${tags.join('-')}`,
    owner_user_id: 'u',
    plan_id: null,
    log_date: date,
    status: 'done',
    tags,
    hr_max: null,
    hr_avg: null,
    data: { sections },
  } as unknown as WorkoutLog;
}

/** Every date from `from` to `to` inclusive, 'YYYY-MM-DD'. */
function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

describe('consecutive days: the run still going, not the longest in the window', () => {
  // The live case: nine days running Sep 18–26, scattered sessions after, then
  // Oct 11 and 12 off, checked in on the morning of Oct 13.
  const LIVE = [
    ...days('2026-09-18', '2026-09-26').map((d) => session(d)),
    ...['2026-10-01', '2026-10-03', '2026-10-06', '2026-10-08', '2026-10-10'].map((d) => session(d)),
  ];
  const OCT13 = new Date('2026-10-13T08:00:00Z');

  it('reads zero after two full rest days, however long the run before them', () => {
    expect(currentTrainingRun(LIVE, OCT13)).toEqual({ days: 0, endedOn: null });
    const t = measureTraining(LIVE, opts, OCT13);
    expect(t.currentConsecutiveDays).toBe(0);
    expect(consecutiveDays(t, null, '2026-W42')).toBeNull();
  });

  it('counts a run ending yesterday, because today has not broken it yet', () => {
    const logs = days('2026-10-08', '2026-10-12').map((d) => session(d));
    expect(currentTrainingRun(logs, OCT13)).toEqual({ days: 5, endedOn: '2026-10-12' });
  });

  it('counts a run ending today', () => {
    const logs = days('2026-10-09', '2026-10-13').map((d) => session(d));
    expect(currentTrainingRun(logs, OCT13).days).toBe(5);
  });

  it('does not count a recovery session as a training day', () => {
    // Logging the Yin class the rule asks for must not extend the run.
    const logs = [
      ...days('2026-10-07', '2026-10-10').map((d) => session(d)),
      session('2026-10-11', ['recovery']),
      ...days('2026-10-12', '2026-10-13').map((d) => session(d)),
    ];
    expect(currentTrainingRun(logs, OCT13).days).toBe(2);
  });

  it('a day with training AND a recovery session is still a training day', () => {
    const logs = [
      ...days('2026-10-09', '2026-10-13').map((d) => session(d)),
      session('2026-10-11', ['recovery']),
    ];
    expect(currentTrainingRun(logs, OCT13).days).toBe(5);
  });

  it('calls itself a load cue and never claims to have seen a decrement', () => {
    const logs = days('2026-10-07', '2026-10-13').map((d) => session(d));
    const f = consecutiveDays(measureTraining(logs, opts, OCT13), null, '2026-W42');
    expect(f).not.toBeNull();
    expect(f!.observed.currentRun).toBe(7);
    expect(f!.body).toContain('load cue only');
    // Galpin's number is about performance getting worse — the body has to say
    // that is what it is, and that this rule cannot see it.
    expect(f!.body).toContain('performance getting worse, not five days of training');
    expect(f!.body).toContain('Recovery sessions are not counted');
  });
});

describe('strength intensity: main block, five reps or fewer', () => {
  const set = (weight: number, reps: number) => ({
    planned: null,
    notations: [],
    actual: { weight, reps, completed: true } as SetActual,
  });
  const item = (id: string, movement: string, sets: ReturnType<typeof set>[]) => ({
    id,
    movement,
    primaryMetric: 'weight',
    sets,
  });
  const section = (key: string, items: ReturnType<typeof item>[]) => ({
    key,
    groups: [{ id: `g-${key}`, kind: 'single', items }],
  });
  const TODAY = new Date('2026-10-16T12:00:00Z');

  /** Heavy triples in the main block; light work everywhere else. */
  const logs = days('2026-10-01', '2026-10-14')
    .filter((_, i) => i % 2 === 0)
    .map((d, i) =>
      session(d, [], [
        section('primary', [
          // A ramp set, then three working triples near the best.
          item(`sq-${i}`, 'Back Squat', [set(60, 5), set(100, 3), set(100, 3), set(100, 3)]),
          // Eight-rep main-block work is not strength-shaped; it is excluded.
          item(`bp-${i}`, 'Bench Press', [set(50, 8), set(50, 8)]),
        ]),
        section('secondary', [item(`rdl-${i}`, 'Romanian Deadlift', [set(60, 10), set(60, 10)])]),
        section('accessory', [item(`row-${i}`, 'Cable Row', [set(30, 12), set(30, 12)])]),
      ]),
    );

  it('counts only main-block sets of five reps or fewer', () => {
    const t = measureTraining(logs, opts, TODAY);
    // 7 sessions × 4 squat sets. Bench, RDL and rows are left out.
    expect(t.loadedIntensity.value.total).toBe(28);
    expect(t.loadedIntensity.value.atOrAboveHeavy).toBe(21);
  });

  it('does not fire on a strength block because the accessories are light', () => {
    const t = measureTraining(logs, opts, TODAY);
    const stats = {
      experience: 'intermediate',
      goals: [{ id: 'strength', label: 'Strength', weight: 40 }],
    } as unknown as UserStats;
    expect(loadedTooLight(t, stats, '2026-W42')).toBeNull();
  });

  it('names its scope in the body and in observed', () => {
    const t = measureTraining(logs, opts, TODAY);
    const forced = {
      ...t,
      loadedIntensity: { ...t.loadedIntensity, value: { ...t.loadedIntensity.value, share: 0.05 } },
    };
    const stats = {
      experience: 'intermediate',
      goals: [{ id: 'strength', label: 'Strength', weight: 40 }],
    } as unknown as UserStats;
    const f = loadedTooLight(forced, stats, '2026-W42')!;
    expect(f.tldr).toContain('main-block strength sets');
    expect(f.tldr.length).toBeLessThanOrEqual(60);
    expect(f.body).toContain('Hypertrophy, accessory and conditioning sets are left out');
    expect(f.observed.strengthSets).toBe(28);
    expect(f.observed.scope).toBe('primary, <=5 reps');
  });
});

describe('closing findings: cleared vs re-measured', () => {
  const RULE = 'training.intent.loaded-too-light';
  // The live row: acted on 2026-10-03 at drift 0.68 under the 85% line.
  const decision = {
    id: 'r',
    owner_user_id: 'u',
    rule_id: RULE,
    status: 'acted',
    drift_score: 0.68,
    tldr: '8% of loaded sets reach 85%',
    created_at: '2026-10-03T09:00:00Z',
    evidence: {
      packVersion: '2026.10.2',
      claims: [{ id: 'strength.intensity', value: 0.85, unit: 'fraction of 1RM' }],
      observed: {},
      sufficiency: 'ok',
    },
  } as unknown as Recommendation;
  const today = new Date('2026-10-13T08:00:00Z');
  const verdict = recurrence({
    status: 'acted',
    decidedOn: decision.created_at,
    driftAtDecision: 0.68,
    drift: 0,
    fired: false,
    newSessions: 6,
    since: [{ observedOn: '2026-10-10', drift: 0.12, fired: true }],
    today,
  });

  it('calls the 2026-10-13 card what it was: the coach changing its own line', () => {
    const f = closingFinding({
      ruleId: RULE,
      decision,
      driftNow: 0,
      newSessions: 6,
      periodKey: '2026-W42',
      verdict,
    });
    expect(f.tldr).toBe('Re-measured: heavy loading');
    // Never the old problem restated as a headline.
    expect(f.tldr).not.toContain('85%');
    expect(f.body).toContain('85% to 75%');
    expect(f.body).toContain('“8% of loaded sets reach 85%”');
    expect(f.body).not.toContain('change holding');
    expect(outcomeKind({ observed: f.observed })).toBe('remeasured');
  });

  it('says "cleared" when nothing about the measure changed', () => {
    const zone2 = {
      ...decision,
      rule_id: 'training.endurance.zone2-short',
      tldr: '53 min/week of aerobic work',
      evidence: null,
    } as Recommendation;
    const f = closingFinding({
      ruleId: 'training.endurance.zone2-short',
      decision: zone2,
      driftNow: 0,
      newSessions: 6,
      periodKey: '2026-W40',
      verdict,
      changes: [],
    });
    expect(f.tldr).toBe('Cleared: weekly zone 2 time');
    expect(f.tldr).not.toContain('53');
    expect(f.body).toContain('“53 min/week of aerobic work”');
    expect(f.body).toContain('6 sessions since');
    expect(outcomeKind({ observed: f.observed })).toBe('cleared');
    // Rows written before this change carry no `outcome` and were all "cleared".
    expect(outcomeKind(null)).toBe('cleared');
  });

  it('counts a change on the decision day, and not one before it', () => {
    const changes = [
      { ruleId: RULE, on: '2026-10-02', what: 'before' },
      { ruleId: RULE, on: '2026-10-03', what: 'same day' },
      { ruleId: 'other.rule', on: '2026-10-05', what: 'another rule' },
    ];
    expect(definitionChangesSince(RULE, decision.created_at, changes).map((c) => c.what)).toEqual([
      'same day',
    ]);
  });

  it('catches an edited claim value with no changelog entry', () => {
    const now = { 'strength.intensity': { value: 0.8, unit: 'fraction of 1RM' } };
    expect(claimValueChanges(decision.evidence, now)).toEqual([
      'the line it is measured against moved from 85% to 80%',
    ]);
    expect(claimValueChanges(decision.evidence)).toEqual([]);
    expect(claimValueChanges(null)).toEqual([]);
  });

  it('has a neutral subject for every ranked rule, and dated changes only for real ones', () => {
    for (const id of Object.keys(RULE_IMPACT)) {
      expect(subjectOf(id), id).not.toBe('this finding');
    }
    expect(subjectOf('goal.underserved.endurance')).toBe('time on your top-ranked goal');
    for (const c of DEFINITION_CHANGES) {
      expect(c.on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.what.length).toBeGreaterThan(20);
    }
  });
});

describe('closing findings never compete for a lead slot', () => {
  it('ranks every rule finding above every closing finding', () => {
    // The live scores: a closing card at ~0.245 against zone2-short at ~0.247.
    const closing = { ruleId: 'outcome.resolved.training.intent.loaded-too-light', drift: 1, confidence: 1 };
    const mild = { ruleId: 'training.endurance.interval-ordering', drift: 0, confidence: 0.1 };
    expect([closing, mild].sort(byImpact).map((x) => x.ruleId)).toEqual([
      mild.ruleId,
      closing.ruleId,
    ]);
  });
});
