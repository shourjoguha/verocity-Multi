// CSV/TSV session wireframe + AI prompt, derived from app.config and
// lib/types.ts so any upgrade to the session/frame structure updates the
// template and prompt automatically (CLAUDE.md hard rule). Single source of
// truth for the session authoring surface — mirrors src/lib/planTemplate.ts,
// kept as its own self-contained file (no shared helpers module).

import { METRICS, SECTIONS, SUBROUTINE, type MetricKey, type SectionKey } from '@/app.config';
import type {
  GroupKind,
  ScalingLevel,
  SessionExercise,
  SessionFrame,
  SessionGroup,
  SessionType,
  SessionVariant,
} from '@/lib/types';
import type { SessionInput } from '@/lib/queries';
import { isSubroutine } from '@/lib/subroutine';

export const SESSION_CSV_HEADERS = [
  'kind',
  'id',
  'label',
  'section',
  'metric',
  'rounds',
  'planned',
  'notes',
] as const;

type Row = Record<(typeof SESSION_CSV_HEADERS)[number], string>;

// Exhaustive vocabulary for the three unions a session can reference. Written
// as `Record<Union, true>` object literals (not a plain array cast) so the
// compiler itself is the drift check: adding/removing a member of SessionType,
// ScalingLevel or GroupKind in lib/types.ts breaks this file until the literal
// is updated, mirroring the config-object pattern planTemplate.ts gets from
// `BLOCKS` for free.
const SESSION_TYPE_SET: Record<SessionType, true> = {
  AMRAP: true,
  EMOM: true,
  FOR_TIME: true,
  FOR_TOTAL_REPS: true,
  FOR_TOTAL_DISTANCE: true,
  FOR_LOAD: true,
  INTERVALS: true,
  ROUNDS_FOR_TIME: true,
  CHIPPER: true,
  PARTNER: true,
  OTHER: true,
};
const SESSION_TYPES = Object.keys(SESSION_TYPE_SET) as SessionType[];

const SCALING_LEVEL_SET: Record<ScalingLevel, true> = { rx: true, intermediate: true, beginner: true };
const SCALING_LEVELS = Object.keys(SCALING_LEVEL_SET) as ScalingLevel[];

const GROUP_KIND_SET: Record<GroupKind, true> = { single: true, superset: true, circuit: true };
const GROUP_KINDS = Object.keys(GROUP_KIND_SET) as GroupKind[];

function escapeCell(value: string, delimiter: string): string {
  if (value === '') return '';
  if (value.includes(delimiter) || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function joinRows(rows: Row[], delimiter: string): string {
  const lines = [SESSION_CSV_HEADERS.join(delimiter)];
  for (const row of rows) {
    lines.push(SESSION_CSV_HEADERS.map((h) => escapeCell(row[h] ?? '', delimiter)).join(delimiter));
  }
  return lines.join('\n') + '\n';
}

function emptyRow(): Row {
  return { kind: '', id: '', label: '', section: '', metric: '', rounds: '', planned: '', notes: '' };
}

function row(partial: Partial<Row> & { kind: string }): Row {
  return { ...emptyRow(), ...partial };
}

// A deliberately rich sample: one flat strength session (no GROUP/VARIANT rows
// — each EX becomes its own single-kind group, the legacy shape) and one
// Fran-style structured metcon (groups + Rx/Intermediate/Beginner variants),
// so every row kind and every branch of the frame shape shows up.
function sampleRows(): Row[] {
  const rows: Row[] = [];

  // ---- Session 1: flat strength session ----
  rows.push(row({ kind: 'SESSION', id: 'push-day', label: 'Push Day' }));
  rows.push(row({ kind: 'META', id: 'tags', label: 'strength' }));
  rows.push(row({ kind: 'META', id: 'duration', label: '3600' }));
  rows.push(
    row({ kind: 'EX', id: 'push-day', label: 'Bench Press', section: 'primary', metric: 'weight', planned: '4x5' }),
  );
  rows.push(
    row({
      kind: 'EX',
      id: 'push-day',
      label: 'Overhead Press',
      section: 'secondary',
      metric: 'weight',
      planned: '3x8',
    }),
  );
  rows.push(
    row({ kind: 'EX', id: 'push-day', label: 'Dip', section: 'accessory', metric: 'reps', planned: '3x12' }),
  );
  rows.push(
    row({
      kind: 'SUB',
      id: 'push-day',
      label: 'Shoulder CARs',
      section: 'cooldown',
      notes: 'Controlled articular rotations — 2 slow reps each direction per shoulder, both sides.',
    }),
  );

  // ---- Session 2: Fran-style structured metcon ----
  rows.push(row({ kind: 'SESSION', id: 'fran', label: 'Fran' }));
  rows.push(row({ kind: 'META', id: 'tags', label: 'crossfit' }));
  rows.push(row({ kind: 'META', id: 'session_type', label: 'FOR_TIME' }));
  rows.push(row({ kind: 'META', id: 'time_cap', label: '600' }));
  rows.push(row({ kind: 'META', id: 'rounds', label: '3' }));
  rows.push(
    row({ kind: 'META', id: 'instructions', label: '21-15-9 reps for time of Thrusters and Pull-ups.' }),
  );
  rows.push(
    row({ kind: 'GROUP', id: 'main', label: '21-15-9', section: 'conditioning', rounds: '3', notes: 'circuit' }),
  );
  rows.push(
    row({
      kind: 'EX',
      id: 'fran',
      label: 'Thruster',
      section: 'conditioning',
      metric: 'reps',
      planned: '21-15-9',
      notes: '95/65 lb',
    }),
  );
  rows.push(
    row({ kind: 'EX', id: 'fran', label: 'Pull-up', section: 'conditioning', metric: 'reps', planned: '21-15-9' }),
  );

  rows.push(row({ kind: 'VARIANT', id: 'fran', label: 'rx:Rx' }));
  rows.push(
    row({
      kind: 'GROUP',
      id: 'main-rx',
      label: '21-15-9 (Rx)',
      section: 'conditioning',
      rounds: '3',
      notes: 'circuit',
    }),
  );
  rows.push(
    row({
      kind: 'EX',
      id: 'fran',
      label: 'Thruster',
      section: 'conditioning',
      metric: 'reps',
      planned: '21-15-9',
      notes: '95/65 lb',
    }),
  );
  rows.push(
    row({ kind: 'EX', id: 'fran', label: 'Pull-up', section: 'conditioning', metric: 'reps', planned: '21-15-9' }),
  );

  rows.push(row({ kind: 'VARIANT', id: 'fran', label: 'intermediate:Scaled' }));
  rows.push(
    row({
      kind: 'GROUP',
      id: 'main-int',
      label: '21-15-9 (Intermediate)',
      section: 'conditioning',
      rounds: '3',
      notes: 'circuit',
    }),
  );
  rows.push(
    row({
      kind: 'EX',
      id: 'fran',
      label: 'Thruster',
      section: 'conditioning',
      metric: 'reps',
      planned: '21-15-9',
      notes: '65/45 lb',
    }),
  );
  rows.push(
    row({
      kind: 'EX',
      id: 'fran',
      label: 'Banded Pull-up',
      section: 'conditioning',
      metric: 'reps',
      planned: '21-15-9',
    }),
  );

  rows.push(
    row({
      kind: 'VARIANT',
      id: 'fran',
      label: 'beginner:Foundations',
      rounds: '900',
      notes: 'Extra time and modified movements for newer athletes.',
    }),
  );
  rows.push(
    row({
      kind: 'GROUP',
      id: 'main-beg',
      label: '21-15-9 (Beginner)',
      section: 'conditioning',
      rounds: '3',
      notes: 'circuit',
    }),
  );
  rows.push(
    row({
      kind: 'EX',
      id: 'fran',
      label: 'Thruster',
      section: 'conditioning',
      metric: 'reps',
      planned: '21-15-9',
      notes: '45/35 lb',
    }),
  );
  rows.push(
    row({ kind: 'EX', id: 'fran', label: 'Ring Row', section: 'conditioning', metric: 'reps', planned: '21-15-9' }),
  );

  return rows;
}

export function buildSessionCsvTemplate(): string {
  return joinRows(sampleRows(), ',');
}

export function buildSessionTsvTemplate(): string {
  return joinRows(sampleRows(), '\t');
}

// AI prompt — derived from app.config plus the union vocabulary above so it
// stays in sync with the domain.
export function buildSessionAiPrompt(): string {
  const sectionList = (SECTIONS as readonly string[]).join(', ');
  const metricEntries = Object.entries(METRICS)
    .map(([k, v]) => `${k} (${v.label}${v.unit ? `, ${v.unit}` : ''})`)
    .join(', ');
  const sessionTypeList = SESSION_TYPES.join(', ');
  const scalingLevelList = SCALING_LEVELS.join(', ');
  const groupKindList = GROUP_KINDS.join(', ');

  return `You are generating one or more standalone training sessions for the Verocity app.

OUTPUT FORMAT
- A single CSV file. The first row must be exactly:
  ${SESSION_CSV_HEADERS.join(',')}
- One row per record. Allowed values for the first column ("kind"):
  META, SESSION, GROUP, EX, SUB, VARIANT.
- Cells that contain commas, quotes, or newlines must be wrapped in double
  quotes; embedded quotes are doubled ("").
- Leave unused columns empty. Do not invent new columns.
- A file may contain many sessions — start each with a SESSION row.

ROW SHAPES
- SESSION: opens a new session. id = a short slug (lowercase, dashes), unique
    within the file; label = display name. Every following row belongs to this
    session until the next SESSION row.
- META: session-level metadata for the current session. id ∈ {name, tags,
    session_type, time_cap, duration, rounds, partner, instructions, source,
    source_ref}; label = the value.
    • name overrides the SESSION row's label if both are set, the label wins.
    • tags is a comma-separated list (e.g. "strength,crossfit").
    • session_type ∈ {${sessionTypeList}}.
    • time_cap / duration are in seconds. partner is "true" or "false".
- GROUP: opens a group of items inside the current session (or the current
    VARIANT, if one is open). id = a group slug; label = optional display
    label; section ∈ {${sectionList}}; rounds = "N" or "N Rsec" (e.g. "3 R60"
    = 3 rounds, 60s rest between); notes = the group kind, one of
    {${groupKindList}} (defaults to "single" if empty).
- EX: one movement. Belongs to the current GROUP, or becomes its own
    single-item group if no GROUP is open. section ∈ {${sectionList}};
    metric ∈ {${Object.keys(METRICS).join(', ')}}; planned is a single set
    spec ("3x5", "21-15-9", "1x400"); notes is free text (load, cues, units).
- SUB: a subroutine — a free-text block (protocol, instructions, a link) that
    sits among the movements, attaching to a GROUP the same way EX does.
    label = a short title; section ∈ {${sectionList}}; notes = the
    description (≤${SUBROUTINE.maxDescriptionChars} chars); planned = an
    optional URL. Leave metric empty.
- VARIANT: opens a scaling variant of the current session — for CrossFit-style
    Rx / Intermediate / Beginner scaling. label = "level:label" (e.g.
    "rx:Rx", "intermediate:Scaled", "beginner:Foundations") where level ∈
    {${scalingLevelList}}; rounds = an optional time-cap override in seconds;
    notes = an optional instructions override. Subsequent GROUP/EX/SUB rows
    attach to this variant instead of the session's top-level frame, until the
    next SESSION, META, or VARIANT row. If you use variants, also write the Rx
    version's GROUP/EX rows at the top level (before the first VARIANT row) —
    older readers that don't understand variants fall back to that.

DOMAIN VOCABULARY (single source of truth — app.config.ts / lib/types.ts)
- Sections (canonical order in the logger): ${sectionList}.
- Metrics: ${metricEntries}.
- Session types: ${sessionTypeList}.
- Scaling levels: ${scalingLevelList}.
- Group kinds: ${groupKindList}.

INVARIANTS THE APP WILL CHECK ON UPLOAD
1. Header row matches exactly: ${SESSION_CSV_HEADERS.join(',')}.
2. At least one SESSION row.
3. Every session has a name (from the SESSION label or META.name).
4. session_type, if set, is one of {${sessionTypeList}}.
5. Every EX has a movement (label), section ∈ {${sectionList}}, metric ∈
   {${Object.keys(METRICS).join(', ')}}, and a planned value.
6. Every GROUP's kind (notes column) is one of {${groupKindList}}.
7. Every VARIANT's level is one of {${scalingLevelList}}.
8. Every SUB has a title (label) and a description (notes)
   ≤${SUBROUTINE.maxDescriptionChars} characters.

SELF-CHECK BEFORE YOU SEND
Re-read your finished CSV line by line and confirm every item. A file that fails
any of these is rejected by the importer and the user gets nothing.
[ ] The first line is exactly: ${SESSION_CSV_HEADERS.join(',')}
[ ] Nothing precedes the header row and nothing follows the last data row — no
    prose, no "Here are your sessions", no \`\`\` fences anywhere in the response.
[ ] Every row has exactly ${SESSION_CSV_HEADERS.length} fields. Any cell containing a comma is quoted.
[ ] Every row's first column is one of META, SESSION, GROUP, EX, SUB, VARIANT.
[ ] Every SESSION id is unique within the file and every session has a name.
[ ] Every EX section is one of {${sectionList}} and every EX metric is one of
    {${Object.keys(METRICS).join(', ')}}. No invented values.
[ ] Every EX has a non-empty planned cell.
[ ] Every GROUP kind is one of {${groupKindList}} or empty.
[ ] Every VARIANT label is "level:label" with level in {${scalingLevelList}}.
[ ] Every SUB has a label and a notes description of ≤${SUBROUTINE.maxDescriptionChars} characters.
If any check fails, fix it and run the list again. Do not send a CSV that fails
a check.

Produce ONLY the CSV. No prose, no markdown fences.

WORKED EXAMPLE
A complete, valid file that exercises every feature above. Match its shape — not
its content. Ends the prompt so the last thing you read is a correct file.

${buildSessionCsvTemplate()}`;
}

/**
 * The repair prompt: what the user pastes back when the importer rejects the
 * generated CSV. Mirrors `buildPlanFixPrompt` in src/lib/planTemplate.ts — the
 * format rules are restated because the original prompt may have scrolled out
 * of the chat's context by the time this is needed.
 */
export function buildSessionFixPrompt(issues: string[], csvText: string): string {
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
- First row exactly: ${SESSION_CSV_HEADERS.join(',')}
- First column is one of: META, SESSION, GROUP, EX, SUB, VARIANT.
- Allowed sections: ${(SECTIONS as readonly string[]).join(', ')}.
- Allowed metrics: ${Object.keys(METRICS).join(', ')}.
- Allowed session types: ${SESSION_TYPES.join(', ')}.
- Allowed group kinds: ${GROUP_KINDS.join(', ')}.
- Allowed scaling levels: ${SCALING_LEVELS.join(', ')}.
- Every session needs a name, and every EX needs a section, a metric and a
  planned value.
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

export interface SessionParseResult {
  sessions: SessionInput[];
  issues: string[];
}

// Mutable accumulator for one SESSION row's worth of data while streaming
// through the file. Converted to a SessionInput once the file is fully read.
interface SessionRecord {
  name: string;
  nameFromLabel: boolean;
  tags: string[];
  groups: SessionGroup[];
  variants: { level: ScalingLevel; label?: string; groups: SessionGroup[]; timeCapSeconds?: number; instructions?: string }[];
  sessionType?: SessionType;
  timeCapSeconds?: number;
  durationSeconds?: number;
  rounds?: number;
  partner?: boolean;
  instructions?: string;
  source?: string;
  sourceRef?: string;
}

function toSessionInput(rec: SessionRecord): SessionInput {
  const exercises = rec.groups.flatMap((g) => g.items);
  const frame: SessionFrame = {
    exercises,
    ...(rec.groups.length > 0 ? { groups: rec.groups } : {}),
    ...(rec.variants.length > 0
      ? {
          variants: rec.variants.map<SessionVariant>((v) => ({
            level: v.level,
            ...(v.label ? { label: v.label } : {}),
            groups: v.groups,
            ...(v.timeCapSeconds !== undefined ? { timeCapSeconds: v.timeCapSeconds } : {}),
            ...(v.instructions ? { instructions: v.instructions } : {}),
          })),
        }
      : {}),
  };
  return {
    name: rec.name,
    tags: rec.tags,
    frame,
    is_mini: false,
    session_type: rec.sessionType ?? null,
    time_cap_seconds: rec.timeCapSeconds ?? null,
    duration_seconds: rec.durationSeconds ?? null,
    rounds: rec.rounds ?? null,
    partner: rec.partner ?? false,
    instructions: rec.instructions ?? null,
    source: rec.source ?? null,
    source_ref: rec.sourceRef ?? null,
  };
}

/**
 * The session mirror of `stripLlmWrapper` / `dropPreamble` in planTemplate.ts —
 * duplicated rather than shared, per this file's "no shared helpers module"
 * convention. Removes ``` fences and prose before the header row, and nothing
 * else: no fuzzy matching, no header reordering. See the plan-side comment for
 * why the text path needed this when the workbook path never did.
 */
function stripLlmWrapper(text: string): string[] {
  return text.split(/\r?\n/).filter((l) => l.trim() !== '' && !/^\s*```/.test(l));
}

function dropPreamble(lines: string[], delimiter: string): string[] {
  const expected = SESSION_CSV_HEADERS.map((h) => h.toLowerCase());
  const headerAt = lines.findIndex((l) => {
    const cells = splitCsvLine(l, delimiter).map((c) => c.trim().toLowerCase());
    return expected.every((h, i) => cells[i] === h);
  });
  return headerAt > 0 ? lines.slice(headerAt) : lines;
}

export function parseSessionTabular(text: string): SessionParseResult {
  const issues: string[] = [];
  // Fences off before the delimiter sniff — see the plan-side note.
  const stripped = stripLlmWrapper(text);
  if (stripped.length === 0) {
    return { sessions: [], issues: ['File is empty.'] };
  }
  const delimiter = detectDelimiter(stripped.join('\n'));
  const rawLines = dropPreamble(stripped, delimiter);

  const header = splitCsvLine(rawLines[0], delimiter).map((c) => c.trim().toLowerCase());
  const expected = SESSION_CSV_HEADERS.map((h) => h.toLowerCase());
  if (header.join(',') !== expected.join(',')) {
    issues.push(
      `Header row must be exactly: ${SESSION_CSV_HEADERS.join(',')} (got: ${header.join(',')})`,
    );
  }

  const idx = (name: (typeof SESSION_CSV_HEADERS)[number]) => expected.indexOf(name);

  const records: SessionRecord[] = [];
  let session: SessionRecord | null = null;
  let variant: SessionRecord['variants'][number] | null = null;
  let group: SessionGroup | null = null;

  for (let r = 1; r < rawLines.length; r++) {
    const cells = splitCsvLine(rawLines[r], delimiter).map((c) => c.trim());
    const get = (h: (typeof SESSION_CSV_HEADERS)[number]) => cells[idx(h)] ?? '';
    const kind = get('kind').toUpperCase();
    if (!kind) continue;

    if (kind === 'SESSION') {
      const id = get('id');
      if (!id) {
        issues.push(`Row ${r + 1}: SESSION needs an id (slug).`);
        continue;
      }
      const label = get('label');
      const rec: SessionRecord = {
        name: label,
        nameFromLabel: !!label,
        tags: [],
        groups: [],
        variants: [],
      };
      records.push(rec);
      session = rec;
      variant = null;
      group = null;
      continue;
    }

    if (kind === 'META') {
      if (!session) {
        issues.push(`Row ${r + 1}: META before any SESSION row.`);
        continue;
      }
      variant = null;
      group = null;
      const k = get('id').toLowerCase();
      const v = get('label');
      switch (k) {
        case 'name':
          if (!session.nameFromLabel) session.name = v || session.name;
          break;
        case 'tags':
          session.tags = v
            ? v.split(',').map((t) => t.trim()).filter(Boolean)
            : [];
          break;
        case 'session_type': {
          const upper = v.toUpperCase();
          if (!(SESSION_TYPES as readonly string[]).includes(upper)) {
            issues.push(`Row ${r + 1}: unknown session_type "${v}". Allowed: ${SESSION_TYPES.join(', ')}.`);
          } else {
            session.sessionType = upper as SessionType;
          }
          break;
        }
        case 'time_cap': {
          const n = parseInt(v, 10);
          if (!Number.isFinite(n) || n <= 0) issues.push(`Row ${r + 1}: META.time_cap must be a positive integer (seconds).`);
          else session.timeCapSeconds = n;
          break;
        }
        case 'duration': {
          const n = parseInt(v, 10);
          if (!Number.isFinite(n) || n <= 0) issues.push(`Row ${r + 1}: META.duration must be a positive integer (seconds).`);
          else session.durationSeconds = n;
          break;
        }
        case 'rounds': {
          const n = parseInt(v, 10);
          if (!Number.isFinite(n) || n <= 0) issues.push(`Row ${r + 1}: META.rounds must be a positive integer.`);
          else session.rounds = n;
          break;
        }
        case 'partner':
          session.partner = v.toLowerCase() === 'true';
          break;
        case 'instructions':
          session.instructions = v || undefined;
          break;
        case 'source':
          session.source = v || undefined;
          break;
        case 'source_ref':
          session.sourceRef = v || undefined;
          break;
        default:
          issues.push(`Row ${r + 1}: unknown META id "${k}".`);
      }
      continue;
    }

    if (kind === 'VARIANT') {
      if (!session) {
        issues.push(`Row ${r + 1}: VARIANT before any SESSION row.`);
        continue;
      }
      const labelCell = get('label');
      const sep = labelCell.indexOf(':');
      const levelRaw = (sep === -1 ? labelCell : labelCell.slice(0, sep)).trim().toLowerCase();
      const variantLabel = sep === -1 ? '' : labelCell.slice(sep + 1).trim();
      if (!(SCALING_LEVELS as readonly string[]).includes(levelRaw)) {
        issues.push(`Row ${r + 1}: unknown variant level "${levelRaw}". Allowed: ${SCALING_LEVELS.join(', ')}.`);
        continue;
      }
      const roundsCell = get('rounds');
      let timeCapSeconds: number | undefined;
      if (roundsCell) {
        const n = parseInt(roundsCell, 10);
        if (!Number.isFinite(n) || n <= 0) {
          issues.push(`Row ${r + 1}: VARIANT rounds (time_cap override) must be a positive integer (seconds).`);
        } else {
          timeCapSeconds = n;
        }
      }
      const notes = get('notes');
      const rec = {
        level: levelRaw as ScalingLevel,
        ...(variantLabel ? { label: variantLabel } : {}),
        groups: [] as SessionGroup[],
        ...(timeCapSeconds !== undefined ? { timeCapSeconds } : {}),
        ...(notes ? { instructions: notes } : {}),
      };
      session.variants.push(rec);
      variant = rec;
      group = null;
      continue;
    }

    if (kind === 'GROUP') {
      if (!session) {
        issues.push(`Row ${r + 1}: GROUP before any SESSION row.`);
        continue;
      }
      const label = get('label');
      const section = get('section').toLowerCase();
      if (!(SECTIONS as readonly string[]).includes(section)) {
        issues.push(
          `Row ${r + 1}: section "${section}" not in {${(SECTIONS as readonly string[]).join(', ')}}.`,
        );
        continue;
      }
      const roundsCell = get('rounds');
      let rounds: number | undefined;
      let restSeconds: number | undefined;
      if (roundsCell) {
        const m = roundsCell.match(/^(\d+)\s*(?:r(\d+))?$/i);
        if (!m) {
          issues.push(`Row ${r + 1}: GROUP rounds must be "N" or "N Rsec" (got "${roundsCell}").`);
        } else {
          rounds = parseInt(m[1], 10);
          if (m[2]) restSeconds = parseInt(m[2], 10);
        }
      }
      const kindCell = get('notes').toLowerCase() || 'single';
      if (!(GROUP_KINDS as readonly string[]).includes(kindCell)) {
        issues.push(`Row ${r + 1}: GROUP kind "${kindCell}" not in {${GROUP_KINDS.join(', ')}}.`);
        continue;
      }
      const newGroup: SessionGroup = {
        kind: kindCell as GroupKind,
        section: section as SectionKey,
        items: [],
        ...(rounds !== undefined ? { rounds } : {}),
        ...(restSeconds !== undefined ? { restSeconds } : {}),
        ...(label ? { label } : {}),
      };
      (variant ? variant.groups : session.groups).push(newGroup);
      group = newGroup;
      continue;
    }

    if (kind === 'SUB') {
      if (!session) {
        issues.push(`Row ${r + 1}: SUB before any SESSION row.`);
        continue;
      }
      const title = get('label');
      const section = get('section').toLowerCase();
      const description = get('notes');
      const url = get('planned');
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
      const item: SessionExercise = {
        kind: 'subroutine',
        movement: title,
        section: section as SectionKey,
        primaryMetric: 'reps',
        planned: '',
        description,
        ...(url ? { url } : {}),
      };
      if (group) {
        group.items.push(item);
      } else {
        (variant ? variant.groups : session.groups).push({ kind: 'single', section: section as SectionKey, items: [item] });
      }
      continue;
    }

    if (kind === 'EX') {
      if (!session) {
        issues.push(`Row ${r + 1}: EX before any SESSION row.`);
        continue;
      }
      const movement = get('label');
      const section = get('section').toLowerCase();
      const metric = get('metric').toLowerCase() || 'weight';
      const planned = get('planned');
      const notes = get('notes');
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
        issues.push(`Row ${r + 1}: metric "${metric}" not in {${Object.keys(METRICS).join(', ')}}.`);
        continue;
      }
      const item: SessionExercise = {
        movement,
        section: section as SectionKey,
        primaryMetric: metric as MetricKey,
        planned,
        ...(notes ? { notes } : {}),
      };
      if (group) {
        group.items.push(item);
      } else {
        (variant ? variant.groups : session.groups).push({ kind: 'single', section: section as SectionKey, items: [item] });
      }
      continue;
    }

    issues.push(`Row ${r + 1}: unknown kind "${kind}". Allowed: META, SESSION, GROUP, EX, SUB, VARIANT.`);
  }

  const sessions = records.map(toSessionInput);
  issues.push(...validateSessions(sessions));
  return { sessions, issues };
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
export async function parseSessionWorkbook(buffer: ArrayBuffer): Promise<SessionParseResult> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return { sessions: [], issues: ['Workbook has no sheets.'] };

  const expectedLower = SESSION_CSV_HEADERS.map((h) => h.toLowerCase());
  const csvRows: string[] = [];
  let headerRow = -1;

  for (let r = 1; r <= sheet.rowCount; r++) {
    const rowData = sheet.getRow(r);
    const values = Array.isArray(rowData.values) ? rowData.values.slice(1) : [];
    const cells = values.map(cellToString).map((s) => s.trim());
    if (headerRow === -1) {
      const lower = cells.map((c) => c.toLowerCase());
      const match = expectedLower.every((h, i) => lower[i] === h);
      if (match) {
        headerRow = r;
        csvRows.push(SESSION_CSV_HEADERS.join(','));
      }
      continue;
    }
    if (cells.every((c) => c === '')) continue;
    const padded = SESSION_CSV_HEADERS.map((_, i) => cells[i] ?? '');
    csvRows.push(padded.map((c) => escapeCell(c, ',')).join(','));
  }

  if (headerRow === -1) {
    return {
      sessions: [],
      issues: [`Could not find header row "${SESSION_CSV_HEADERS.join(',')}" in the first sheet.`],
    };
  }

  return parseSessionTabular(csvRows.join('\n') + '\n');
}

// Validation catches mismatches against the SessionInput/SessionFrame
// contract — used both by the tabular parser and as a final safety check
// before save.
export function validateSessions(sessions: SessionInput[]): string[] {
  const issues: string[] = [];
  if (sessions.length === 0) {
    issues.push('At least one session is required.');
    return issues;
  }

  sessions.forEach((s, i) => {
    const label = s.name && s.name.trim() ? s.name : `session #${i + 1}`;
    if (!s.name || !s.name.trim()) issues.push(`Session "${label}" is missing a name.`);
    if (s.session_type != null && !(SESSION_TYPES as readonly string[]).includes(s.session_type)) {
      issues.push(`Session "${label}" has unknown session_type "${s.session_type}".`);
    }

    const allGroups: SessionGroup[] = [
      ...(s.frame.groups ?? []),
      ...(s.frame.variants ?? []).flatMap((v) => v.groups),
    ];
    for (const g of allGroups) {
      if (!(GROUP_KINDS as readonly string[]).includes(g.kind)) {
        issues.push(`Session "${label}" has a group with unknown kind "${g.kind}".`);
      }
      for (const item of g.items) {
        if (isSubroutine(item)) {
          if (!item.movement) issues.push(`Session "${label}" has a subroutine with no title.`);
          if (!item.description || !item.description.trim()) {
            issues.push(`Subroutine "${item.movement}" in session "${label}" needs a description.`);
          } else if (item.description.length > SUBROUTINE.maxDescriptionChars) {
            issues.push(
              `Subroutine "${item.movement}" in session "${label}" description exceeds ${SUBROUTINE.maxDescriptionChars} characters.`,
            );
          }
          continue;
        }
        if (!item.movement) issues.push(`Session "${label}" has an exercise with no movement.`);
        if (!(SECTIONS as readonly string[]).includes(item.section)) {
          issues.push(`"${item.movement}" in session "${label}" has unknown section "${item.section}".`);
        }
        if (!(item.primaryMetric in METRICS)) {
          issues.push(`"${item.movement}" in session "${label}" has unknown metric "${item.primaryMetric}".`);
        }
        if (!item.planned || !item.planned.trim()) {
          issues.push(`"${item.movement}" in session "${label}" has no planned value.`);
        }
      }
    }

    for (const v of s.frame.variants ?? []) {
      if (!(SCALING_LEVELS as readonly string[]).includes(v.level)) {
        issues.push(`Session "${label}" has a variant with unknown level "${v.level}".`);
      }
    }
  });

  return issues;
}
