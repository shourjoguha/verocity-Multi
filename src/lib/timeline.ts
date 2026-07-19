import type { Plan, PlanDay, WorkoutLog } from '@/lib/types';
import { dayTagFromLabel, sessionTagColors, tagColor } from '@/lib/tags';

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// Local-time YYYY-MM-DD (the ribbon works in the viewer's local calendar).
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// v2 plan-day labels are "<Weekday> — <Type>" (e.g. "Monday — Lower A (Squat-Dominant)").
export function dayNameFromLabel(label: string): string {
  return label.split('—')[0]?.trim() ?? '';
}
export function typeFromLabel(label: string): string {
  const parts = label.split('—');
  return (parts.length > 1 ? parts.slice(1).join('—') : parts[0]).trim() || label;
}

export type TimelinePoint = {
  date: string;
  state: 'done' | 'planned' | 'blank';
  // One entry per logged session = that session's stacked tag colors; [] for planned/blank.
  sessions: string[][];
  // Representative color (first session's first tag, or the planned day's tag) for tint/label.
  color: string;
  isToday: boolean;
  fullLabel: string;
};

// One point per calendar day across a window: from the ~30th most recent logged
// day (or today − 30d) through the plan's end date (or today + 30d). Days with a
// log are "done"; future days whose weekday matches a scheduled plan day are
// "planned"; the rest are "blank" (rest). Mirrors the v1 PLAN PROGRESS ribbon.
export function buildTimeline(
  plan: Plan | null,
  logs: WorkoutLog[],
  now: Date = new Date(),
): TimelinePoint[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayStr = ymd(today);

  const logByDate = new Map<string, WorkoutLog[]>();
  for (const l of logs) {
    if (l.status === 'done' || l.status === 'in_progress') {
      logByDate.set(l.log_date, [...(logByDate.get(l.log_date) ?? []), l]);
    }
  }
  const doneDates = Array.from(logByDate.keys()).sort((a, b) => (a < b ? 1 : -1)); // desc

  const start =
    doneDates.length > 0
      ? new Date(doneDates[Math.min(doneDates.length - 1, 29)] + 'T00:00:00')
      : new Date(today.getTime() - 30 * 86_400_000);
  const end = plan?.end_date
    ? new Date(plan.end_date + 'T00:00:00')
    : new Date(today.getTime() + 30 * 86_400_000);

  const planByWeekday = new Map<string, PlanDay>();
  const planByDayKey = new Map<string, PlanDay>();
  for (const d of plan?.parsed.days ?? []) {
    planByDayKey.set(d.dayKey, d);
    const wd = dayNameFromLabel(d.label).toLowerCase();
    if (wd && !planByWeekday.has(wd)) planByWeekday.set(wd, d);
  }

  const points: TimelinePoint[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    const dateStr = ymd(cursor);
    const weekday = DAY_NAMES[cursor.getDay()].toLowerCase();
    const planDay = planByWeekday.get(weekday);
    const dayLogs = logByDate.get(dateStr);
    const isToday = dateStr === todayStr;

    if (dayLogs && dayLogs.length > 0) {
      const first = dayLogs[0];
      const pd = first.day_key ? planByDayKey.get(first.day_key) : undefined;
      const sessions = dayLogs.map((l) => sessionTagColors(l.tags, l.activity_type));
      const label = pd ? typeFromLabel(pd.label) : (first.activity_type ?? first.tags[0] ?? 'Done');
      points.push({
        date: dateStr,
        state: 'done',
        sessions,
        color: sessions[0][0],
        isToday,
        fullLabel: dayLogs.length > 1 ? `${label} · ×${dayLogs.length}` : label,
      });
    } else if (planDay && cursor.getTime() >= today.getTime()) {
      points.push({
        date: dateStr,
        state: 'planned',
        sessions: [],
        color: tagColor(dayTagFromLabel(planDay.label)),
        isToday,
        fullLabel: typeFromLabel(planDay.label),
      });
    } else {
      points.push({
        date: dateStr,
        state: 'blank',
        sessions: [],
        color: 'transparent',
        isToday,
        fullLabel: 'Rest',
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}
