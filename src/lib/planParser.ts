import { BLOCKS, METRICS, SECTIONS, SECTION_ALIASES, type BlockKey, type MetricKey, type SectionKey } from '@/app.config';
import type { ParsedPlan, PlanBlock, PlanDay, PlanExercise } from '@/lib/types';

// Strict markdown plan format (also shown to the user in PlanUpload):
//
//   # Plan Title
//   start: 2026-06-01
//   weeks: 8
//
//   ## Block: Accumulation W1-4
//   ## Block: Intensification W5-8
//
//   ## Day: Monday — Lower
//   ### Primary
//   - Back Squat [weight]: W1 3x5; W2 3x5; W3 4x5; W4 3x3
//   - Romanian Deadlift [weight]: 3x8
//   ### Accessory
//   - Leg Press [weight]: 3x12

export const PLAN_FORMAT_HELP = `# Plan Title
start: 2026-06-01
weeks: 8

## Block: Accumulation W1-4
## Block: Intensification W5-8

## Day: Monday — Lower
### Primary
- Back Squat [weight]: W1 3x5; W2 3x5; W3 4x5; W4 3x3
- Romanian Deadlift [weight]: 3x8
### Accessory
- Leg Press [weight]: 3x12`;

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function normalizeSection(text: string): SectionKey {
  const t = text.trim().toLowerCase();
  if ((SECTIONS as readonly string[]).includes(t)) return t as SectionKey;
  return SECTION_ALIASES[t] ?? 'primary';
}

function normalizeMetric(text: string | undefined): MetricKey {
  const t = (text ?? '').trim().toLowerCase();
  return (t in METRICS ? t : 'weight') as MetricKey;
}

function normalizeBlock(name: string): BlockKey {
  const n = name.toLowerCase();
  for (const key of Object.keys(BLOCKS) as BlockKey[]) {
    if (n.includes(key)) return key;
  }
  return 'accumulation';
}

interface DraftExercise {
  movement: string;
  section: SectionKey;
  primaryMetric: MetricKey;
  explicit: Record<number, string>;
  allValue?: string;
}

export function parsePlanMarkdown(markdown: string): ParsedPlan {
  const lines = markdown.split('\n').map((l) => l.replace(/\r$/, ''));

  let title = 'Untitled Plan';
  let startDate: string | null = null;
  let endDate: string | null = null;
  let weekCount: number | null = null;
  const blocks: PlanBlock[] = [];

  const days: { dayKey: string; label: string; exercises: DraftExercise[] }[] = [];
  let currentDay: (typeof days)[0] | null = null;
  let currentSection: SectionKey = 'primary';
  let maxExplicitWeek = 1;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const block = line.match(/^##\s*Block:\s*(.+?)\s*W(\d+)\s*-\s*(\d+)\s*$/i);
    if (block) {
      blocks.push({
        type: normalizeBlock(block[1]),
        startWeek: parseInt(block[2], 10),
        endWeek: parseInt(block[3], 10),
      });
      continue;
    }

    const day = line.match(/^##\s*Day:\s*(.+)$/i);
    if (day) {
      const label = day[1].trim();
      currentDay = { dayKey: slug(label), label, exercises: [] };
      currentSection = 'primary';
      days.push(currentDay);
      continue;
    }

    const section = line.match(/^###\s*(.+)$/);
    if (section) {
      currentSection = normalizeSection(section[1]);
      continue;
    }

    if (line.startsWith('# ')) {
      title = line.slice(2).trim();
      continue;
    }

    const meta = line.match(/^(start|end|weeks)\s*:\s*(.+)$/i);
    if (meta) {
      const key = meta[1].toLowerCase();
      const value = meta[2].trim();
      if (key === 'start') startDate = value;
      else if (key === 'end') endDate = value;
      else if (key === 'weeks') weekCount = parseInt(value, 10) || null;
      continue;
    }

    if (line.startsWith('-') && currentDay) {
      const ex = line.match(/^-\s*(.+?)\s*(?:\[(\w+)\])?\s*(?::\s*(.+))?$/);
      if (!ex) continue;
      const movement = ex[1].trim();
      const draft: DraftExercise = {
        movement,
        section: currentSection,
        primaryMetric: normalizeMetric(ex[2]),
        explicit: {},
      };
      const spec = ex[3]?.trim();
      if (spec) {
        for (const part of spec.split(';')) {
          const p = part.trim();
          if (!p) continue;
          const wm = p.match(/^W(\d+)\s+(.+)$/i);
          if (wm) {
            const w = parseInt(wm[1], 10);
            draft.explicit[w] = wm[2].trim();
            maxExplicitWeek = Math.max(maxExplicitWeek, w);
          } else {
            draft.allValue = p;
          }
        }
      }
      currentDay.exercises.push(draft);
    }
  }

  const maxBlockEnd = blocks.reduce((m, b) => Math.max(m, b.endWeek), 1);
  const maxWeek = weekCount ?? Math.max(maxBlockEnd, maxExplicitWeek, 1);

  if (startDate && weekCount && !endDate) {
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + weekCount * 7 - 1);
    endDate = d.toISOString().slice(0, 10);
  }

  const outDays: PlanDay[] = days.map((d) => ({
    dayKey: d.dayKey,
    label: d.label,
    exercises: d.exercises.map<PlanExercise>((ex) => {
      const plannedByWeek: Record<number, string> = {};
      for (let w = 1; w <= maxWeek; w++) {
        const v = ex.explicit[w] ?? ex.allValue;
        if (v) plannedByWeek[w] = v;
      }
      return {
        movement: ex.movement,
        section: ex.section,
        primaryMetric: ex.primaryMetric,
        plannedByWeek,
      };
    }),
  }));

  return {
    title,
    startDate,
    endDate,
    blocks,
    weeklyTemplate: outDays.map((d) => d.dayKey),
    days: outDays,
  };
}
