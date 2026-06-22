import { useEffect, useState } from 'react';
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
export function useAuthedQuery<T>(
  loader: () => Promise<T>,
  { auth = true, key }: { auth?: boolean; key?: string } = {},
): { data: T | null; loading: boolean } {
  const cached = key ? getCached<T>(key) : undefined;
  const [data, setData] = useState<T | null>(cached ?? null);
  const [loading, setLoading] = useState(cached === undefined);

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
      const result = await loader();
      if (!active) return;
      if (key) setCached(key, result);
      setData(result);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { data, loading };
}
