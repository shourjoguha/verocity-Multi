// Pure, immutable edits on a ParsedPlan, used by the plan editor. dayKey stays
// stable across label edits (workout_logs.day_key references it); weeklyTemplate
// is kept in sync with day order.
import type { MetricKey, SectionKey } from '@/app.config';
import type { ParsedPlan, PlanDay, PlanExercise } from '@/lib/types';

export function reorder<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
  const next = arr.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function withDays(plan: ParsedPlan, days: PlanDay[]): ParsedPlan {
  return { ...plan, days, weeklyTemplate: days.map((d) => d.dayKey) };
}

function mapDay(plan: ParsedPlan, di: number, fn: (d: PlanDay) => PlanDay): ParsedPlan {
  return withDays(plan, plan.days.map((d, i) => (i === di ? fn(d) : d)));
}

function mapExercise(plan: ParsedPlan, di: number, ei: number, fn: (e: PlanExercise) => PlanExercise): ParsedPlan {
  return mapDay(plan, di, (d) => ({ ...d, exercises: d.exercises.map((e, i) => (i === ei ? fn(e) : e)) }));
}

export function setTitle(plan: ParsedPlan, title: string): ParsedPlan {
  return { ...plan, title };
}

export function setDayLabel(plan: ParsedPlan, di: number, label: string): ParsedPlan {
  return mapDay(plan, di, (d) => ({ ...d, label }));
}

export function moveDay(plan: ParsedPlan, from: number, to: number): ParsedPlan {
  return withDays(plan, reorder(plan.days, from, to));
}

export function removeDay(plan: ParsedPlan, di: number): ParsedPlan {
  return withDays(plan, plan.days.filter((_, i) => i !== di));
}

export function addDay(plan: ParsedPlan): ParsedPlan {
  const existing = new Set(plan.days.map((d) => d.dayKey));
  let n = plan.days.length + 1;
  let key = `day-${n}`;
  while (existing.has(key)) key = `day-${++n}`;
  const day: PlanDay = { dayKey: key, label: `Day ${n}`, exercises: [] };
  return withDays(plan, [...plan.days, day]);
}

export function addExercise(
  plan: ParsedPlan,
  di: number,
  movement = '',
  section: SectionKey = 'accessory',
  primaryMetric: MetricKey = 'weight',
): ParsedPlan {
  const ex: PlanExercise = { movement, section, primaryMetric, plannedByWeek: {} };
  return mapDay(plan, di, (d) => ({ ...d, exercises: [...d.exercises, ex] }));
}

export function removeExercise(plan: ParsedPlan, di: number, ei: number): ParsedPlan {
  return mapDay(plan, di, (d) => ({ ...d, exercises: d.exercises.filter((_, i) => i !== ei) }));
}

export function moveExercise(plan: ParsedPlan, di: number, from: number, to: number): ParsedPlan {
  return mapDay(plan, di, (d) => ({ ...d, exercises: reorder(d.exercises, from, to) }));
}

export function setExerciseMovement(plan: ParsedPlan, di: number, ei: number, movement: string): ParsedPlan {
  return mapExercise(plan, di, ei, (e) => ({ ...e, movement }));
}

export function setExerciseSection(plan: ParsedPlan, di: number, ei: number, section: SectionKey): ParsedPlan {
  return mapExercise(plan, di, ei, (e) => ({ ...e, section }));
}

// Set (or clear, when blank) a week's planned-set string for an exercise.
export function setPlanned(plan: ParsedPlan, di: number, ei: number, week: number, value: string): ParsedPlan {
  return mapExercise(plan, di, ei, (e) => {
    const plannedByWeek = { ...e.plannedByWeek };
    if (value.trim()) plannedByWeek[week] = value;
    else delete plannedByWeek[week];
    return { ...e, plannedByWeek };
  });
}

// Highest week referenced by blocks or any planned cell (min 1).
export function planWeeks(plan: ParsedPlan): number {
  return Math.max(
    1,
    ...plan.blocks.map((b) => b.endWeek),
    ...plan.days.flatMap((d) => d.exercises.flatMap((e) => Object.keys(e.plannedByWeek).map(Number))),
  );
}
