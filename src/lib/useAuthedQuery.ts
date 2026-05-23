import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// Guards auth (redirects to /login if no session) then runs the loader against
// the authenticated client. Shared by the read-path islands.
export function useAuthedQuery<T>(loader: () => Promise<T>): { data: T | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        window.location.href = '/login';
        return;
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
