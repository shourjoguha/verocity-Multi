// The public showcase's identity.
//
// This used to also pin a fixed date window (SHOWCASE_WINDOW / showcaseRefDate
// / showcaseMonthStart), mirroring an RLS clamp that froze anon-visible logs to
// 2026-04-20…2026-04-29. The showcase is now a LIVE read-only mirror of the app
// (migration 0034 replaced that date clamp with `status <> 'cancelled'`), so
// every showcase surface uses a real `new Date()` exactly like the app does and
// there is nothing left here to keep in sync with the database.

// The public identity. /showcase is served to anyone with the URL, so it never
// prints the owner's real `profiles.display_name` — it prints this instead. The
// rows are still the real profile's (plan, logs, stats are the owner's); only
// the rendered name is swapped.
//
// Read it through `displayNameFor()` in `src/lib/surface.ts` rather than
// directly: now that the whole app renders on the showcase, the redaction has
// to happen in one place rather than at each call site that shows a name.
export const SHOWCASE_ALIAS = 'Zeus';
