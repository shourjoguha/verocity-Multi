import { useEffect, useRef, useState } from 'react';
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
  const cached = key ? getCached<T>(key) : undefined;
  const [data, setData] = useState<T | null>(cached ?? null);
  const [loading, setLoading] = useState(cached === undefined);

  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let active = true;

    // Re-seed for THIS key. On the first run this matches what useState already
    // holds and React bails out; on a key change it swaps in that window's
    // cached value, or clears to a spinner when there is nothing cached yet.
    // Without it a new window would keep painting the previous window's numbers
    // while its own request was still in flight.
    const seeded = key ? getCached<T>(key) : undefined;
    setData(seeded ?? null);
    setLoading(seeded === undefined);

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
