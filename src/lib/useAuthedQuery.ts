import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getCached, setCached } from '@/lib/queryCache';

// Guards auth (redirects to /login if no session) then runs the loader against
// the authenticated client. Shared by the read-path islands. Pass `auth: false`
// for the read-only showcase, which has no session and loads via the anon
// (public) client — the guard would otherwise bounce the visitor to /login.
//
// Pass `key` to opt into the stale-while-revalidate cache (queryCache): a
// revisited tab paints last-known data immediately (no spinner) while the
// loader revalidates in the background. Omit `key` for uncached behaviour.
//
// THE KEY IS ALSO THE IDENTITY OF THE QUERY, not just a cache slot. The effect
// re-runs when it changes, which is what makes a caller that varies its key —
// `body:logs:${windowKey}` on /app/body — actually refetch when the user picks a
// different window. It used to run on mount only (`[]`), so /app/body loaded one
// window and then never moved: toggling 4w/8w/6mo recomputed nothing, because
// the logs behind it were still the first window's. A caller whose key is a
// constant, which is every other one, is unaffected.
//
// `loader` is deliberately NOT a dependency. Callers pass an inline arrow, so it
// is a new function on every render and depending on it would refetch forever;
// the ref keeps the effect reading the latest closure without re-running for it.
export function useAuthedQuery<T>(
  loader: () => Promise<T>,
  { auth = true, key }: { auth?: boolean; key?: string } = {},
): { data: T | null; loading: boolean } {
  // The first render is ALWAYS the loading state, never the cache. These
  // islands are server-rendered, and the server has no cache, so it renders
  // loading; seeding `useState` from the cache made the first client render
  // differ on every revisit, which is React #418 — React discards the server
  // HTML and re-renders the root from scratch. The layout effect below seeds
  // after hydration and before the browser paints, so a revisit still shows
  // cached data on its first painted frame.
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  // Seed for THIS key. On a key change it swaps in that window's cached value,
  // or clears to a spinner when there is nothing cached yet. Without it a new
  // window would keep painting the previous window's numbers while its own
  // request was still in flight.
  useLayoutEffect(() => {
    const seeded = key ? getCached<T>(key) : undefined;
    setData(seeded ?? null);
    setLoading(seeded === undefined);
  }, [key]);

  useEffect(() => {
    let active = true;

    (async () => {
      if (auth) {
        const { data: session } = await supabase.auth.getSession();
        if (!session.session) {
          window.location.href = '/login';
          return;
        }
      }
      const result = await loaderRef.current();
      if (!active) return;
      if (key) setCached(key, result);
      setData(result);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [key, auth]);

  return { data, loading };
}
