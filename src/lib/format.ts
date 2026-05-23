import { UNITS } from '@/app.config';

// "1h 23m" / "45m" / "30s"
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (!totalSeconds || totalSeconds < 0) return '—';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

export function formatWeight(kg: number | null | undefined): string {
  if (kg == null) return '—';
  const n = Number.isInteger(kg) ? kg : Math.round(kg * 10) / 10;
  return `${n} ${UNITS.weight}`;
}

export function formatRound(n: number | null | undefined, digits = 0): string {
  if (n == null) return '—';
  const f = 10 ** digits;
  return String(Math.round(n * f) / f);
}

// "May 23" / "May 23, 2025" when not the current year.
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
    timeZone: 'UTC',
  });
}
