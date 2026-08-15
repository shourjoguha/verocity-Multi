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

// The public identity. /showcase is served to anyone with the URL, so it never
// prints the owner's real `profiles.display_name` — it prints this instead. The
// row is still the real profile (plan, logs, stats are the owner's); only the
// rendered name is swapped. Every showcase surface must read THIS, never
// `profile.display_name`.
export const SHOWCASE_ALIAS = 'Zeus';

// The short film behind the hero's "Watch the reel" control. Plain files under
// public/, so there is no player dependency and no third-party request from the
// public page. Both are optional at build time: ShowcaseReel degrades to a
// "not up yet" line if the video 404s, so shipping the code before the asset is
// safe.
export const SHOWCASE_REEL = {
  src: '/showcase/reel.mp4',
  poster: '/showcase/reel-poster.jpg',
} as const;
