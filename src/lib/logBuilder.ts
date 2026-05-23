import type { LogDocument, LogGroup, LogItem, LogSection, PlanDay } from '@/lib/types';
import { SECTIONS, type SectionKey } from '@/app.config';

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

// Build an in-progress LogDocument from a plan day for a given week. Each
// exercise becomes a single-item group in its section; sets come from the
// week's planned string.
export function buildLogFromPlanDay(day: PlanDay, week: number): LogDocument {
  const bySection = new Map<SectionKey, LogItem[]>();

  for (const ex of day.exercises) {
    const planned = ex.plannedByWeek[week] ?? '';
    const { count, label } = parsePlanned(planned);
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

// Blank document for a custom (plan-less) session — one accessory section.
export function buildBlankLog(): LogDocument {
  return { sections: [{ key: 'accessory', groups: [] }] };
}

// Add a movement as a new single-item group to a section (mutates a copy).
export function addMovement(
  doc: LogDocument,
  sectionKey: SectionKey,
  movement: string,
  primaryMetric: LogItem['primaryMetric'],
): LogDocument {
  const item: LogItem = {
    id: newId(),
    movement,
    primaryMetric,
    sets: [{ planned: null, actual: emptyActual(), notations: [] }],
  };
  const sections = [...doc.sections];
  const idx = sections.findIndex((s) => s.key === sectionKey);
  const group: LogGroup = { id: newId(), kind: 'single', items: [item] };
  if (idx >= 0) {
    sections[idx] = { ...sections[idx], groups: [...sections[idx].groups, group] };
  } else {
    sections.push({ key: sectionKey, groups: [group] });
  }
  return { ...doc, sections };
}
