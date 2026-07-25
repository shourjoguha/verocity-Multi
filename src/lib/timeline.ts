import type { Plan, PlanDay, WorkoutLog } from '@/lib/types';
import { sessionTagColors } from '@/lib/tags';

// Days of future runway the ribbon always shows past today, so it keeps rolling
// forward (≥10) regardless of whether a plan exists or has ended.
const FUTURE_DAYS = 14;

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
  state: 'done' | 'blank';
  // One entry per logged session = that session's stacked tag colors; [] for blank.
  sessions: string[][];
  // Representative color (first session's first tag) for tint/label; 'transparent' for blank.
  color: string;
  isToday: boolean;
  fullLabel: string;
};

// One point per calendar day across a rolling window: from the ~30th most recent
// logged day (or today − 30d) through today + FUTURE_DAYS, so it always rolls at
// least ~10 days into the future. This is an overall activity ribbon — days with
// a log are "done"; every other day is "blank" (rest) until logged. It does not
// depend on any plan; a plan is used only to give a logged day a nicer label.
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
  const end = new Date(today.getTime() + FUTURE_DAYS * 86_400_000);

  // A plan, when present, only enriches a logged day's label (e.g. "Lower A")
  // via its day_key — it never gates the window or paints future days.
  const planByDayKey = new Map<string, PlanDay>();
  for (const d of plan?.parsed.days ?? []) planByDayKey.set(d.dayKey, d);

  const points: TimelinePoint[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    const dateStr = ymd(cursor);
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
