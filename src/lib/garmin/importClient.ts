// Browser-side GDPR ZIP import (plan §5, §14). Parses the export entirely in the
// browser, normalizes via the shared lib, and POSTs the result to the
// `garmin-ingest` Edge Function over the user's session (functions.invoke
// attaches the JWT). No secret touches the client; the function derives the
// owner from that JWT and writes service-role.
import { supabase } from '@/lib/supabase';
import { buildIngestRequest } from '@/lib/garmin/ingest';
import { parseGarminExport } from '@/lib/garmin/parseExport';

export interface ImportResult {
  ok: boolean;
  error?: string;
  summaries?: number;
  counts?: { raw_events: number; activities: number; health: number };
}

export async function importGarminExport(file: File): Promise<ImportResult> {
  let summaries;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    summaries = parseGarminExport(bytes);
  } catch {
    return { ok: false, error: 'unreadable_zip' };
  }
  if (summaries.length === 0) return { ok: false, error: 'no_summaries' };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authenticated' };

  const request = buildIngestRequest(user.id, 'zip', summaries);
  const { data, error } = await supabase.functions.invoke('garmin-ingest', { body: request });
  if (error) return { ok: false, error: error.message ?? 'ingest_failed' };
  return { ok: true, summaries: summaries.length, counts: data?.counts };
}
