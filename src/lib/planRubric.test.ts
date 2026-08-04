import { describe, expect, it } from 'vitest';
import { BLOCKS, METRICS, SECTIONS } from '@/app.config';
import { PLAN_RUBRIC, renderRubric } from '@/lib/planRubric';

describe('planRubric', () => {
  it('parses every section out of the markdown', () => {
    expect(PLAN_RUBRIC.length).toBeGreaterThanOrEqual(10);
    for (const s of PLAN_RUBRIC) {
      expect(s.heading).not.toBe('');
      expect(s.rules.length).toBeGreaterThan(0);
      for (const r of s.rules) expect(r.trim()).not.toBe('');
    }
  });

  it('covers the eleven topics the prompt relies on', () => {
    const headings = PLAN_RUBRIC.map((s) => s.heading).join('\n');
    for (const topic of [
      'Goal weighting',
      'Goal mix',
      'Experience level',
      'Age',
      'Sex',
      'Injury history',
      'Equipment',
      'Training days per week',
      'Plan length',
      'Conflict resolution',
      'What to ask the athlete',
    ]) {
      expect(headings).toContain(topic);
    }
  });

  // The rubric is written in the plan schema's own vocabulary so nothing needs
  // translating between the rules and the importer. If a SECTIONS, BLOCKS or
  // METRICS key is renamed, the rules go stale silently — this is what notices.
  //
  // Whole-word and case-insensitive rather than looking for `key` in backticks:
  // the rubric legitimately writes `intensification 4-5` with the week range
  // inside the ticks, and says "RPE 7–9" in prose where the metric key is `rpe`.
  // Requiring bare backticks would fail on correct text.
  it('speaks the domain vocabulary', () => {
    const text = renderRubric();
    const names = [...SECTIONS, ...Object.keys(BLOCKS), ...Object.keys(METRICS)];
    for (const name of names) {
      expect(new RegExp(`\\b${name}\\b`, 'i').test(text), `rubric never mentions "${name}"`).toBe(
        true,
      );
    }
  });

  it('renders headings and bullets', () => {
    const text = renderRubric();
    expect(text).toContain('## Goal weighting → intensity and rep ranges');
    expect(text).toContain('\n- If ');
    expect(text).not.toContain('undefined');
  });
});
