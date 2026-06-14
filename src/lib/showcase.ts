// Single source of truth for the public showcase window.
//
// The anon RLS policy on workout_logs (migration 0009) caps anon-visible rows to
// exactly this date range, so a first-time visitor sees a tidy block of recent
// training rather than the owner's full (and incidental) history. The frontend
// reuses these dates so the read-only views land on the right month / lookback
// window regardless of the real calendar date — the showcase is a fixed
// historical demo, not "today".
export const SHOWCASE_WINDOW = {
  start: '2026-04-20',
  end: '2026-04-29',
} as const;

// Reference "now" for showcase views: the last day of the window. Anchoring
// date math here (instead of `new Date()`) keeps the showcase timeless.
export function showcaseRefDate(): Date {
  return new Date(`${SHOWCASE_WINDOW.end}T00:00:00Z`);
}

// First-of-month (UTC) for the window — the month the showcase calendar opens on.
export function showcaseMonthStart(): Date {
  const d = showcaseRefDate();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
