// Current logging streak — consecutive calendar days (ending today, or
// yesterday if today isn't logged yet) with at least one completed session.
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

export function currentStreak(logs: DatedLog[], today: Date = new Date()): number {
  const days = new Set<string>();
  for (const l of logs) {
    if (l.status === 'done' && l.log_date) days.add(l.log_date.slice(0, 10));
  }
  if (days.size === 0) return 0;

  // Anchor at today; if nothing logged today, the streak may still be alive
  // through yesterday. Anything older means the streak is broken.
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!days.has(ymdLocal(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(ymdLocal(cursor))) return 0;
  }

  let streak = 0;
  while (days.has(ymdLocal(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
