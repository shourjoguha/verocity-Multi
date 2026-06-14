import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// Guards auth (redirects to /login if no session) then runs the loader against
// the authenticated client. Shared by the read-path islands. Pass `auth: false`
// for the read-only showcase, which has no session and loads via the anon
// (public) client — the guard would otherwise bounce the visitor to /login.
export function useAuthedQuery<T>(
  loader: () => Promise<T>,
  { auth = true }: { auth?: boolean } = {},
): { data: T | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

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
