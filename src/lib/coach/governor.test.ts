import { describe, expect, it } from 'vitest';
import {
  MAX_NOTE_CHARS,
  MIN_EDGE_CONFIDENCE,
  briefAgeDays,
  currentBrief,
  governContextNotes,
  governEdges,
  isKnownRuleId,
  rejectNote,
  statesANumber,
} from '@/lib/coach/governor';
import type { CoachBrief, CoachRuleNote } from '@/lib/types';

const NOW = new Date('2026-09-18T12:00:00Z');
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();
const REAL_RULE = 'training.endurance.zone2-short';
const OTHER_RULE = 'training.hypertrophy.effort-low';

function note(over: Partial<CoachRuleNote> = {}): CoachRuleNote {
  return {
    id: crypto.randomUUID(),
    owner_user_id: 'u',
    rule_id: REAL_RULE,
    kind: 'context',
    related_rule_id: null,
    note: 'Their easy riding is a commute they do not log as training.',
    confidence: 0.8,
    author: 'claude-code',
    expires_at: inDays(30),
    created_at: inDays(-1),
    ...over,
  };
}

function brief(over: Partial<CoachBrief> = {}): CoachBrief {
  return {
    id: crypto.randomUUID(),
    owner_user_id: 'u',
    theme: null,
    rule_ids: [],
    headline: 'Endurance is the limiting side',
    body_md: 'Body.',
    window_start: '2026-08-21',
    window_end: '2026-09-18',
    author: 'claude-code',
    expires_at: null,
    created_at: inDays(-2),
    status: 'open',
    disposition: null,
    disposition_note: null,
    snooze_until: null,
    ...over,
  };
}

describe('isKnownRuleId', () => {
  it('accepts a rule the engine can actually produce', () => {
    expect(isKnownRuleId(REAL_RULE)).toBe(true);
  });

  it('accepts a per-aspect rule by prefix', () => {
    expect(isKnownRuleId('goal.underserved.mobility')).toBe(true);
  });

  it('refuses one the engine has never heard of', () => {
    // This is how a model would introduce a rule: write a note about one that
    // does not exist and let the surface render it as though it did.
    expect(isKnownRuleId('training.vibes.too-low')).toBe(false);
  });
});

describe('statesANumber', () => {
  it('rejects a smuggled threshold', () => {
    // The sharp edge of the boundary. This is a measurement nobody computed,
    // sourced or tested, sitting in the same paragraph as numbers that were all
    // three.
    expect(statesANumber('You only get about 8 hard sets a week for legs.')).toBe(true);
    expect(statesANumber('Protein is landing around 1.4 g/kg.')).toBe(true);
  });

  it('allows context that happens to contain a clock time', () => {
    expect(statesANumber('They train at 06:30 before work, so sessions are short.')).toBe(false);
  });

  it('allows a date', () => {
    expect(statesANumber('Since 2026-08-01 the pattern has been different.')).toBe(false);
  });

  it('refuses a proper noun that contains a digit, and says how to rewrite it', () => {
    // Accepted cost, documented on statesANumber: strictness fails safe.
    expect(statesANumber('Their Zone 2 is a bike commute they do not log.')).toBe(true);
    expect(statesANumber('Their easy aerobic work is a bike commute they do not log.')).toBe(false);
  });

  it('allows ordinary prose', () => {
    expect(statesANumber('Their easy riding is a commute they do not log.')).toBe(false);
  });
});

describe('rejectNote', () => {
  it('passes a well-formed context note', () => {
    expect(rejectNote(note(), NOW)).toBeNull();
  });

  it('drops an expired note', () => {
    expect(rejectNote(note({ expires_at: inDays(-1) }), NOW)).toBe('expired');
  });

  it('drops a note about a rule that does not exist', () => {
    expect(rejectNote(note({ rule_id: 'made.up.rule' }), NOW)).toBe('unknown-rule');
  });

  it('drops a note that states a number', () => {
    expect(rejectNote(note({ note: 'They average 3 sessions a week.' }), NOW)).toBe(
      'states-a-number',
    );
  });

  it('drops an empty note', () => {
    expect(rejectNote(note({ note: '   ' }), NOW)).toBe('empty');
  });

  it('drops an edge pointing at itself', () => {
    expect(
      rejectNote(note({ kind: 'edge', related_rule_id: REAL_RULE }), NOW),
    ).toBe('self-edge');
  });

  it('drops an edge pointing at nothing real', () => {
    expect(rejectNote(note({ kind: 'edge', related_rule_id: 'not.a.rule' }), NOW)).toBe(
      'unknown-target',
    );
  });

  it('drops a hedged edge, because an edge only ever makes the coach louder', () => {
    expect(
      rejectNote(
        note({ kind: 'edge', related_rule_id: OTHER_RULE, confidence: MIN_EDGE_CONFIDENCE - 0.01 }),
        NOW,
      ),
    ).toBe('low-confidence');
  });

  it('keeps a confident edge between two real rules', () => {
    expect(
      rejectNote(note({ kind: 'edge', related_rule_id: OTHER_RULE, confidence: 0.9 }), NOW),
    ).toBeNull();
  });
});

describe('governContextNotes', () => {
  it('clamps a note that has grown into an essay', () => {
    const long = note({ note: 'a'.repeat(MAX_NOTE_CHARS + 200) });
    const out = governContextNotes([long], NOW);
    expect(out.get(REAL_RULE)!.text).toHaveLength(MAX_NOTE_CHARS);
  });

  it('keeps the newest note when two survive for one rule', () => {
    const older = note({ note: 'older reading of the context', created_at: inDays(-9) });
    const newer = note({ note: 'newer reading of the context', created_at: inDays(-1) });
    const out = governContextNotes([newer, older], NOW);
    expect(out.get(REAL_RULE)!.text).toBe('newer reading of the context');
  });

  it('never returns an edge as context', () => {
    const edge = note({ kind: 'edge', related_rule_id: OTHER_RULE, confidence: 0.9 });
    expect(governContextNotes([edge], NOW).size).toBe(0);
  });

  it('retroactively disarms a row that a tightened governor now refuses', () => {
    // The reason the check is at READ time and not at write: a row already in
    // the table is judged by today's rules, not by the rules on the day it
    // landed.
    expect(governContextNotes([note({ note: 'Do 5 sets.' })], NOW).size).toBe(0);
  });
});

describe('governEdges', () => {
  const edge = (over: Partial<CoachRuleNote> = {}) =>
    note({ kind: 'edge', related_rule_id: OTHER_RULE, confidence: 0.9, ...over });

  it('reads an edge in both directions', () => {
    // An interaction is a claim about the pair. Reading it one way would make
    // the effect depend on which rule the model happened to name first.
    const out = governEdges([edge()], NOW);
    expect(out.get(REAL_RULE)!.has(OTHER_RULE)).toBe(true);
    expect(out.get(OTHER_RULE)!.has(REAL_RULE)).toBe(true);
  });

  it('drops an edge that fails the governor', () => {
    expect(governEdges([edge({ expires_at: inDays(-1) })], NOW).size).toBe(0);
  });

  it('ignores context notes', () => {
    expect(governEdges([note()], NOW).size).toBe(0);
  });
});

describe('currentBrief', () => {
  it('takes the newest', () => {
    const old = brief({ headline: 'old', created_at: inDays(-20) });
    const now = brief({ headline: 'new', created_at: inDays(-1) });
    expect(currentBrief([old, now], null, NOW)!.headline).toBe('new');
  });

  it('skips an expired one', () => {
    expect(currentBrief([brief({ expires_at: inDays(-1) })], null, NOW)).toBeNull();
  });

  it('keeps whole-picture and themed briefs apart', () => {
    const themed = brief({ theme: 'recovery', headline: 'themed' });
    expect(currentBrief([themed], null, NOW)).toBeNull();
    expect(currentBrief([themed], 'recovery', NOW)!.headline).toBe('themed');
  });

  it('refuses a brief with nothing in it', () => {
    expect(currentBrief([brief({ body_md: '  ' })], null, NOW)).toBeNull();
  });

  it('clears the slot once the athlete has acted, rather than promoting an older brief', () => {
    const old = brief({ headline: 'old', created_at: inDays(-20) });
    const done = brief({ headline: 'new', status: 'acted', disposition: 'acted_modified' });
    expect(currentBrief([old, done], null, NOW)).toBeNull();
  });

  it('hides a snoozed brief until the snooze runs out', () => {
    expect(currentBrief([brief({ status: 'snoozed', snooze_until: inDays(2) })], null, NOW)).toBeNull();
    expect(
      currentBrief([brief({ status: 'snoozed', snooze_until: inDays(-1) })], null, NOW),
    ).not.toBeNull();
  });
});

describe('briefAgeDays', () => {
  it('reports the age the UI has to label', () => {
    expect(briefAgeDays(brief({ created_at: inDays(-3) }), NOW)).toBe(3);
  });

  it('never reports a negative age for a clock skew', () => {
    expect(briefAgeDays(brief({ created_at: inDays(1) }), NOW)).toBe(0);
  });
});
