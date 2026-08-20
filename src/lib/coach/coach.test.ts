import { describe, expect, it } from 'vitest';
import logsFixture from './__fixtures__/logs.json';
import mealsFixture from './__fixtures__/meals.json';
import statsFixture from './__fixtures__/userStats.json';
import { COOLDOWN_DAYS, MAX_FINDINGS, isSuppressed, runCoach } from '@/lib/coach/evaluate';
import { measureGoals, measureNutrition, measureTraining } from '@/lib/coach/signals';
import { CLAIMS, KNOWLEDGE_PACK_VERSION, NUTRITION, SOURCES, TRAINING } from '@/lib/coach/knowledge';
import { carbTimingWindow } from '@/lib/coach/rules/nutrition';
import type { MealLog, Recommendation, UserStats, WorkoutLog } from '@/lib/types';

// Anchored one day after the newest fixture row so the 28-day window is stable.
const TODAY = new Date('2026-08-21T00:00:00Z');
const LOGS = logsFixture as unknown as WorkoutLog[];
const MEALS = mealsFixture as unknown as MealLog[];
const STATS = statsFixture as unknown as UserStats;

const base = { logs: LOGS, meals: MEALS, stats: STATS, existing: [], today: TODAY };

const trainingOpts = {
  heavyFraction: TRAINING.strengthIntensity.value,
  strengthRepMax: TRAINING.strengthReps.value,
  hypertrophyReps: TRAINING.hypertrophyReps.value,
};

function rec(over: Partial<Recommendation>): Recommendation {
  return {
    id: crypto.randomUUID(),
    owner_user_id: 'u',
    status: 'open',
    drift_score: 0,
    confidence: 0,
    tldr: null,
    action: null,
    body_md: null,
    disposition: null,
    disposition_note: null,
    linked_log_id: null,
    snooze_until: null,
    created_at: TODAY.toISOString(),
    rule_id: null,
    period_key: null,
    pack_version: null,
    evidence: null,
    ...over,
  };
}

describe('knowledge pack', () => {
  it('attributes every claim to a person, never to "research"', () => {
    for (const claim of Object.values(CLAIMS)) {
      const src = SOURCES[claim.source];
      expect(src, `${claim.id} has no source`).toBeTruthy();
      expect(src.speaker).not.toMatch(/research|stud(y|ies)|science/i);
      expect(src.url).toMatch(/^https:\/\//);
      expect(src.vaultPath).toMatch(/\.md$/);
    }
  });

  it('gives every claim a non-empty verbatim quote', () => {
    for (const claim of Object.values(CLAIMS)) {
      expect(claim.quote.length, `${claim.id} has no quote`).toBeGreaterThan(10);
      // A quote is pasted, not written. Ellipsis is the tell that it was edited.
      expect(claim.quote).not.toContain('…');
    }
  });

  it('has unique claim ids', () => {
    const ids = Object.values(CLAIMS).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('signals', () => {
  const training = measureTraining(LOGS, trainingOpts, TODAY);

  it('measures elapsed and working minutes as DIFFERENT numbers', () => {
    // The bug this engine shipped with once: an hour of lifting is ~20 working
    // minutes and ~60 elapsed. If these ever converge, the attribution in
    // sessionMinutesPerWeek has silently stopped doing anything.
    const working = training.modalityMinutesPerWeek.value.resistance;
    const elapsed = training.sessionMinutesPerWeek.value.resistance;
    expect(elapsed).toBeGreaterThan(working * 1.5);
  });

  it('reports insufficiency instead of guessing on thin inputs', () => {
    // Four main-lift sets in the window recorded both load and reps. That is not
    // enough to claim anything about training intensity.
    expect(training.primaryIntensity.samples).toBeLessThan(12);
    expect(training.primaryIntensity.sufficiency).toBe('insufficient');
    expect(training.primaryIntensity.shortfall).toBeTruthy();
  });

  it('keeps goal shares summing to one so over- and under-service are one fact', () => {
    const shares = measureGoals(STATS, training).value;
    const sum = shares.reduce((s, g) => s + g.actual, 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(shares.reduce((s, g) => s + g.intent, 0)).toBeCloseTo(1, 5);
    // `skill` is ranked 0 and has no modality — it must not appear as neglected.
    expect(shares.map((g) => g.id)).not.toContain('skill');
  });

  it('counts nutrition timing from wall clock and never from portion size', () => {
    const n = measureNutrition(MEALS, LOGS, TODAY);
    expect(n.firstMealHour.value).toBeGreaterThan(6);
    expect(n.lastMealHour.value).toBeGreaterThan(n.firstMealHour.value);
    expect(n.meanHungerBefore.value).toBeGreaterThanOrEqual(1);
    expect(n.meanHungerBefore.value).toBeLessThanOrEqual(5);
  });
});

describe('runCoach', () => {
  it('is deterministic — same input, same rows', () => {
    const a = runCoach(base);
    const b = runCoach(base);
    expect(JSON.stringify(a.write)).toBe(JSON.stringify(b.write));
  });

  it('caps how much it says at once', () => {
    const out = runCoach(base);
    expect(out.write.length).toBeLessThanOrEqual(MAX_FINDINGS);
    expect(out.findings.length).toBeGreaterThanOrEqual(out.write.length);
  });

  it('stamps every row with a rule id, a period and the pack version', () => {
    for (const row of runCoach(base).write) {
      expect(row.rule_id).toMatch(/^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/);
      expect(row.period_key).toMatch(/^\d{4}(-W\d{2}|-\d{2})$/);
      expect(row.pack_version).toBe(KNOWLEDGE_PACK_VERSION);
    }
  });

  it('freezes resolved citations into evidence rather than referencing them', () => {
    const cited = runCoach(base).write.filter((r) => r.evidence.claims.length > 0);
    expect(cited.length).toBeGreaterThan(0);
    for (const row of cited) {
      for (const c of row.evidence.claims) {
        // Resolved: the row can render itself after the pack moves on.
        expect(c.quote.length).toBeGreaterThan(10);
        expect(c.speaker.length).toBeGreaterThan(0);
        expect(c.url).toMatch(/^https:\/\//);
      }
    }
  });

  it('quotes the number it fired on inside the body', () => {
    for (const row of runCoach(base).write) {
      expect(row.body_md.length).toBeGreaterThan(80);
      expect(row.tldr.length).toBeLessThanOrEqual(200);
      expect(/\d/.test(row.body_md), `${row.rule_id} body has no numbers`).toBe(true);
    }
  });

  it('says something about training AND about nutrition', () => {
    const ids = runCoach(base).write.map((r) => r.rule_id);
    expect(ids.some((i) => i.startsWith('training.') || i.startsWith('goal.'))).toBe(true);
    expect(ids.some((i) => i.startsWith('nutrition.'))).toBe(true);
  });

  it('stays silent about main-lift intensity when the sample is four sets', () => {
    // primaryTooLight would otherwise fire loudly: 0 of 4 sets were heavy.
    expect(runCoach(base).findings.map((f) => f.ruleId)).not.toContain(
      'training.intent.primary-too-light',
    );
  });
});

describe('caveat gates', () => {
  it('will not raise carb timing below the training frequency its source names', () => {
    const training = measureTraining(LOGS, trainingOpts, TODAY);
    const nutrition = measureNutrition(MEALS, LOGS, TODAY);
    expect(training.sessionsPerWeek.value).toBeLessThan(
      NUTRITION.carbTimingPrecondition.value,
    );
    expect(carbTimingWindow(nutrition, training, STATS, '2026-W34')).toBeNull();
  });

  it('raises it once training frequency clears the precondition', () => {
    const training = measureTraining(LOGS, trainingOpts, TODAY);
    const daily = {
      ...training,
      sessionsPerWeek: { value: 8, samples: 32, sufficiency: 'ok' as const },
    };
    const nutrition = {
      ...measureNutrition(MEALS, LOGS, TODAY),
      trainingDays: 10,
      trainingDaysFuelled: 4,
    };
    const f = carbTimingWindow(nutrition, daily, STATS, '2026-W34');
    expect(f?.ruleId).toBe('nutrition.timing.carb-window');
    // The gate itself must be visible to the athlete, not just enforced in code.
    expect(f?.body).toContain('precondition');
  });

  it('never derives a gram from a logged meal', () => {
    // The only rule allowed to name grams is the standing target, and it must
    // reach them from bodyweight — never from size or tag_mix.
    const out = runCoach(base);
    const gramRules = out.findings.filter((f) => /\d+\s?g\b|grams/.test(f.body));
    for (const f of gramRules) {
      expect(f.ruleId).toBe('nutrition.dose.protein-target');
      expect(f.observed.bodyWeightKg).toBe(86);
      expect(f.body).toContain('records no grams');
    }
  });
});

describe('suppression', () => {
  const ruleId = 'training.endurance.zone2-short';

  it('lets a rule update its own open row inside the same period', () => {
    const existing = [rec({ rule_id: ruleId, period_key: '2026-W34', status: 'open' })];
    expect(isSuppressed(ruleId, '2026-W34', existing, TODAY)).toBe(false);
  });

  it('does not mint a second row while an older one is still open', () => {
    const existing = [rec({ rule_id: ruleId, period_key: '2026-W33', status: 'open' })];
    expect(isSuppressed(ruleId, '2026-W34', existing, TODAY)).toBe(true);
  });

  it('honours a dismissal for weeks, even though the data has not changed', () => {
    // The failure this exists to prevent: a finding the athlete rejected
    // reappearing on the next check-in because the underlying measurement
    // cannot move for another fortnight.
    const justNow = rec({
      rule_id: ruleId,
      period_key: '2026-W33',
      status: 'dismissed',
      created_at: new Date(TODAY.getTime() - 7 * 86_400_000).toISOString(),
    });
    expect(isSuppressed(ruleId, '2026-W34', [justNow], TODAY)).toBe(true);

    const longAgo = rec({
      rule_id: ruleId,
      period_key: '2026-W20',
      status: 'dismissed',
      created_at: new Date(
        TODAY.getTime() - (COOLDOWN_DAYS.dismissed + 1) * 86_400_000,
      ).toISOString(),
    });
    expect(isSuppressed(ruleId, '2026-W34', [longAgo], TODAY)).toBe(false);
  });

  it('gives acted-on advice time to land before grading it', () => {
    const acted = rec({
      rule_id: ruleId,
      status: 'acted',
      disposition: 'acted_as_prescribed',
      created_at: new Date(TODAY.getTime() - 3 * 86_400_000).toISOString(),
    });
    expect(isSuppressed(ruleId, '2026-W34', [acted], TODAY)).toBe(true);
  });

  it('respects an unexpired snooze and releases an expired one', () => {
    const future = rec({
      rule_id: ruleId,
      status: 'snoozed',
      snooze_until: new Date(TODAY.getTime() + 2 * 86_400_000).toISOString(),
    });
    expect(isSuppressed(ruleId, '2026-W34', [future], TODAY)).toBe(true);

    const past = rec({
      rule_id: ruleId,
      status: 'snoozed',
      snooze_until: new Date(TODAY.getTime() - 86_400_000).toISOString(),
    });
    expect(isSuppressed(ruleId, '2026-W34', [past], TODAY)).toBe(false);
  });

  it('reads only the newest decision for a rule', () => {
    const existing = [
      rec({
        rule_id: ruleId,
        status: 'dismissed',
        created_at: new Date(TODAY.getTime() - 90 * 86_400_000).toISOString(),
      }),
      rec({
        rule_id: ruleId,
        status: 'acted',
        created_at: new Date(TODAY.getTime() - 2 * 86_400_000).toISOString(),
      }),
    ];
    // The dismissal has long expired; the recent action still buys silence.
    expect(isSuppressed(ruleId, '2026-W34', existing, TODAY)).toBe(true);
  });

  it('drops suppressed findings from the write set and reports why', () => {
    const dismissAll = runCoach(base).findings.map((f) =>
      rec({ rule_id: f.ruleId, period_key: '2026-W33', status: 'dismissed' }),
    );
    const out = runCoach({ ...base, existing: dismissAll });
    expect(out.write).toHaveLength(0);
    expect(out.suppressed.length).toBe(out.findings.length);
  });
});

describe('cold start', () => {
  it('says nothing at all rather than guessing from no data', () => {
    const out = runCoach({ logs: [], meals: [], stats: null, existing: [], today: TODAY });
    expect(out.write).toHaveLength(0);
  });

  it('does not invent a protein target without a bodyweight', () => {
    const noWeight = { ...STATS, body_weight_kg: null };
    const ids = runCoach({ ...base, stats: noWeight }).findings.map((f) => f.ruleId);
    expect(ids).not.toContain('nutrition.dose.protein-target');
  });

  it('does not accuse an athlete of neglecting a goal they never set', () => {
    const noGoals = { ...STATS, goals: [] };
    const ids = runCoach({ ...base, stats: noGoals }).findings.map((f) => f.ruleId);
    expect(ids.filter((i) => i.startsWith('goal.'))).toHaveLength(0);
    // Goal-gated training rules go quiet too.
    expect(ids).not.toContain('training.hypertrophy.total-volume-short');
    expect(ids).not.toContain('training.hypertrophy.region-volume-short');
  });
});
