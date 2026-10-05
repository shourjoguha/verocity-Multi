// Current logging streak — consecutive Monday-start calendar weeks (ending this
// week, or last week if this one isn't logged yet) with at least one completed
// session. Weeks, not days: a lifter on a 3–4 day split breaks a day streak by
// design every rest day, so the day count only ever read 1 or 2.
// Pure + timezone-injectable for tests. Powers the Home streak chip.
interface DatedLog {
  log_date: string;
  status: string;
}

// Exported because anything comparing a Date against `log_date` must use THIS
// one. `log_date` is a calendar date with no timezone, so a UTC-based key is
// off by a day for anyone west of Greenwich after 00:00 UTC — the streak, the
// Home week rail and the calendar would then disagree about what "today" is.
export function ymdLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Local Monday of the week containing `d`, as a ymdLocal key.
function mondayKey(d: Date): string {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return ymdLocal(m);
}

export function currentWeekStreak(logs: DatedLog[], today: Date = new Date()): number {
  const weeks = new Set<string>();
  for (const l of logs) {
    if (l.status !== 'done' || !l.log_date) continue;
    const [y, m, d] = l.log_date.slice(0, 10).split('-').map(Number);
    weeks.add(mondayKey(new Date(y, m - 1, d)));
  }
  if (weeks.size === 0) return 0;

  // Anchor at this week; if nothing logged yet this week, the streak is still
  // alive through last week. Anything older means it is broken.
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  if (!weeks.has(ymdLocal(cursor))) {
    cursor.setDate(cursor.getDate() - 7);
    if (!weeks.has(ymdLocal(cursor))) return 0;
  }

  let streak = 0;
  while (weeks.has(ymdLocal(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 7);
  }
  return streak;
}
