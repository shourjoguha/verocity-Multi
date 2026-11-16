// A plan a friend sent (docs/SPEC.md §7B). The payload in `shared_items` was
// written by ANOTHER USER, so nothing reads it raw: this is the one door.
// validateParsedPlan is the gate before save and is never bypassed — but it
// assumes the shape ParsedPlan promises, so a hostile payload (days that are
// not an array, an exercise with no plannedByWeek) is checked structurally
// first and any throw inside the validator is a rejection, not a crash.
//
// Pure: no DOM, no queries.

import { validateParsedPlan } from '@/lib/planTemplate';
import { shiftPlanStart } from '@/lib/planRebase';
import { safeHref } from '@/lib/subroutine';
import type { ParsedPlan, SharedPlanPayload } from '@/lib/types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export type SharedPlanRead =
  | { ok: true; value: SharedPlanPayload; dayCount: number }
  | { ok: false; error: string };

export function readSharedPlanPayload(payload: unknown): SharedPlanRead {
  try {
    if (!isObj(payload) || !isObj(payload.parsed)) return { ok: false, error: 'not a plan' };
    const p = payload.parsed;
    if (typeof p.title !== 'string' || !Array.isArray(p.days) || !Array.isArray(p.blocks)) {
      return { ok: false, error: 'not a plan' };
    }
    for (const d of p.days) {
      if (!isObj(d) || !Array.isArray(d.exercises)) return { ok: false, error: 'bad day' };
      for (const e of d.exercises) {
        if (!isObj(e) || !isObj(e.plannedByWeek)) return { ok: false, error: 'bad exercise' };
        // Rendering already goes through safeHref; a javascript: link is refused here too.
        if (typeof e.url === 'string' && e.url.trim() && !safeHref(e.url)) return { ok: false, error: 'unsafe link' };
      }
    }
    const parsed = p as unknown as ParsedPlan;
    const issues = validateParsedPlan(parsed);
    if (issues.length > 0) return { ok: false, error: issues[0] };
    const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    return {
      ok: true,
      dayCount: parsed.days.length,
      value: {
        name: typeof payload.name === 'string' && payload.name.trim() ? payload.name : parsed.title,
        start_date: date(payload.start_date) ?? date(parsed.startDate),
        end_date: date(payload.end_date) ?? date(parsed.endDate),
        parsed,
        source_markdown: typeof payload.source_markdown === 'string' ? payload.source_markdown : null,
      },
    };
  } catch {
    return { ok: false, error: 'not a plan' };
  }
}

/**
 * What Save inserts: the sender's plan on the receiver's start date, validated
 * again after the shift (validateParsedPlan, never bypassed).
 */
export function planToSave(plan: SharedPlanPayload, start: string): { ok: true; parsed: ParsedPlan } | { ok: false; error: string } {
  const parsed = shiftPlanStart(plan.parsed, start);
  const issues = validateParsedPlan(parsed);
  return issues.length > 0 ? { ok: false, error: issues[0] } : { ok: true, parsed };
}
