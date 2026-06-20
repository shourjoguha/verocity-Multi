// Browser calls to the garmin-connect Edge Function (plan §6, §14B). Credentials
// go straight to the function over the user's session (functions.invoke attaches
// the JWT); they are never stored client-side and the function never returns a
// token — only a status.
import { supabase } from '@/lib/supabase';

export interface ConnectResult {
  ok: boolean;
  status?: string;
  error?: string;
}

async function call(body: Record<string, unknown>): Promise<ConnectResult> {
  const { data, error } = await supabase.functions.invoke('garmin-connect', { body });
  if (error) {
    // Pull the function's {error: code} body out of the non-2xx response.
    let code = 'request_failed';
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        code = (await ctx.json())?.error ?? code;
      } catch {
        /* keep request_failed */
      }
    }
    return { ok: false, error: code };
  }
  return { ok: true, status: data?.status };
}

export function connectGarmin(email: string, password: string): Promise<ConnectResult> {
  return call({ action: 'connect', email, password });
}

export function disconnectGarmin(): Promise<ConnectResult> {
  return call({ action: 'disconnect' });
}
