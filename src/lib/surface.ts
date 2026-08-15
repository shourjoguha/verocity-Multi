import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase, supabasePublic } from '@/lib/supabase';
import { SHOWCASE_ALIAS } from '@/lib/showcase';
import { GROUPS } from '@/lib/appNav';

// Which surface a page is: the private app, or the public read-only showcase.
//
// THIS MODULE EXISTS TO STOP THE SHOWCASE DRIFTING. It used to be a parallel
// implementation — five hand-written pages against the app's seventeen, a
// second nav and ribbon hardcoded in App.astro, and thirty-odd
// `mode === 'app'` branches hiding features that read perfectly well read-only.
// Every one of those was a place someone had to remember to mirror, and nobody
// did, which is why the public showcase was months behind the app.
//
// So: one definition of the surface, one list of what exists on it, one place
// that decides which Supabase client to use, and one place that redacts the
// name. A new page or component inherits all four.

export type Surface = 'app' | 'showcase';

export const APP_BASE = '/app';
export const SHOWCASE_BASE = '/showcase';

/**
 * The app paths that also exist on the showcase, as app hrefs.
 *
 * This is the single source shared by the route map
 * (`src/pages/showcase/[...slug].astro`) and the nav in `App.astro`, so a
 * destination can never be routable-but-unlinked or linked-but-404.
 *
 * Everything absent here is either a write flow (the Logger, plan upload/edit,
 * onboarding, activity) or outside the showcase's data scope — `/app/meals`
 * and `/app/you` read `meal_logs` / `user_stats`, which have no anon policy by
 * design (migrations 0032 and 0020), and `/app/coach` is deliberately private.
 */
export const SHOWCASE_ROUTES = [
  '/app',
  '/app/plan',
  '/app/sessions',
  '/app/session',
  '/app/library',
  '/app/stats',
  '/app/body',
] as const;

export function surfaceForPath(pathname: string): Surface {
  const path = pathname.replace(/\/+$/, '') || '/';
  return path === SHOWCASE_BASE || path.startsWith(`${SHOWCASE_BASE}/`) ? 'showcase' : 'app';
}

/**
 * The surface the browser is currently on.
 *
 * The SSR answer is always 'app', because Astro pre-renders islands with no
 * location. That is a deliberate fallback rather than a bug: a component whose
 * FIRST PAINT differs by surface must still be handed `mode`/`readOnly`
 * explicitly from the page (Astro knows the surface at build time via
 * `Astro.url`), or it will hydrate into different markup than it rendered.
 * This function is the safety net for everything below that — components deep
 * in a tree that nobody thought to thread a prop to.
 */
export function currentSurface(): Surface {
  if (typeof window === 'undefined') return 'app';
  return surfaceForPath(window.location.pathname);
}

export function isReadOnly(surface: Surface = currentSurface()): boolean {
  return surface === 'showcase';
}

/**
 * The Supabase client for a surface. The showcase gets the session-less anon
 * client, so it resolves to the `anon` role even for a signed-in viewer and RLS
 * scopes it to the showcase profile (SPEC §7A). RLS is the boundary — this
 * choice is about which rows come back, never about permission.
 */
export function clientFor(surface: Surface = currentSurface()): SupabaseClient {
  return surface === 'showcase' ? supabasePublic : supabase;
}

/** Rewrite an app href onto the current surface. `/app/plan` → `/showcase/plan`. */
export function hrefFor(appHref: string, surface: Surface = currentSurface()): string {
  if (surface === 'app') return appHref;
  if (appHref === APP_BASE) return SHOWCASE_BASE;
  return appHref.startsWith(`${APP_BASE}/`)
    ? `${SHOWCASE_BASE}${appHref.slice(APP_BASE.length)}`
    : appHref;
}

/** Does this app href have a showcase counterpart? */
export function existsOnShowcase(appHref: string): boolean {
  return (SHOWCASE_ROUTES as readonly string[]).includes(appHref.split('?')[0]);
}

/**
 * The name to print. The showcase is served to anyone with the URL, so it never
 * renders the owner's real `display_name` — and now that the whole app renders
 * there, that redaction has to live in one place rather than at each call site.
 */
export function displayNameFor(
  displayName: string | null | undefined,
  surface: Surface = currentSurface(),
): string {
  if (surface === 'showcase') return SHOWCASE_ALIAS;
  return displayName ?? 'Athlete';
}

/**
 * The nav groups for a surface, derived from the app's own `GROUPS` so a new
 * tab appears on both at once. On the showcase a tab with no counterpart is
 * kept and marked `readOnly` rather than dropped — the chrome is meant to match
 * the app, so the slot stays and the action is inert.
 */
export type SurfaceTab = { key: string; label: string; href: string; readOnly: boolean };

export function groupTabsFor(group: keyof typeof GROUPS, surface: Surface): SurfaceTab[] {
  return GROUPS[group].tabs.map((t) => ({
    key: t.key,
    label: t.label,
    href: surface === 'showcase' && !existsOnShowcase(t.href) ? '#' : hrefFor(t.href, surface),
    readOnly: surface === 'showcase' && !existsOnShowcase(t.href),
  }));
}
