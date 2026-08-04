// The strength & conditioning policy embedded in the plan-authoring prompt.
//
// THE CONTENT IS NOT HERE. It is docs/PLAN_RUBRIC.md, imported raw, because a
// second hand-maintained copy of ~90 prescription rules is a drift trap: the
// two would answer the same question differently within a month and nothing
// would catch it. docs/PLAN_RUBRIC_PROMPT.md records the prompt that generated
// the document and says to regenerate it wholesale rather than patch it, so
// this module deliberately owns the *shape* and none of the domain content.
//
// `?raw` follows the precedent in src/pages/sw.js.ts + src/sw.test.ts.
//
// The parse exists to give the markdown a test surface — a heading that lost
// its bullets, or a rule that lost its text, fails planRubric.test.ts instead
// of silently shipping a hole in the prompt. It is not a decision engine: the
// rules stay prose because the model does the reasoning, and this only supplies
// the policy it reasons with.
import RUBRIC_MD from '../../docs/PLAN_RUBRIC.md?raw';

export interface RubricSection {
  heading: string;
  rules: string[];
}

function parseRubric(md: string): RubricSection[] {
  const sections: RubricSection[] = [];
  for (const line of md.split('\n')) {
    const heading = /^##\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      sections.push({ heading: heading[1], rules: [] });
      continue;
    }
    const rule = /^-\s+(.*\S)\s*$/.exec(line);
    // A bullet before any heading is malformed markdown, not a rule — drop it
    // and let the test that asserts every section is populated do the shouting.
    if (rule && sections.length > 0) sections[sections.length - 1].rules.push(rule[1]);
  }
  return sections;
}

export const PLAN_RUBRIC: RubricSection[] = parseRubric(RUBRIC_MD);

/**
 * The rubric as prompt text: each heading, then its rules as `- ` bullets.
 *
 * Headings keep their `##` markers. They sit inside a much larger prompt, and a
 * bare heading line reads as another bullet once the surrounding sections are
 * pasted around it.
 */
export function renderRubric(): string {
  return PLAN_RUBRIC.map(
    (s) => `## ${s.heading}\n${s.rules.map((r) => `- ${r}`).join('\n')}`,
  ).join('\n\n');
}
