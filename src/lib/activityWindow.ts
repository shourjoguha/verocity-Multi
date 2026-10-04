// Pure helpers behind Home's activity block (ActivityStrip in ProfileView.tsx):
// slicing the timeline to a chosen window, and bucketing it into weeks once a
// column per day would be too thin to read.

import { ymd, type TimelinePoint } from '@/lib/timeline';

export type WeekColumn = {
  start: string;
  end: string;
  seconds: number;
  sessions: number;
  // Dominant tag colour by logged time; null for a week with nothing logged.
  color: string | null;
  isCurrent: boolean;
};

// Seven-day buckets counted back from today, so the last bucket always ends on
// today rather than on a calendar week boundary.
export function toWeeks(points: TimelinePoint[]): WeekColumn[] {
  const weeks: WeekColumn[] = [];
  for (let end = points.length; end > 0; end -= 7) {
    const chunk = points.slice(Math.max(0, end - 7), end);
    const weight = new Map<string, number>();
    let seconds = 0;
    let sessions = 0;
    for (const p of chunk) {
      p.sessions.forEach((colors, si) => {
        const s = p.sessionSeconds[si] || 1;
        for (const c of colors) weight.set(c, (weight.get(c) ?? 0) + s / colors.length);
        sessions += 1;
      });
      seconds += p.seconds;
    }
    let color: string | null = null;
    let best = 0;
    for (const [c, w] of weight) {
      if (w > best) {
        best = w;
        color = c;
      }
    }
    weeks.unshift({
      start: chunk[0].date,
      end: chunk[chunk.length - 1].date,
      seconds,
      sessions,
      color,
      isCurrent: weeks.length === 0,
    });
  }
  return weeks;
}

// The last `days` points ending today, padded with rest days at the front when
// the history is shorter than the window — a 12-week window over three weeks of
// logs should still read as twelve weeks, most of them empty.
export function windowPoints(points: TimelinePoint[], days: number | null): TimelinePoint[] {
  if (days == null || points.length >= days) return days == null ? points : points.slice(-days);
  const pad: TimelinePoint[] = [];
  const first = new Date((points[0]?.date ?? ymd(new Date())) + 'T00:00:00');
  for (let i = days - points.length; i > 0; i--) {
    const d = new Date(first);
    d.setDate(d.getDate() - i);
    pad.push({
      date: ymd(d),
      state: 'blank',
      sessions: [],
      sessionSeconds: [],
      seconds: 0,
      color: 'transparent',
      isToday: false,
      fullLabel: 'Rest',
    });
  }
  return [...pad, ...points];
}
