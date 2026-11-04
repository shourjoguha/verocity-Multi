import { PREP_SECTIONS, type MetricKey } from '@/app.config';
import { planWeeks } from '@/lib/planRebase';
import type { ParsedPlan, PlanDay, PlanExercise } from '@/lib/types';

// A compressed, read-only digest of a plan day for the Ready-plan preview:
// each working movement and its typical sets × target across the plan's
// REGULAR weeks. Deload weeks are left out so a 2×5 R5 deload does not widen
// every range; RPE, %, loads, tempo marks and substitutions are dropped.
// Nothing here is used to log or measure — the Logger still reads the plan.

// Program weeks outside any deload block. A plan that is all deload (or has no
// blocks) falls back to every week, so a range is never built from nothing.
export function regularWeeks(plan: ParsedPlan): number[] {
  const all = Array.from({ length: planWeeks(plan) }, (_, i) => i + 1);
  const deload = (w: number) => plan.blocks.some((b) => b.type === 'deload' && w >= b.startWeek && w <= b.endWeek);
  const regular = all.filter((w) => !deload(w));
  return regular.length > 0 ? regular : all;
}

function range(lo: number, hi: number): string {
  return lo === hi ? `${lo}` : `${lo}–${hi}`;
}

// The per-set target in the movement's own unit. Time is stored in seconds.
function target(lo: number, hi: number, metric: MetricKey): string {
  if (metric === 'time') {
    const min = lo % 60 === 0 && hi % 60 === 0;
    return min ? `${range(lo / 60, hi / 60)} min` : `${range(lo, hi)}s`;
  }
  if (metric === 'distance') return `${range(lo, hi)} m`;
  if (metric === 'cal') return `${range(lo, hi)} cal`;
  return range(lo, hi);
}

// "3 × 8–12", "5 × 3–5/side", "1 × 6 min", "3–4 trips". Null when no week
// carries a prescription this can read.
export function compressPrescription(ex: PlanExercise, weeks: number[]): string | null {
  let sMin = Infinity;
  let sMax = -Infinity;
  let rMin = Infinity;
  let rMax = -Infinity;
  let perSide = false;
  let trips: string | null = null;

  for (const w of weeks) {
    const raw = ex.plannedByWeek[w]?.trim();
    if (!raw) continue;
    const m = raw.match(/(\d+)\s*[x×]\s*(\d+)(?:\s*[-–]\s*(\d+))?(\s*\/\s*side)?/i);
    if (m) {
      const sets = +m[1];
      const lo = +m[2];
      const hi = m[3] ? +m[3] : lo;
      sMin = Math.min(sMin, sets);
      sMax = Math.max(sMax, sets);
      rMin = Math.min(rMin, lo);
      rMax = Math.max(rMax, hi);
      perSide ||= Boolean(m[4]);
      continue;
    }
    // Count-only forms such as "x4 trips".
    const c = raw.match(/(?:^|\s)[x×]\s*(\d+)\s*([a-z]+)?/i);
    if (c) {
      sMin = Math.min(sMin, +c[1]);
      sMax = Math.max(sMax, +c[1]);
      trips = c[2] ?? 'sets';
    }
  }

  if (!Number.isFinite(sMin)) return null;
  if (!Number.isFinite(rMin)) return `${range(sMin, sMax)} ${trips}`;
  return `${range(sMin, sMax)} × ${target(rMin, rMax, ex.primaryMetric)}${perSide ? '/side' : ''}`;
}

export interface DayDigest {
  rows: { movement: string; prescription: string | null }[];
  // Warm-up and cooldown items left out of `rows`, so the preview can say so.
  prepCount: number;
}

export function digestDay(day: PlanDay, weeks: number[]): DayDigest {
  const rows: DayDigest['rows'] = [];
  let prepCount = 0;
  for (const ex of day.exercises) {
    if (PREP_SECTIONS.includes(ex.section)) {
      prepCount++;
      continue;
    }
    if (ex.kind === 'subroutine') continue;
    rows.push({ movement: ex.movement, prescription: compressPrescription(ex, weeks) });
  }
  return { rows, prepCount };
}
