import type {
  LogDocument,
  LogGroup,
  LogItem,
  LogSection,
  PlanDay,
  SessionExercise,
  SessionFrame,
} from '@/lib/types';
import { SECTIONS, type MetricKey, type SectionKey } from '@/app.config';

function newId(): string {
  return crypto.randomUUID();
}

// Parse a planned-set string like "3x5", "5×3", "4x8 @70%" → set count + per-set
// planned label. Falls back to a single set carrying the raw string.
export function parsePlanned(raw: string): { count: number; label: string } {
  const m = raw.trim().match(/^(\d+)\s*[x×]\s*(.+)$/i);
  if (m) return { count: Math.max(1, parseInt(m[1], 10)), label: m[2].trim() };
  return { count: 1, label: raw.trim() };
}

function emptyActual() {
  return { completed: false, prefilled: false };
}

// A section-tagged exercise with a single planned string — the common shape
// behind both plan days (one week's column) and saved session frames.
type FrameExercise = {
  movement: string;
  section: SectionKey;
  primaryMetric: MetricKey;
  planned: string;
  notes?: string;
};

// Build an in-progress LogDocument from a flat exercise list. Each exercise
// becomes a single-item group in its section; sets come from the planned string.
function buildLogFromExercises(exercises: FrameExercise[]): LogDocument {
  const bySection = new Map<SectionKey, LogItem[]>();

  for (const ex of exercises) {
    const { count, label } = parsePlanned(ex.planned);
    const item: LogItem = {
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
      }))
      .filter((ex) => ex.movement.trim() !== '' && ex.planned.trim() !== ''),
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
        const count = item.sets.length || 1;
        const label = dominantPlanned(item.sets.map((s) => s.planned));
        const planned = label ? `${count}x${label}` : String(count);
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
