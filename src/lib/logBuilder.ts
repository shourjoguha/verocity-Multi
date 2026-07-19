import type {
  ItemKind,
  LogDocument,
  LogGroup,
  LogItem,
  LogSection,
  ParsedPlan,
  PlanDay,
  SessionExercise,
  SessionFrame,
} from '@/lib/types';
import type { SessionInput } from '@/lib/queries';
import { RPE, SECTIONS, type MetricKey, type SectionKey } from '@/app.config';
import { isSubroutine } from '@/lib/subroutine';

function newId(): string {
  return crypto.randomUUID();
}

// Parse a planned-set string like "3x5", "5×3", "4x8 @70%" → set count + per-set
// planned label. A trailing-empty count form ("3x") yields that many label-less
// sets — the round-trip form for logged sets with no prescription. Falls back to
// a single set carrying the raw string.
export function parsePlanned(raw: string): { count: number; label: string } {
  const m = raw.trim().match(/^(\d+)\s*[x×]\s*(.*)$/i);
  if (m) return { count: Math.max(1, parseInt(m[1], 10)), label: m[2].trim() };
  return { count: 1, label: raw.trim() };
}

function emptyActual() {
  return { completed: false, prefilled: false, rpe: RPE.default };
}

// A section-tagged exercise with a single planned string — the common shape
// behind both plan days (one week's column) and saved session frames.
type FrameExercise = {
  movement: string;
  section: SectionKey;
  primaryMetric: MetricKey;
  planned: string;
  notes?: string;
  kind?: ItemKind;
  description?: string;
  url?: string;
};

// Build an in-progress LogDocument from a flat exercise list. Each exercise
// becomes a single-item group in its section; sets come from the planned string.
// Subroutines carry text (title/description/link) and no sets.
function buildLogFromExercises(exercises: FrameExercise[]): LogDocument {
  const bySection = new Map<SectionKey, LogItem[]>();

  for (const ex of exercises) {
    let item: LogItem;
    if (isSubroutine(ex)) {
      item = {
        id: newId(),
        kind: 'subroutine',
        movement: ex.movement,
        description: ex.description,
        ...(ex.url ? { url: ex.url } : {}),
        primaryMetric: ex.primaryMetric,
        sets: [],
      };
    } else {
      const { count, label } = parsePlanned(ex.planned);
      item = {
        id: newId(),
        movement: ex.movement,
        primaryMetric: ex.primaryMetric,
        notes: ex.notes,
        sets: Array.from({ length: count }, () => ({
          planned: label || null,
          actual: emptyActual(),
          notations: [],
        })),
      };
    }
    bySection.set(ex.section, [...(bySection.get(ex.section) ?? []), item]);
  }

  const sections: LogSection[] = SECTIONS.filter((k) => bySection.has(k)).map((key) => ({
    key,
    groups: (bySection.get(key) ?? []).map<LogGroup>((item) => ({
      id: newId(),
      kind: 'single',
      items: [item],
    })),
  }));

  return { sections };
}

// Build an in-progress LogDocument from a plan day for a given week.
export function buildLogFromPlanDay(day: PlanDay, week: number): LogDocument {
  return buildLogFromExercises(
    day.exercises.map((ex) => ({
      movement: ex.movement,
      section: ex.section,
      primaryMetric: ex.primaryMetric,
      planned: ex.plannedByWeek[week] ?? '',
      notes: ex.notes,
      kind: ex.kind,
      description: ex.description,
      url: ex.url,
    })),
  );
}

// Build an in-progress LogDocument from a saved session frame. An empty frame
// falls back to a blank doc so the Logger still has a section to add into.
export function buildLogFromSession(frame: SessionFrame): LogDocument {
  if (!frame.exercises || frame.exercises.length === 0) return buildBlankLog();
  return buildLogFromExercises(frame.exercises);
}

// The smallest week number with any programmed content for a day (1 if none).
export function firstWeekWithContent(day: PlanDay): number {
  let min = Infinity;
  for (const ex of day.exercises) {
    for (const k of Object.keys(ex.plannedByWeek)) {
      const w = Number(k);
      if (ex.plannedByWeek[w]?.trim() && w < min) min = w;
    }
  }
  return Number.isFinite(min) ? min : 1;
}

// Resolve which week's prescription to use when launching a plan day. Prefers the
// caller's week (e.g. the active plan's live week), but when that week has no
// content for the day — typical for historic plans started long ago — falls back
// to the first week that does, so the workout isn't built from blanks.
export function resolveWeek(day: PlanDay, preferred: number): number {
  const hasContent = day.exercises.some((ex) => ex.plannedByWeek[preferred]?.trim());
  return hasContent ? preferred : firstWeekWithContent(day);
}

// Blank document for a custom (plan-less) session — one accessory section.
export function buildBlankLog(): LogDocument {
  return { sections: [{ key: 'accessory', groups: [] }] };
}

// ---- minis: shorter on-plan sessions (short on time / back from a break) ----

export type MiniPreset = 'express' | 'half';

// Sections kept when shortening a plan day. The main work stays intact (same
// goals) — only the supporting volume is trimmed.
const MINI_SECTIONS: Record<MiniPreset, SectionKey[]> = {
  express: ['warmup', 'primary'],
  half: ['warmup', 'primary', 'secondary'],
};

// Trim a built LogDocument to a shorter on-plan session. Keeps WHOLE sections
// (never partial sets) so the primary lift is unchanged; falls back to the first
// section when the preset's sections aren't present (e.g. a conditioning day).
export function reduceLogDocument(doc: LogDocument, preset: MiniPreset): LogDocument {
  const keep = new Set<SectionKey>(MINI_SECTIONS[preset]);
  const sections = doc.sections.filter((s) => keep.has(s.key) && s.groups.length > 0);
  return { ...doc, sections: sections.length > 0 ? sections : doc.sections.slice(0, 1) };
}

// Convert each day of a parsed plan into a standalone "mini" session input
// (single planned string per exercise, from the first programmed week), tagged
// to the owning plan. Days with no usable exercises are skipped. Used by the
// plan-upload "minis" path.
export function daysToMiniSessions(plan: ParsedPlan, planId: string): SessionInput[] {
  return plan.days
    .map((day) => ({
      name: day.label,
      tags: [] as string[],
      frame: frameFromPlanDay(day, firstWeekWithContent(day)),
      source_plan_id: planId,
      source_day_key: day.dayKey,
      is_mini: true,
    }))
    .filter((s) => s.frame.exercises.length > 0);
}

// ---- frame converters (Sessions library "save as session" paths) ----

// Collapse a plan day at a given week into a standalone session frame.
export function frameFromPlanDay(day: PlanDay, week: number): SessionFrame {
  return {
    exercises: day.exercises
      .map<SessionExercise>((ex) => ({
        movement: ex.movement,
        section: ex.section,
        primaryMetric: ex.primaryMetric,
        planned: ex.plannedByWeek[week] ?? '',
        notes: ex.notes,
        kind: ex.kind,
        description: ex.description,
        url: ex.url,
      }))
      // Keep subroutines (title, no planned); movements need both movement + planned.
      .filter((ex) =>
        isSubroutine(ex) ? ex.movement.trim() !== '' : ex.movement.trim() !== '' && ex.planned.trim() !== '',
      ),
  };
}

// Collapse a logged workout into a reusable frame. Grouping is flattened (frames
// are flat, like plan days); the planned string is reconstructed from what was
// actually performed — set count plus the most common per-set planned label.
export function frameFromLogDocument(doc: LogDocument): SessionFrame {
  const exercises: SessionExercise[] = [];
  for (const section of doc.sections) {
    for (const group of section.groups) {
      for (const item of group.items) {
        if (isSubroutine(item)) {
          exercises.push({
            movement: item.movement,
            section: section.key,
            primaryMetric: item.primaryMetric,
            planned: '',
            kind: 'subroutine',
            description: item.description,
            ...(item.url ? { url: item.url } : {}),
          });
          continue;
        }
        const count = item.sets.length || 1;
        const label = dominantPlanned(item.sets.map((s) => s.planned));
        // Always the NxLabel form (label may be empty → "3x") so buildLogFromSession
        // round-trips the set count rather than collapsing to a single set.
        const planned = `${count}x${label}`;
        exercises.push({
          movement: item.movement,
          section: section.key,
          primaryMetric: item.primaryMetric,
          planned,
          notes: item.notes,
        });
      }
    }
  }
  return { exercises };
}

// Most frequent non-empty planned label across a set list (ties → first seen).
function dominantPlanned(labels: (string | null)[]): string {
  const counts = new Map<string, number>();
  for (const l of labels) {
    const v = (l ?? '').trim();
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best = '';
  let bestN = 0;
  for (const [label, n] of counts) {
    if (n > bestN) {
      best = label;
      bestN = n;
    }
  }
  return best;
}
