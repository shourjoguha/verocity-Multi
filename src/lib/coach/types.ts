// Shapes the deterministic coach passes between its three stages:
//
//   logs + meals + stats  →  Signals  →  Finding[]  →  RecInput[]
//        (raw rows)         measure      rules         persist
//
// The split exists so the rules are pure predicates over already-measured
// numbers. A rule that walks a LogDocument itself is a rule whose threshold and
// whose measurement can drift apart, and the measurement is the half that is
// hard to test.

import type { Claim } from '@/lib/coach/knowledge';

/**
 * Whether a signal is measured well enough to be reasoned from.
 *
 * This is the radar's discipline applied to rules. lib/aspects.ts reports an
 * axis UNSCORED below ASPECT_MIN_BASELINE samples rather than scoring it against
 * an invented reference; a rule that fires on two data points is the same error
 * wearing a citation. Every signal therefore carries its own sample count and
 * its own sufficiency floor, and `evaluate` skips any rule whose inputs are
 * `insufficient` — silently, because "we don't know yet" is not a finding.
 *
 * `partial` means the rule may speak but must say so: the finding is emitted
 * with reduced confidence and the shortfall named in the body.
 */
export type Sufficiency = 'insufficient' | 'partial' | 'ok';

export interface Measured<T> {
  value: T;
  /** How many independent observations produced `value`. */
  samples: number;
  sufficiency: Sufficiency;
  /** Why it is short, when it is. Rendered to the athlete, so plain language. */
  shortfall?: string;
}

/**
 * A rule's output, before it becomes a database row.
 *
 * `ruleId` is the stable identity that makes check-ins idempotent — the same
 * condition on the same period must produce the same id forever. It is a
 * dotted slug (`goal.underserved.endurance`), never generated, never
 * interpolated from a value that moves week to week.
 *
 * `periodKey` scopes the finding in time so a rule CAN speak again next week
 * without duplicating itself this week. Weekly for most rules ('2026-W34');
 * rules that reason over a longer window use their window end.
 */
export interface Finding {
  ruleId: string;
  periodKey: string;
  /** ≤60 chars — CoachView renders this as the row headline. */
  tldr: string;
  /** One concrete next step. */
  action: string;
  /** 2–4 sentences of reasoning, in the athlete's own numbers. */
  body: string;
  /**
   * How far the observation sits from the cited threshold, 0..1. NOT a severity
   * ranking and not a confidence — a large drift on a thin sample is still a
   * weak finding, which is what `confidence` is for.
   */
  drift: number;
  confidence: number;
  /**
   * How well-measured the inputs were. Carried onto the row so a finding built
   * on a thin window can be labelled as such months later, rather than reading
   * with the same authority as a settled one — the same distinction the radar
   * draws with its hollow vertices.
   */
  sufficiency: Sufficiency;
  /** The claims this finding rests on. Empty is legal only for data-quality findings. */
  claims: Claim<unknown>[];
  /** The measured numbers behind it, for the evidence payload. */
  observed: Record<string, number | string | null>;
}

/**
 * What lands in `recommendations.evidence`. Deliberately stores the RESOLVED
 * claim rather than only its id: a row written under pack 2026.08.1 must still
 * render its own reasoning after the pack has moved on and the threshold has
 * changed. An id alone would silently re-point at the new number.
 */
export interface EvidencePayload {
  packVersion: string;
  claims: {
    id: string;
    statement: string;
    value: unknown;
    unit: string;
    quote: string;
    caveat?: string;
    speaker: string;
    work: string;
    url: string;
  }[];
  observed: Record<string, number | string | null>;
  sufficiency: Sufficiency;
}
