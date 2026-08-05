// CSV/TSV plan wireframe + AI prompt, derived from app.config so that any
// upgrade to the planning structure or backend updates the template and prompt
// automatically (CLAUDE.md hard rule).

import {
  BLOCKS,
  EQUIPMENT,
  EXPERIENCE_LEVELS,
  GENDERS,
  METRICS,
  PLAN_LENGTH,
  SECTIONS,
  SECTION_ALIASES,
  SUBROUTINE,
  UNITS,
  type BlockKey,
  type MetricKey,
  type SectionKey,
} from '@/app.config';
import type { ParsedPlan, PlanBlock, PlanDay, PlanExercise, UserStats } from '@/lib/types';
import { isSubroutine } from '@/lib/subroutine';
import { renderRubric } from '@/lib/planRubric';
import { ageFrom } from '@/lib/userStats';

export const PLAN_CSV_HEADERS = [
  'kind',
  'id',
  'label',
  'section',
  'metric',
  'week',
  'planned',
  'notes',
] as const;

type Row = Record<(typeof PLAN_CSV_HEADERS)[number], string>;

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function escapeCell(value: string, delimiter: string): string {
  if (value === '') return '';
  if (value.includes(delimiter) || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function joinRows(rows: Row[], delimiter: string): string {
  const lines = [PLAN_CSV_HEADERS.join(delimiter)];
  for (const row of rows) {
    lines.push(PLAN_CSV_HEADERS.map((h) => escapeCell(row[h] ?? '', delimiter)).join(delimiter));
  }
  return lines.join('\n') + '\n';
}

function emptyRow(): Row {
  return { kind: '', id: '', label: '', section: '', metric: '', week: '', planned: '', notes: '' };
}

// A deliberately rich sample that exercises every supported feature: blocks,
// multi-day weekly template, all canonical sections, per-week prescriptions,
// "all weeks" wildcard, and the full metric vocabulary.
function sampleRows(): Row[] {
  const rows: Row[] = [];
  rows.push({ ...emptyRow(), kind: 'META', id: 'title', label: 'Sample 8-Week Block' });
  rows.push({ ...emptyRow(), kind: 'META', id: 'start', label: '2026-06-01' });
  rows.push({ ...emptyRow(), kind: 'META', id: 'weeks', label: '8' });

  rows.push({ ...emptyRow(), kind: 'BLOCK', id: 'accumulation', week: '1-4' });
  rows.push({ ...emptyRow(), kind: 'BLOCK', id: 'intensification', week: '5-7' });
  rows.push({ ...emptyRow(), kind: 'BLOCK', id: 'deload', week: '8-8' });

  rows.push({ ...emptyRow(), kind: 'DAY', id: 'monday-lower', label: 'Monday — Lower' });
  rows.push({
    ...emptyRow(),
    kind: 'EX',
    id: 'monday-lower',
    label: 'Hip Mobility Flow',
    section: 'warmup',
    metric: 'time',
    week: '*',
    planned: '1x300',
    notes: 'seconds, easy pace',
  });
  for (const [w, planned] of [
    [1, '3x5'],
    [2, '3x5'],
    [3, '4x5'],
    [4, '3x3'],
    [5, '5x3'],
    [6, '5x3'],
    [7, '3x2'],
    [8, '2x5'],
  ] as const) {
    rows.push({
      ...emptyRow(),
      kind: 'EX',
      id: 'monday-lower',
      label: 'Back Squat',
      section: 'primary',
      metric: 'weight',
      week: String(w),
      planned,
    });
  }
  rows.push({
    ...emptyRow(),
    kind: 'EX',
    id: 'monday-lower',
    label: 'Romanian Deadlift',
    section: 'secondary',
    metric: 'weight',
    week: '*',
    planned: '3x8',
  });
  rows.push({
    ...emptyRow(),
    kind: 'EX',
    id: 'monday-lower',
    label: 'Leg Press',
    section: 'accessory',
    metric: 'reps',
    week: '*',
    planned: '3x12',
  });

  rows.push({ ...emptyRow(), kind: 'DAY', id: 'thursday-upper', label: 'Thursday — Upper' });
  rows.push({
    ...emptyRow(),
    kind: 'EX',
    id: 'thursday-upper',
    label: 'Bench Press',
    section: 'primary',
    metric: 'weight',
    week: '*',
    planned: '4x5',
  });
  rows.push({
    ...emptyRow(),
    kind: 'EX',
    id: 'thursday-upper',
    label: 'Pull-up',
    section: 'secondary',
    metric: 'reps',
    week: '*',
    planned: '4x6',
  });
  rows.push({
    ...emptyRow(),
    kind: 'EX',
    id: 'thursday-upper',
    label: 'Row Erg Intervals',
    section: 'conditioning',
    metric: 'distance',
    week: '*',
    planned: '6x500',
    notes: 'meters, on 2:00',
  });
  rows.push({
    ...emptyRow(),
    kind: 'EX',
    id: 'thursday-upper',
    label: 'Couch Stretch',
    section: 'cooldown',
    metric: 'time',
    week: '*',
    planned: '2x60',
    notes: 'seconds per side',
  });
  rows.push({
    ...emptyRow(),
    kind: 'SUB',
    id: 'thursday-upper',
    label: 'Box breathing',
    section: 'cooldown',
    notes: '4 counts in, 4 hold, 4 out, 4 hold — repeat for 5 rounds to down-regulate.',
    planned: 'https://example.com/box-breathing',
  });

  return rows;
}

export function buildPlanCsvTemplate(): string {
  return joinRows(sampleRows(), ',');
}

export function buildPlanTsvTemplate(): string {
  return joinRows(sampleRows(), '\t');
}

// ---------- the athlete profile block ----------

/**
 * What the app knows about the person, and — just as load-bearing — what it
 * does not. Absent fields are listed under UNKNOWN so phase 1 of the prompt has
 * an explicit list to interview against; without it a user who has never opened
 * Settings gets a confidently generic plan instead of being asked anything.
 *
 * Goals render by LABEL, not key. GoalsEditor accepts free text, and the rubric
 * keys its rules on wording like "skill work" while the config key is `skill` —
 * labels are what make those line up, and they carry the athlete's own phrasing
 * through to the model intact.
 *
 * `body_type` is deliberately not rendered. app.config.ts refuses it a consumer
 * ("somatotype has no defensible role in load estimation") and routing it into
 * prescription here would quietly overturn that.
 */
function athleteProfileBlock(stats: UserStats | null, today: Date): string {
  if (!stats) {
    return [
      'No profile is on file for this athlete — the app had nothing to send.',
      'Treat EVERY field below as unknown and ask about it in phase 1: age, sex,',
      'bodyweight, injury history, goals and their relative priority, training',
      'experience, days available per week, equipment, and plan length.',
    ].join('\n');
  }

  const known: string[] = [];
  const unknown: string[] = [];

  const age = ageFrom(stats, today);
  if (age != null) known.push(`- Age: ${age}`);
  else unknown.push('age');

  if (stats.gender && stats.gender !== 'unspecified') {
    known.push(`- Sex: ${GENDERS[stats.gender].label.toLowerCase()}`);
  } else unknown.push('sex');

  if (stats.body_weight_kg != null) known.push(`- Bodyweight: ${stats.body_weight_kg} ${UNITS.weight}`);
  else unknown.push('bodyweight');

  if (stats.height_cm != null) known.push(`- Height: ${stats.height_cm} cm`);

  const injuries = (stats.injuries ?? []).filter((i) => i.label.trim() !== '');
  if (injuries.length > 0) {
    const list = injuries
      .map((i) => {
        const meta = [i.region, i.year].filter(Boolean).join(', ');
        return meta ? `${i.label} (${meta})` : i.label;
      })
      .join('; ');
    known.push(`- Past injuries: ${list}`);
  } else {
    known.push('- Past injuries: none recorded');
  }

  const goals = (stats.goals ?? []).filter((g) => g.label.trim() !== '');
  if (goals.length > 0) {
    known.push('- Goals, in priority order, each weighted 0-100:');
    goals.forEach((g, i) => known.push(`    ${i + 1}. ${g.label} (${g.weight})`));
  } else unknown.push('goals and their relative priority');

  if (stats.experience) {
    const e = EXPERIENCE_LEVELS[stats.experience];
    known.push(`- Experience: ${e.label} — ${e.blurb.toLowerCase()}`);
  } else unknown.push('training experience');

  if (stats.days_per_week != null) known.push(`- Training days available per week: ${stats.days_per_week}`);
  else unknown.push('training days available per week');

  const equipment = stats.equipment ?? [];
  if (equipment.length > 0) {
    const labels = equipment.map((k) => EQUIPMENT.find((e) => e.key === k)?.label ?? k);
    known.push(`- Equipment available: ${labels.join(', ')}`);
  } else unknown.push('equipment available');

  if (stats.preferred_plan_weeks != null) {
    known.push(`- Preferred plan length: ${stats.preferred_plan_weeks} weeks`);
  } else unknown.push('plan length');

  const lines = known.length > 0 ? known : ['- Nothing on file.'];
  if (unknown.length > 0) {
    lines.push('', `UNKNOWN — ask the athlete in phase 1: ${unknown.join(', ')}.`);
  }
  return lines.join('\n');
}

export interface PlanPromptContext {
  stats: UserStats | null;
  /** Injectable for tests; age is derived from `birth_year` at render time. */
  today?: Date;
}

/**
 * AI prompt — derived from app.config so it stays in sync with the domain, and
 * from the caller's `user_stats` row so it is about a person rather than an
 * abstraction.
 *
 * Synchronous, with a null-profile default, on purpose: the caller fetches. That
 * keeps every existing call site compiling, keeps the showcase safe for free
 * (`getUserStats` returns null for the anon client, which lands on the
 * no-profile branch), and keeps this a pure function the tests can pin.
 */
export function buildPlanAiPrompt(ctx: PlanPromptContext = { stats: null }): string {
  const sectionList = (SECTIONS as readonly string[]).join(', ');
  const metricEntries = Object.entries(METRICS)
    .map(([k, v]) => `${k} (${v.label}${v.unit ? `, ${v.unit}` : ''})`)
    .join(', ');
  const blockList = (Object.keys(BLOCKS) as BlockKey[]).join(', ');
  const aliasList = Object.entries(SECTION_ALIASES)
    .map(([from, to]) => `"${from}" → ${to}`)
    .join('; ');

  return `You are the strength & conditioning coach writing a training plan for one
athlete, which will be imported into the Verocity app.

THIS IS A TWO-PHASE TASK. DO NOT SKIP PHASE 1. Phase 1 is a conversation; phase
2 is a file. Producing the file before the athlete has confirmed the plan is a
failed response, even if the file is perfectly formatted.

=== ATHLETE PROFILE (supplied by the app) ===
${athleteProfileBlock(ctx.stats, ctx.today ?? new Date())}
=== END ATHLETE PROFILE ===

PHASE 1 — PROPOSE, THEN CONFIRM (prose; no CSV)
1. Read the ATHLETE PROFILE against the PRESCRIPTION RUBRIC below and propose a
   plan composition: how many training days, the split, which blocks and their
   week ranges, the emphasis per section, and the rep and intensity ranges you
   intend. Say briefly WHY each choice follows from the profile.
2. Ask the athlete to confirm the plan length. It must be between
   ${PLAN_LENGTH.minWeeks} and ${PLAN_LENGTH.maxWeeks} weeks${
     ctx.stats?.preferred_plan_weeks != null
       ? `; propose their stored preference of ${ctx.stats.preferred_plan_weeks} weeks as the default`
       : `; propose ${PLAN_LENGTH.defaultWeeks} weeks as the default`
   }.
3. Ask about everything listed as UNKNOWN in the profile, plus anything else you
   genuinely need — schedule constraints, equipment gaps, current working
   weights, whether any date has to land on a specific week.
4. Ask whether there are any **preferred movements** the athlete wants included
   (favourites they train for their own sake, or lifts they want to peak) and
   any **movements to avoid** beyond what the profile's injuries already imply
   (personal dislikes, gym-etiquette constraints, prior bad experiences). Make
   it explicit that "none" is a fine answer — this is not a required field.
   Preferred movements go into \`primary\`/\`secondary\` where the rubric's rep
   ranges for the top goal allow it; avoided movements are treated the same as
   an injury contraindication — substitute from the equipment ladder, keep the
   goal's intent, and note the substitution.
5. Keep it to at most 6 numbered questions in a single message. Do not
   interrogate one question at a time.
6. STOP and wait for the athlete's reply. Revise the proposal and ask again if
   anything is still open. Continue only when they have confirmed.
7. Emit no CSV during phase 1 — not as a preview, not as an example.

PHASE 2 — EMIT THE CSV
Once the athlete has confirmed, output the plan as a CSV and NOTHING else: no
preamble, no explanation, no markdown code fences, nothing before the header row
and nothing after the last data row. If you want to comment on the plan, do it
in phase 1 before you send the file.

OUTPUT FORMAT
- A single CSV file. The first row must be exactly:
  ${PLAN_CSV_HEADERS.join(',')}
- One row per record. Allowed values for the first column ("kind"):
  META, BLOCK, DAY, EX, SUB.
- Cells that contain commas, quotes, or newlines must be wrapped in double
  quotes; embedded quotes are doubled ("").
- Leave unused columns empty. Do not invent new columns.

ROW SHAPES
- META: id ∈ {title, start, weeks, end}; label = the value.
    • start/end are ISO dates (YYYY-MM-DD). weeks is a positive integer.
- BLOCK: id ∈ {${blockList}}; week is a range "S-E" (1-based, inclusive).
    • Blocks must tile weeks 1..META.weeks: no gaps, no overlaps.
    • A block type MAY repeat — "deload 5-5" and "deload 10-10" in one plan is
      normal and is what the rubric's longer structures prescribe. One row per
      occurrence.
- DAY: id = a short slug (lowercase, dashes); label = human title.
    • Each EX row refers to a DAY by its slug. Day order = weekly template order.
- EX: id = the day slug; label = movement name; section ∈ {${sectionList}};
       metric ∈ {${Object.keys(METRICS).join(', ')}}; week is "1".."N" or "*";
       planned is a set spec like "3x5", "4x8", "5x3 @70%", "1x300";
       notes is free text (units, tempo, cues).
    • Use "*" for the week column when every week uses the same prescription.
    • Use multiple rows for per-week variation (one row per week).
- SUB: a subroutine — a free-text block (protocol, instructions, a link) that
       sits among the movements. id = the day slug; label = a short title;
       section ∈ {${sectionList}}; notes = the description (≤${SUBROUTINE.maxDescriptionChars} chars);
       planned = an optional URL. Leave metric and week empty.

DOMAIN VOCABULARY (single source of truth — app.config.ts)
- Units: weight in ${UNITS.weight}.
- Metrics: ${metricEntries}.
- Sections (canonical order in the logger): ${sectionList}.
- Section aliases (you may use these in notes but normalize to canonical in the
  section column): ${aliasList}.
- Block types: ${blockList}.

INVARIANTS THE APP WILL CHECK ON UPLOAD
1. Header row matches exactly: ${PLAN_CSV_HEADERS.join(',')}.
2. At least one DAY row.
3. Every EX row's id matches a DAY id.
4. section ∈ {${sectionList}} and metric ∈ {${Object.keys(METRICS).join(', ')}}.
5. Each week value is either "*" or an integer in 1..weeks (META.weeks).
6. Every EX has at least one planned cell across its week rows.
7. BLOCK weeks fall within 1..weeks and do not overlap.
8. Every SUB has a title (label) and a description (notes) ≤${SUBROUTINE.maxDescriptionChars} chars.

NOTES ON CURRENT CAPABILITY
- Supersets and circuits are configured by the user in the logger after the
  plan is loaded; the plan format itself stores each exercise as a single
  movement. List supersetted lifts as adjacent EX rows in the same section and
  mention the intent in the notes column ("superset with next").
- Plan length is implicit from META.weeks plus per-week EX rows.

PRESCRIPTION RUBRIC
Conditional programming policy. Apply the rules whose conditions the ATHLETE
PROFILE satisfies, and ignore the rest. Where a rule needs a fact the profile
does not have, ask for it in phase 1 rather than guessing.

${renderRubric()}

SELF-CHECK BEFORE YOU SEND (phase 2 only)
Re-read your finished CSV line by line and confirm every item. This is the whole
ballgame: a file that fails any of these is rejected by the importer and the
athlete gets nothing.
[ ] The first line is exactly: ${PLAN_CSV_HEADERS.join(',')}
[ ] Nothing precedes the header row and nothing follows the last data row — no
    prose, no "Here is your plan", no \`\`\` fences anywhere in the response.
[ ] Every row has exactly ${PLAN_CSV_HEADERS.length} fields. Any cell containing a comma is quoted.
[ ] Every row's first column is one of META, BLOCK, DAY, EX, SUB.
[ ] META rows include title and weeks; weeks is a positive integer.
[ ] Every EX and SUB id exactly matches the id of a DAY row you wrote — same
    spelling, same dashes, no capitals.
[ ] Every EX section is one of {${sectionList}} and every EX metric is one of
    {${Object.keys(METRICS).join(', ')}}. No invented values.
[ ] Every EX week is "*" or an integer from 1 to META.weeks. No "1-4" ranges in
    an EX row — ranges belong to BLOCK rows only.
[ ] Every EX has a non-empty planned cell.
[ ] BLOCK rows tile 1..META.weeks with no gaps and no overlaps.
[ ] Every SUB has a label and a notes description of ≤${SUBROUTINE.maxDescriptionChars} characters.
If any check fails, fix it and run the list again. Do not send a CSV that fails
a check.

WORKED EXAMPLE
A complete, valid file that exercises every feature above. Match its shape — not
its content.

${buildPlanCsvTemplate()}`;
}

/**
 * The repair prompt: what the athlete pastes back when the importer rejects the
 * generated CSV.
 *
 * Closes the loop the compatibility checker opens. Without it the user is
 * relaying validator errors by hand into a chat where the original prompt may
 * have scrolled out of context, which is why the format rules are restated here
 * rather than assumed.
 */
export function buildPlanFixPrompt(issues: string[], csvText: string): string {
  const numbered = issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n');
  const echo = csvText.trim()
    ? `\n\nTHE CSV YOU SENT\n${csvText.trim()}`
    : '\n\n(The file was uploaded as a spreadsheet, so it is not repeated here — ' +
      'correct the version you produced.)';

  return `The CSV you produced was rejected by the Verocity importer. It reported these
issues:

${numbered}

Fix exactly these issues and re-send the COMPLETE corrected CSV. Do not send a
patch, a diff, or only the changed rows — send the whole file.

The rules that matter here, restated so you do not have to scroll back:
- First row exactly: ${PLAN_CSV_HEADERS.join(',')}
- First column is one of: META, BLOCK, DAY, EX, SUB.
- Allowed sections: ${(SECTIONS as readonly string[]).join(', ')}.
- Allowed metrics: ${Object.keys(METRICS).join(', ')}.
- Allowed block types: ${(Object.keys(BLOCKS) as BlockKey[]).join(', ')}; BLOCK week is a
  range "S-E", and blocks must tile 1..META.weeks without gaps or overlaps.
- Every EX/SUB id must match a DAY id you declared.
- EX week is "*" or a single integer in 1..META.weeks — never a range.
- Subroutine descriptions are ≤${SUBROUTINE.maxDescriptionChars} characters.
- Cells containing commas or quotes are double-quoted; embedded quotes doubled.

Output ONLY the corrected CSV: no prose, no explanation, no markdown fences.${echo}`;
}

// ---------- parser ----------

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

function detectDelimiter(text: string): ',' | '\t' {
  const firstLine = text.split('\n', 1)[0] ?? '';
  return firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
}

export interface PlanParseResult {
  plan: ParsedPlan;
  issues: string[];
}

/**
 * Drop the wrapper an LLM tends to put around a CSV: ``` fences, and any prose
 * before the header row ("Here is your plan:").
 *
 * `parsePlanWorkbook` already scans for the header anywhere in the sheet, but
 * the text path demanded line 0 — so a single ```csv fence rejected a file
 * whose every row was valid, and the user paid a round trip for it. The prompt
 * tells the model not to fence; this is what happens when it does anyway.
 *
 * Deliberately narrow: it removes fence lines and preamble and guesses at
 * nothing else. No fuzzy section/metric matching, no header reordering. A file
 * with no canonical header is returned untouched, so it still reports the same
 * "Header row must be exactly" error against its own first line. Trailing prose
 * after the data still surfaces as `unknown kind`, because a line that might be
 * a mistyped row must not be silently discarded.
 */
function stripLlmWrapper(text: string): string[] {
  return text.split(/\r?\n/).filter((l) => l.trim() !== '' && !/^\s*```/.test(l));
}

function dropPreamble(lines: string[], delimiter: string): string[] {
  const expected = PLAN_CSV_HEADERS.map((h) => h.toLowerCase());
  const headerAt = lines.findIndex((l) => {
    const cells = splitCsvLine(l, delimiter).map((c) => c.trim().toLowerCase());
    return expected.every((h, i) => cells[i] === h);
  });
  return headerAt > 0 ? lines.slice(headerAt) : lines;
}

export function parsePlanTabular(text: string): PlanParseResult {
  const issues: string[] = [];
  // Fences come off BEFORE the delimiter sniff: `detectDelimiter` reads the
  // first line, and a ```csv fence there would make a tab-delimited file look
  // comma-delimited.
  const stripped = stripLlmWrapper(text);
  if (stripped.length === 0) {
    return { plan: emptyPlan(), issues: ['File is empty.'] };
  }
  const delimiter = detectDelimiter(stripped.join('\n'));
  const rawLines = dropPreamble(stripped, delimiter);

  const header = splitCsvLine(rawLines[0], delimiter).map((c) => c.trim().toLowerCase());
  const expected = PLAN_CSV_HEADERS.map((h) => h.toLowerCase());
  if (header.join(',') !== expected.join(',')) {
    issues.push(
      `Header row must be exactly: ${PLAN_CSV_HEADERS.join(',')} (got: ${header.join(',')})`,
    );
  }

  const idx = (name: (typeof PLAN_CSV_HEADERS)[number]) => expected.indexOf(name);

  let title = 'Untitled Plan';
  let startDate: string | null = null;
  let endDate: string | null = null;
  let weekCount: number | null = null;
  const blocks: PlanBlock[] = [];
  const daysByKey = new Map<string, { label: string; order: number; exercises: PlanExercise[] }>();
  const dayOrder: string[] = [];
  // (dayKey,label,section,metric) → exercise reference, so multiple week rows
  // accumulate into a single PlanExercise.
  const exKey = new Map<string, PlanExercise>();

  for (let r = 1; r < rawLines.length; r++) {
    const cells = splitCsvLine(rawLines[r], delimiter).map((c) => c.trim());
    const get = (h: (typeof PLAN_CSV_HEADERS)[number]) => cells[idx(h)] ?? '';
    const kind = get('kind').toUpperCase();
    if (!kind) continue;

    if (kind === 'META') {
      const k = get('id').toLowerCase();
      const v = get('label');
      if (k === 'title') title = v || title;
      else if (k === 'start') startDate = v || null;
      else if (k === 'end') endDate = v || null;
      else if (k === 'weeks') {
        const n = parseInt(v, 10);
        weekCount = Number.isFinite(n) && n > 0 ? n : null;
        if (!weekCount) issues.push(`Row ${r + 1}: META.weeks must be a positive integer.`);
      } else {
        issues.push(`Row ${r + 1}: unknown META id "${k}".`);
      }
      continue;
    }

    if (kind === 'BLOCK') {
      const type = get('id').toLowerCase();
      if (!(type in BLOCKS)) {
        issues.push(`Row ${r + 1}: unknown block "${type}". Allowed: ${Object.keys(BLOCKS).join(', ')}.`);
        continue;
      }
      const range = get('week').match(/^(\d+)\s*-\s*(\d+)$/);
      if (!range) {
        issues.push(`Row ${r + 1}: BLOCK week must be a range like "1-4".`);
        continue;
      }
      blocks.push({
        type: type as BlockKey,
        startWeek: parseInt(range[1], 10),
        endWeek: parseInt(range[2], 10),
      });
      continue;
    }

    if (kind === 'DAY') {
      const id = get('id') || slug(get('label'));
      if (!id) {
        issues.push(`Row ${r + 1}: DAY needs an id (slug).`);
        continue;
      }
      if (!daysByKey.has(id)) {
        daysByKey.set(id, { label: get('label') || id, order: dayOrder.length, exercises: [] });
        dayOrder.push(id);
      }
      continue;
    }

    if (kind === 'SUB') {
      const dayKey = get('id');
      const title = get('label');
      const section = get('section').toLowerCase();
      const description = get('notes');
      const url = get('planned');

      if (!dayKey) {
        issues.push(`Row ${r + 1}: SUB missing day id.`);
        continue;
      }
      if (!daysByKey.has(dayKey)) {
        daysByKey.set(dayKey, { label: dayKey, order: dayOrder.length, exercises: [] });
        dayOrder.push(dayKey);
        issues.push(`Row ${r + 1}: SUB refers to undeclared day "${dayKey}" (auto-created).`);
      }
      if (!title) {
        issues.push(`Row ${r + 1}: SUB missing title (label).`);
        continue;
      }
      if (!(SECTIONS as readonly string[]).includes(section)) {
        issues.push(
          `Row ${r + 1}: section "${section}" not in {${(SECTIONS as readonly string[]).join(', ')}}.`,
        );
        continue;
      }
      daysByKey.get(dayKey)!.exercises.push({
        kind: 'subroutine',
        movement: title,
        section: section as SectionKey,
        primaryMetric: 'reps',
        plannedByWeek: {},
        description,
        ...(url ? { url } : {}),
      });
      continue;
    }

    if (kind === 'EX') {
      const dayKey = get('id');
      const movement = get('label');
      const section = get('section').toLowerCase();
      const metric = get('metric').toLowerCase() || 'weight';
      const weekCell = get('week') || '*';
      const planned = get('planned');
      const notes = get('notes');

      if (!dayKey) {
        issues.push(`Row ${r + 1}: EX missing day id.`);
        continue;
      }
      if (!daysByKey.has(dayKey)) {
        // Auto-create so the row isn't lost; flag as a soft issue.
        daysByKey.set(dayKey, { label: dayKey, order: dayOrder.length, exercises: [] });
        dayOrder.push(dayKey);
        issues.push(`Row ${r + 1}: EX refers to undeclared day "${dayKey}" (auto-created).`);
      }
      if (!movement) {
        issues.push(`Row ${r + 1}: EX missing movement (label).`);
        continue;
      }
      if (!(SECTIONS as readonly string[]).includes(section)) {
        issues.push(
          `Row ${r + 1}: section "${section}" not in {${(SECTIONS as readonly string[]).join(', ')}}.`,
        );
        continue;
      }
      if (!(metric in METRICS)) {
        issues.push(
          `Row ${r + 1}: metric "${metric}" not in {${Object.keys(METRICS).join(', ')}}.`,
        );
        continue;
      }

      const key = `${dayKey} ${movement} ${section} ${metric}`;
      let ex = exKey.get(key);
      if (!ex) {
        ex = {
          movement,
          section: section as SectionKey,
          primaryMetric: metric as MetricKey,
          plannedByWeek: {},
          ...(notes ? { notes } : {}),
        };
        exKey.set(key, ex);
        daysByKey.get(dayKey)!.exercises.push(ex);
      } else if (notes && !ex.notes) {
        ex.notes = notes;
      }

      if (weekCell === '*') {
        ex.plannedByWeek[0] = planned; // sentinel for "all weeks", expanded below
      } else {
        const w = parseInt(weekCell, 10);
        if (!Number.isFinite(w) || w < 1) {
          issues.push(`Row ${r + 1}: week "${weekCell}" must be "*" or a positive integer.`);
          continue;
        }
        ex.plannedByWeek[w] = planned;
      }
      continue;
    }

    issues.push(`Row ${r + 1}: unknown kind "${kind}". Allowed: META, BLOCK, DAY, EX, SUB.`);
  }

  const maxBlockEnd = blocks.reduce((m, b) => Math.max(m, b.endWeek), 1);
  const maxExplicit = [...exKey.values()].reduce(
    (m, ex) => Math.max(m, ...Object.keys(ex.plannedByWeek).map(Number).filter((n) => n > 0), 1),
    1,
  );
  const maxWeek = weekCount ?? Math.max(maxBlockEnd, maxExplicit, 1);

  // Expand "*" sentinel to every week, but don't overwrite explicit per-week values.
  for (const ex of exKey.values()) {
    const allValue = ex.plannedByWeek[0];
    if (allValue !== undefined) {
      for (let w = 1; w <= maxWeek; w++) {
        if (ex.plannedByWeek[w] === undefined) ex.plannedByWeek[w] = allValue;
      }
      delete ex.plannedByWeek[0];
    }
  }

  if (startDate && weekCount && !endDate) {
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + weekCount * 7 - 1);
    endDate = d.toISOString().slice(0, 10);
  }

  const days: PlanDay[] = dayOrder.map((k) => ({
    dayKey: k,
    label: daysByKey.get(k)!.label,
    exercises: daysByKey.get(k)!.exercises,
  }));

  const plan: ParsedPlan = {
    title,
    startDate,
    endDate,
    blocks,
    weeklyTemplate: dayOrder,
    days,
  };

  issues.push(...validateParsedPlan(plan, { maxWeek }));
  return { plan, issues };
}

// Convert a single cell value coming from an Excel reader into a string the
// CSV parser understands. ExcelJS yields Date for date cells, number for
// numerics, and rich-text objects for styled strings.
function cellToString(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const obj = v as { text?: unknown; richText?: { text?: unknown }[]; result?: unknown };
    if (typeof obj.text === 'string') return obj.text;
    if (Array.isArray(obj.richText)) return obj.richText.map((p) => String(p.text ?? '')).join('');
    if (obj.result != null) return cellToString(obj.result);
  }
  return String(v);
}

// Read an .xlsx workbook buffer, locate the header row anywhere in the first
// sheet, and feed the resulting rows through the CSV parser so that all
// validation lives in one place.
export async function parsePlanWorkbook(buffer: ArrayBuffer): Promise<PlanParseResult> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return { plan: emptyPlan(), issues: ['Workbook has no sheets.'] };

  const expectedLower = PLAN_CSV_HEADERS.map((h) => h.toLowerCase());
  const csvRows: string[] = [];
  let headerRow = -1;

  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    const cells = values.map(cellToString).map((s) => s.trim());
    if (headerRow === -1) {
      const lower = cells.map((c) => c.toLowerCase());
      const match = expectedLower.every((h, i) => lower[i] === h);
      if (match) {
        headerRow = r;
        csvRows.push(PLAN_CSV_HEADERS.join(','));
      }
      continue;
    }
    if (cells.every((c) => c === '')) continue;
    const padded = PLAN_CSV_HEADERS.map((_, i) => cells[i] ?? '');
    csvRows.push(padded.map((c) => escapeCell(c, ',')).join(','));
  }

  if (headerRow === -1) {
    return {
      plan: emptyPlan(),
      issues: [
        `Could not find header row "${PLAN_CSV_HEADERS.join(',')}" in the first sheet.`,
      ],
    };
  }

  return parsePlanTabular(csvRows.join('\n') + '\n');
}

function emptyPlan(): ParsedPlan {
  return {
    title: 'Untitled Plan',
    startDate: null,
    endDate: null,
    blocks: [],
    weeklyTemplate: [],
    days: [],
  };
}

// Validation catches mismatches against the ParsedPlan contract — used both by
// the tabular parser and as a final safety check before save (markdown or CSV).
export function validateParsedPlan(
  plan: ParsedPlan,
  opts: { maxWeek?: number } = {},
): string[] {
  const issues: string[] = [];
  if (!plan.title || !plan.title.trim()) issues.push('Plan title is required.');
  if (plan.days.length === 0) issues.push('Plan needs at least one day.');

  const maxWeek =
    opts.maxWeek ??
    Math.max(
      1,
      ...plan.blocks.map((b) => b.endWeek),
      ...plan.days.flatMap((d) =>
        d.exercises.flatMap((e) => Object.keys(e.plannedByWeek).map(Number)),
      ),
    );

  const seenDayKeys = new Set<string>();
  for (const day of plan.days) {
    if (!day.dayKey) issues.push(`Day "${day.label}" is missing a dayKey.`);
    if (seenDayKeys.has(day.dayKey)) issues.push(`Duplicate day key "${day.dayKey}".`);
    seenDayKeys.add(day.dayKey);
    if (day.exercises.length === 0) issues.push(`Day "${day.label}" has no exercises.`);
    for (const ex of day.exercises) {
      if (!(SECTIONS as readonly string[]).includes(ex.section)) {
        issues.push(`"${ex.movement}" has unknown section "${ex.section}".`);
      }
      if (isSubroutine(ex)) {
        // Subroutines carry text, not sets: title + a capped description, no
        // metric/weeks.
        if (!ex.movement) issues.push(`Day "${day.label}" has a subroutine with no title.`);
        if (!ex.description || !ex.description.trim()) {
          issues.push(`Subroutine "${ex.movement}" needs a description.`);
        } else if (ex.description.length > SUBROUTINE.maxDescriptionChars) {
          issues.push(
            `Subroutine "${ex.movement}" description exceeds ${SUBROUTINE.maxDescriptionChars} characters.`,
          );
        }
        continue;
      }
      if (!ex.movement) issues.push(`Day "${day.label}" has an exercise with no movement.`);
      if (!(ex.primaryMetric in METRICS)) {
        issues.push(`"${ex.movement}" has unknown metric "${ex.primaryMetric}".`);
      }
      const weeks = Object.keys(ex.plannedByWeek).map(Number);
      if (weeks.length === 0) issues.push(`"${ex.movement}" has no planned sets.`);
      for (const w of weeks) {
        if (w < 1 || w > maxWeek) {
          issues.push(`"${ex.movement}" has week ${w} outside 1..${maxWeek}.`);
        }
      }
    }
  }

  // Block coverage: must lie within plan, must not overlap.
  const sorted = [...plan.blocks].sort((a, b) => a.startWeek - b.startWeek);
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    if (b.startWeek < 1 || b.endWeek > maxWeek || b.startWeek > b.endWeek) {
      issues.push(`Block "${b.type}" range ${b.startWeek}-${b.endWeek} is invalid (1..${maxWeek}).`);
    }
    if (i > 0 && b.startWeek <= sorted[i - 1].endWeek) {
      issues.push(`Block "${b.type}" overlaps "${sorted[i - 1].type}".`);
    }
  }

  return issues;
}
