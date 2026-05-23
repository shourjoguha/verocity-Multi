const MS_PER_DAY = 86_400_000;

function atUtcMidnight(date: string | Date): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// 1-based program week for a date relative to the plan start (min 1).
export function weekFromDate(startDate: string | null, date: string | Date): number {
  if (!startDate) return 1;
  const days = Math.floor((atUtcMidnight(date) - atUtcMidnight(startDate)) / MS_PER_DAY);
  return Math.max(1, Math.floor(days / 7) + 1);
}

// Whole days between two dates (b - a).
export function daysBetween(a: string | Date, b: string | Date): number {
  return Math.round((atUtcMidnight(b) - atUtcMidnight(a)) / MS_PER_DAY);
}
