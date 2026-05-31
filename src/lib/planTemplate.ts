// CSV/TSV plan wireframe + AI prompt, derived from app.config so that any
// upgrade to the planning structure or backend updates the template and prompt
// automatically (CLAUDE.md hard rule).

import {
  BLOCKS,
  METRICS,
  SECTIONS,
  SECTION_ALIASES,
  UNITS,
  type BlockKey,
  type MetricKey,
  type SectionKey,
} from '@/app.config';
import type { ParsedPlan, PlanBlock, PlanDay, PlanExercise } from '@/lib/types';

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

  return rows;
}

export function buildPlanCsvTemplate(): string {
  return joinRows(sampleRows(), ',');
}

export function buildPlanTsvTemplate(): string {
  return joinRows(sampleRows(), '\t');
}

// AI prompt — derived from app.config so it stays in sync with the domain.
export function buildPlanAiPrompt(): string {
  const sectionList = (SECTIONS as readonly string[]).join(', ');
  const metricEntries = Object.entries(METRICS)
    .map(([k, v]) => `${k} (${v.label}${v.unit ? `, ${v.unit}` : ''})`)
    .join(', ');
  const blockList = (Object.keys(BLOCKS) as BlockKey[]).join(', ');
  const aliasList = Object.entries(SECTION_ALIASES)
    .map(([from, to]) => `"${from}" → ${to}`)
    .join('; ');

  return `You are generating a strength/training plan for the Verocity app.

OUTPUT FORMAT
- A single CSV file. The first row must be exactly:
  ${PLAN_CSV_HEADERS.join(',')}
- One row per record. Allowed values for the first column ("kind"):
  META, BLOCK, DAY, EX.
- Cells that contain commas, quotes, or newlines must be wrapped in double
  quotes; embedded quotes are doubled ("").
- Leave unused columns empty. Do not invent new columns.

ROW SHAPES
- META: id ∈ {title, start, weeks, end}; label = the value.
    • start/end are ISO dates (YYYY-MM-DD). weeks is a positive integer.
- BLOCK: id ∈ {${blockList}}; week is a range "S-E" (1-based, inclusive).
    • Blocks should cover the plan contiguously and not overlap.
- DAY: id = a short slug (lowercase, dashes); label = human title.
    • Each EX row refers to a DAY by its slug. Day order = weekly template order.
- EX: id = the day slug; label = movement name; section ∈ {${sectionList}};
       metric ∈ {${Object.keys(METRICS).join(', ')}}; week is "1".."N" or "*";
       planned is a set spec like "3x5", "4x8", "5x3 @70%", "1x300";
       notes is free text (units, tempo, cues).
    • Use "*" for the week column when every week uses the same prescription.
    • Use multiple rows for per-week variation (one row per week).

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

NOTES ON CURRENT CAPABILITY
- Supersets and circuits are configured by the user in the logger after the
  plan is loaded; the plan format itself stores each exercise as a single
  movement. List supersetted lifts as adjacent EX rows in the same section and
  mention the intent in the notes column ("superset with next").
- Plan length is implicit from META.weeks plus per-week EX rows.

Produce ONLY the CSV. No prose, no markdown fences.`;
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

export function parsePlanTabular(text: string): PlanParseResult {
  const issues: string[] = [];
  const delimiter = detectDelimiter(text);
  const rawLines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (rawLines.length === 0) {
    return { plan: emptyPlan(), issues: ['File is empty.'] };
  }

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

    issues.push(`Row ${r + 1}: unknown kind "${kind}". Allowed: META, BLOCK, DAY, EX.`);
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
      if (!ex.movement) issues.push(`Day "${day.label}" has an exercise with no movement.`);
      if (!(SECTIONS as readonly string[]).includes(ex.section)) {
        issues.push(`"${ex.movement}" has unknown section "${ex.section}".`);
      }
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
