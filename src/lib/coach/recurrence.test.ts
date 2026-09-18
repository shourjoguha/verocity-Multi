import { describe, expect, it } from 'vitest';
import {
  IMPROVEMENT_EPS,
  MIN_RESOLVED_DROP,
  REGRESSION_DELTA,
  RESOLUTION_FLOOR,
  RESOLUTION_HOLD,
  RESOLUTION_MIN_SESSIONS,
  RESPEAK_DAYS,
  RESPEAK_SESSIONS,
  SPEAK_THRESHOLD,
  alreadyResolved,
  driftSlope,
  readingsSince,
  recurrence,
  resolvedRuleId,
  type Reading,
  type RecurrenceInput,
} from '@/lib/coach/recurrence';
import { THEMES, groupByTheme, themeOf } from '@/lib/coach/themes';
import { RULE_IMPACT } from '@/lib/coach/impact';
import type { Recommendation } from '@/lib/types';

const TODAY = new Date('2026-09-18T00:00:00Z');
const ago = (d: number) => new Date(TODAY.getTime() - d * 86_400_000).toISOString();
const day = (d: number) => ago(d).slice(0, 10);

function reading(daysAgo: number, drift: number, fired = drift > 0): Reading {
  return { observedOn: day(daysAgo), drift, fired };
}

function input(over: Partial<RecurrenceInput> = {}): RecurrenceInput {
  return {
    status: 'acted',
    decidedOn: ago(30),
    driftAtDecision: 0.6,
    drift: 0.6,
    fired: true,
    newSessions: 10,
    since: [],
    today: TODAY,
    ...over,
  };
}

describe('driftSlope', () => {
  it('refuses to call two points a trend', () => {
    expect(driftSlope([reading(10, 0.9), reading(3, 0.1)])).toBeNull();
  });

  it('is negative while a finding is coming down', () => {
    const s = driftSlope([reading(21, 0.9), reading(14, 0.6), reading(7, 0.3)]);
    expect(s).not.toBeNull();
    expect(s!).toBeLessThan(0);
  });

  it('counts readings, not elapsed days', () => {
    // Same three values; the second series is squeezed into one week. A trend
    // that steepened only because the athlete tapped the button more often is
    // not a steeper trend.
    const spread = driftSlope([reading(60, 0.9), reading(30, 0.6), reading(1, 0.3)]);
    const tight = driftSlope([reading(3, 0.9), reading(2, 0.6), reading(1, 0.3)]);
    expect(spread).toBe(tight);
  });
});

describe('recurrence — the bug it replaces', () => {
  it('speaks for a rule decided at the very top of the scale', () => {
    // `driftNow - driftAtDecision >= 0.15` is unsatisfiable at 1.0 because drift
    // is clamped 0..1. One real account had `intervals-not-all-out` acted at
    // 1.00 and therefore locked for 180 days whatever they did.
    const v = recurrence(input({ driftAtDecision: 1, drift: 1, newSessions: 9 }));
    expect(v.reason).toBe('persisting');
    expect(v.speaks).toBe(true);
  });

  it('speaks for a problem that simply has not moved', () => {
    const v = recurrence(input({ driftAtDecision: 0.5, drift: 0.5 }));
    expect(v.reason).toBe('persisting');
    expect(v.speaks).toBe(true);
  });

  it('sees a full relapse that the frozen anchor read as an improvement', () => {
    // 0.9 at the decision, down to 0.1, back to 0.8. The old comparison is
    // 0.8 - 0.9 = -0.1, i.e. "unchanged".
    const v = recurrence(
      input({
        driftAtDecision: 0.9,
        drift: 0.8,
        since: [reading(21, 0.4), reading(14, 0.1), reading(7, 0.12)],
      }),
    );
    expect(v.best).toBe(0.1);
    expect(v.reason).toBe('regressing');
    expect(v.speaks).toBe(true);
  });

  it('measures relapse from the best since, excluding this run', () => {
    // With the current reading inside the set, `best` would be the value being
    // compared against itself and a relapse could never be detected at all.
    const v = recurrence(input({ drift: 0.05, since: [reading(7, 0.5)] }));
    expect(v.best).toBe(0.5);
  });
});

describe('recurrence — staying quiet', () => {
  it('holds off while a finding is genuinely coming down', () => {
    const v = recurrence(
      input({ driftAtDecision: 0.9, drift: 0.3, since: [reading(21, 0.8), reading(14, 0.6), reading(7, 0.45)] }),
    );
    expect(v.reason).toBe('improving');
    expect(v.speaks).toBe(false);
  });

  it('uses the decision anchor for improvement before a series exists', () => {
    expect(recurrence(input({ driftAtDecision: 0.6, drift: 0.6 - IMPROVEMENT_EPS })).reason).toBe(
      'improving',
    );
    // A hair under the epsilon is not improvement, it is noise.
    expect(
      recurrence(input({ driftAtDecision: 0.6, drift: 0.6 - IMPROVEMENT_EPS + 0.01 })).reason,
    ).toBe('persisting');
  });

  it('does not re-raise a rule that is not currently true', () => {
    const v = recurrence(input({ fired: false, drift: 0 }));
    expect(v.speaks).toBe(false);
  });

  it('scores below the bar until enough days or sessions have landed', () => {
    const v = recurrence(input({ decidedOn: ago(3), newSessions: 1 }));
    expect(v.readiness).toBeLessThan(1);
    expect(v.score).toBeLessThan(SPEAK_THRESHOLD);
    expect(v.speaks).toBe(false);
  });

  it('unlocks on days alone for an athlete who trains rarely', () => {
    // The `OR` that RESPEAK_DAYS exists for: requiring both halves makes the
    // athlete a frequency rule most wants to reach wait the longest to hear it.
    const v = recurrence(
      input({ status: 'dismissed', decidedOn: ago(RESPEAK_DAYS.dismissed + 1), newSessions: 1 }),
    );
    expect(v.readiness).toBe(1);
    expect(v.speaks).toBe(true);
  });

  it('unlocks on sessions alone for an athlete who trains often', () => {
    const v = recurrence(input({ decidedOn: ago(6), newSessions: RESPEAK_SESSIONS.acted }));
    expect(v.readiness).toBe(1);
    expect(v.speaks).toBe(true);
  });
});

describe('recurrence — resolution', () => {
  const cleared = () =>
    input({
      driftAtDecision: 0.8,
      drift: 0.05,
      fired: false,
      newSessions: RESOLUTION_MIN_SESSIONS,
      since: [reading(21, 0.5), reading(14, 0.2), reading(7, 0.08)],
    });

  it('closes a loop the athlete actually finished', () => {
    const v = recurrence(cleared());
    expect(v.reason).toBe('resolved');
    expect(v.speaks).toBe(true);
  });

  it('needs the run of readings, not one quiet week', () => {
    const v = recurrence({ ...cleared(), since: [reading(21, 0.5), reading(14, 0.2), reading(7, 0.4)] });
    expect(v.reason).not.toBe('resolved');
  });

  it('needs training to have landed, so a holiday cannot clear anything', () => {
    const v = recurrence({ ...cleared(), newSessions: RESOLUTION_MIN_SESSIONS - 1 });
    expect(v.reason).not.toBe('resolved');
  });

  it('will not congratulate an athlete for a standing target that never moved', () => {
    // `nutrition.dose.protein-target` is true at drift 0 by construction. With
    // no MIN_RESOLVED_DROP it would "resolve" the moment it was acted on.
    const v = recurrence({
      ...cleared(),
      driftAtDecision: RESOLUTION_FLOOR + MIN_RESOLVED_DROP - 0.01,
      drift: 0,
    });
    expect(v.reason).not.toBe('resolved');
  });

  it('never congratulates on something that was dismissed', () => {
    const v = recurrence({ ...cleared(), status: 'dismissed' });
    expect(v.reason).not.toBe('resolved');
  });

  it('requires the newest reading to still be clear', () => {
    const v = recurrence({ ...cleared(), drift: 0.5, fired: true });
    expect(v.reason).not.toBe('resolved');
  });
});

describe('recurrence — interaction', () => {
  // True and not improving, but short of both halves of the re-speak window:
  // six days and one session. Alone it scores under the bar.
  const quiet = () =>
    input({ decidedOn: ago(6), driftAtDecision: 0.6, drift: 0.6, fired: true, newSessions: 1 });

  it('stays under the bar on its own', () => {
    const v = recurrence(quiet());
    expect(v.speaks).toBe(false);
    expect(v.reason).toBe('persisting');
  });

  it('raises a true rule when a sibling starts firing', () => {
    const v = recurrence({ ...quiet(), siblingFired: true });
    expect(v.reason).toBe('interacting');
    expect(v.speaks).toBe(true);
  });

  it('cannot manufacture a re-speak out of no training at all', () => {
    // The credit is capped at two sessions' worth and requires at least one
    // real session, so a theme cannot reopen a rule for an athlete who has done
    // nothing since deciding.
    const v = recurrence({ ...quiet(), newSessions: 0, siblingFired: true });
    expect(v.speaks).toBe(false);
  });

  it('does not relabel a finding that would have spoken anyway', () => {
    // Otherwise 'interacting' means nothing: on a page where most themes have
    // two live members it would be the reason on almost every row.
    const v = recurrence({ ...input({ newSessions: 10 }), siblingFired: true });
    expect(v.reason).toBe('persisting');
    expect(v.speaks).toBe(true);
  });

  it('cannot raise a rule that is not itself true', () => {
    expect(recurrence({ ...quiet(), fired: false, siblingFired: true }).reason).not.toBe(
      'interacting',
    );
  });

  it('cannot drag back a finding that is improving', () => {
    // This one shipped broken and the fixture caught it: every theme has two or
    // more members, so a sibling firing re-opened seven improving rules at once.
    const v = recurrence({
      ...quiet(),
      driftAtDecision: 0.9,
      drift: 0.2,
      siblingFired: true,
    });
    expect(v.reason).toBe('improving');
  });
});

describe('readingsSince', () => {
  it('drops the decision day itself', () => {
    const rows = [
      { observed_on: day(30), drift: 0.4, fired: true },
      { observed_on: day(29), drift: 0.3, fired: true },
    ];
    // Same-day readings measure the window that PRODUCED the finding, not the
    // athlete's response to it.
    expect(readingsSince(rows, ago(30))).toHaveLength(1);
  });

  it('sorts oldest first whatever order it is given', () => {
    const rows = [
      { observed_on: day(3), drift: 0.1, fired: false },
      { observed_on: day(20), drift: 0.9, fired: true },
    ];
    expect(readingsSince(rows, ago(40)).map((r) => r.drift)).toEqual([0.9, 0.1]);
  });
});

describe('resolution identity', () => {
  it('namespaces a closing finding so it has its own history', () => {
    expect(resolvedRuleId('training.endurance.zone2-short')).toBe(
      'outcome.resolved.training.endurance.zone2-short',
    );
  });

  it('says it once', () => {
    const rows = [
      { rule_id: resolvedRuleId('a.b.c'), status: 'open' } as unknown as Recommendation,
    ];
    expect(alreadyResolved('a.b.c', rows)).toBe(true);
    expect(alreadyResolved('a.b.d', rows)).toBe(false);
  });
});

describe('themes', () => {
  it('places every weighted rule in exactly one theme', () => {
    // RULE_IMPACT is the closest thing to a rule registry. A rule with a weight
    // and no theme is a rule that can never be grouped, which is silent.
    //
    // `outcome.*` is exempt and must stay exempt: a closing finding is the end
    // of a story, not a member of one, and grouping it under the theme it came
    // from would file "cleared" alongside the problems still open.
    const unthemed = Object.keys(RULE_IMPACT)
      .filter((id) => !id.startsWith('outcome.'))
      .filter((id) => themeOf(id) == null);
    expect(unthemed).toEqual([]);
  });

  it('never lists a rule in two themes', () => {
    const seen = new Set<string>();
    for (const t of THEMES) {
      for (const id of t.ruleIds) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
  });

  it('resolves a per-aspect rule by prefix', () => {
    expect(themeOf('goal.underserved.mobility')?.key).toBe('alignment');
  });

  it('has no theme for a closing finding — it is the end of a story', () => {
    expect(themeOf(resolvedRuleId('training.endurance.zone2-short'))).toBeNull();
  });

  it('does not make a card out of one finding', () => {
    const rows = [{ rule_id: 'training.endurance.zone2-short' }];
    expect(groupByTheme(rows)).toEqual([]);
  });

  it('groups the three findings that are one story', () => {
    // The real case: an athlete acted on all three of these as separate rows
    // over three weeks, solving the same problem three times.
    const rows = [
      { rule_id: 'training.endurance.zone2-short' },
      { rule_id: 'training.endurance.intervals-not-all-out' },
      { rule_id: 'nutrition.dose.protein-target' },
    ];
    const groups = groupByTheme(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].theme.key).toBe('endurance-quality');
    expect(groups[0].rows).toHaveLength(2);
  });

  it('ignores rows with no rule identity', () => {
    expect(groupByTheme([{ rule_id: null }, { rule_id: null }])).toEqual([]);
  });
});

describe('constants stay coherent', () => {
  it('needs more training to clear a rule than to re-raise an acted one', () => {
    expect(RESOLUTION_MIN_SESSIONS).toBeGreaterThan(RESPEAK_SESSIONS.acted);
  });

  it('holds a dismissal longer than an action, in both currencies', () => {
    expect(RESPEAK_SESSIONS.dismissed).toBeGreaterThan(RESPEAK_SESSIONS.acted);
    expect(RESPEAK_DAYS.dismissed).toBeGreaterThan(RESPEAK_DAYS.acted);
  });

  it('keeps the resolution floor below the relapse step', () => {
    // Otherwise a rule could be simultaneously cleared and relapsing.
    expect(RESOLUTION_FLOOR).toBeLessThan(REGRESSION_DELTA);
    expect(RESOLUTION_HOLD).toBeGreaterThan(1);
  });
});
