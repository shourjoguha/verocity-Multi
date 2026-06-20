// Garmin ingest writer (plan §6, §14). The SINGLE service-role writer of the
// Garmin tables: every source adapter (the GDPR ZIP importer, the unofficial
// daily client, the eventual official webhook) normalizes its raw summaries with
// the shared lib (src/lib/garmin/ingest.ts → buildIngestRequest) and POSTs the
// resulting GarminIngestRequest here. This function does pure persistence — it
// re-derives no domain config (tags/units already baked into the payload) — and
// every write is idempotent so re-importing an export, or overlapping daily
// windows, converges instead of duplicating.
//
// Auth has two modes (see the handler): the browser GDPR-ZIP import calls with
// the user's JWT (owner = the authenticated user; a client-supplied owner is
// never trusted, and the shared secret is never shipped to the browser), while
// the server worker / official webhook calls with a shared secret header
// (x-garmin-ingest-secret) and names the owner in the body. Writes are always
// service-role because the Garmin tables are service-role-write-only.
//
// NEEDS MIGRATIONS 0013 + 0014 APPLIED to run end-to-end: it writes
// garmin_raw_events, garmin_activities, garmin_health_daily, the workout_logs
// projection (source/garmin_activity_id columns), and garmin_connections.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-garmin-ingest-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ---- request shape (mirrors src/lib/garmin/ingest.ts; the `@/` alias can't
// cross the Node→Deno boundary, so the contract is duplicated as a type here and
// kept in sync by hand). ----
type GarminSource = 'zip' | 'client' | 'webhook';
type SummaryType = 'activity' | 'daily' | 'sleep';

interface RawEvent {
  summary_type: SummaryType;
  summary_id: string;
  payload: Record<string, unknown>;
}
interface NormalizedActivity {
  provider_activity_id: string;
  activity_type: string | null;
  start_time: string | null;
  duration_seconds: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  avg_speed: number | null;
  elevation_gain_m: number | null;
  garmin_updated_at: string | null;
  raw: Record<string, unknown>;
}
interface ProjectedLog {
  log_date: string;
  status: 'done';
  activity_type: string | null;
  tags: string[];
  total_seconds: number | null;
  hr_avg: number | null;
  hr_max: number | null;
  source: 'garmin';
  data: Record<string, unknown>;
}
interface IngestActivity {
  activity: NormalizedActivity;
  log: ProjectedLog | null;
}
interface NormalizedHealthDaily {
  calendar_date: string;
  resting_hr: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  hrv_ms: number | null;
  stress_avg: number | null;
  body_battery_high: number | null;
  body_battery_low: number | null;
  sleep_seconds: number | null;
  sleep_score: number | null;
  deep_sleep_seconds: number | null;
  rem_sleep_seconds: number | null;
  light_sleep_seconds: number | null;
  awake_seconds: number | null;
  respiration_avg: number | null;
  spo2_avg: number | null;
  steps: number | null;
  calories: number | null;
  vo2max: number | null;
  garmin_updated_at: string | null;
  raw: Record<string, unknown>;
}
interface GarminIngestRequest {
  owner_user_id: string;
  source: GarminSource;
  raw_events: RawEvent[];
  activities: IngestActivity[];
  health: NormalizedHealthDaily[];
}

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// Land the untouched summaries for replay/audit. Idempotent on
// (owner, summary_type, summary_id) — re-imports converge to one row.
async function writeRawEvents(admin: SupabaseClient, ownerId: string, source: GarminSource, events: RawEvent[]) {
  if (events.length === 0) return;
  const rows = events.map((e) => ({
    owner_user_id: ownerId,
    source,
    summary_type: e.summary_type,
    summary_id: e.summary_id,
    payload: e.payload,
    status: 'processed',
    processed_at: new Date().toISOString(),
  }));
  const { error } = await admin
    .from('garmin_raw_events')
    .upsert(rows, { onConflict: 'owner_user_id,summary_type,summary_id' });
  if (error) throw new Error(`raw_events: ${error.message}`);
}

// Upsert normalized activities and return their surrogate ids keyed by provider
// id, so the workout_logs projection can link back.
async function writeActivities(
  admin: SupabaseClient,
  ownerId: string,
  items: IngestActivity[],
): Promise<Map<string, string>> {
  const byProvider = new Map<string, string>();
  if (items.length === 0) return byProvider;
  const rows = items.map(({ activity }) => ({ owner_user_id: ownerId, ...activity }));
  const { data, error } = await admin
    .from('garmin_activities')
    .upsert(rows, { onConflict: 'owner_user_id,provider_activity_id' })
    .select('id, provider_activity_id');
  if (error) throw new Error(`activities: ${error.message}`);
  for (const row of data ?? []) byProvider.set(row.provider_activity_id, row.id);
  return byProvider;
}

// Project each activity into a workout_logs row keyed by garmin_activity_id (one
// log per activity). The unique index on garmin_activity_id is PARTIAL (WHERE
// NOT NULL), which supabase-js upsert can't target, so split insert/update by
// hand against the ids we already hold.
async function writeProjectedLogs(
  admin: SupabaseClient,
  ownerId: string,
  items: IngestActivity[],
  activityIdByProvider: Map<string, string>,
) {
  const pending = items
    .map(({ activity, log }) => {
      const activityId = activityIdByProvider.get(activity.provider_activity_id);
      return log && activityId ? { activityId, log } : null;
    })
    .filter((x): x is { activityId: string; log: ProjectedLog } => x !== null);
  if (pending.length === 0) return;

  const { data: existing, error: selErr } = await admin
    .from('workout_logs')
    .select('id, garmin_activity_id')
    .eq('owner_user_id', ownerId)
    .in('garmin_activity_id', pending.map((p) => p.activityId));
  if (selErr) throw new Error(`logs lookup: ${selErr.message}`);
  const logIdByActivity = new Map<string, string>(
    (existing ?? []).map((r) => [r.garmin_activity_id as string, r.id as string]),
  );

  const inserts: Record<string, unknown>[] = [];
  for (const { activityId, log } of pending) {
    const row = { owner_user_id: ownerId, garmin_activity_id: activityId, ...log };
    const existingId = logIdByActivity.get(activityId);
    if (existingId) {
      const { error } = await admin.from('workout_logs').update(row).eq('id', existingId);
      if (error) throw new Error(`log update: ${error.message}`);
    } else {
      inserts.push(row);
    }
  }
  if (inserts.length > 0) {
    const { error } = await admin.from('workout_logs').insert(inserts);
    if (error) throw new Error(`log insert: ${error.message}`);
  }
}

// Upsert merged daily health, one row per (owner, calendar_date).
async function writeHealthDaily(admin: SupabaseClient, ownerId: string, rows: NormalizedHealthDaily[]) {
  if (rows.length === 0) return;
  const withOwner = rows.map((r) => ({ owner_user_id: ownerId, ...r }));
  const { error } = await admin
    .from('garmin_health_daily')
    .upsert(withOwner, { onConflict: 'owner_user_id,calendar_date' });
  if (error) throw new Error(`health_daily: ${error.message}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: GarminIngestRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (!['zip', 'client', 'webhook'].includes(body.source)) return json({ error: 'invalid_source' }, 400);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Two callers, two auth modes — the writes are always service-role (the tables
  // are service-role-write-only), but WHO the rows belong to is established here:
  //  • Browser ZIP import → the user's JWT (Authorization: Bearer). The owner is
  //    the authenticated user; a client-supplied owner_user_id is NEVER trusted.
  //  • Server worker / official webhook → a shared secret header, acting on
  //    behalf of the user whose id is in the body.
  const secret = Deno.env.get('GARMIN_INGEST_SECRET');
  const isServer = !!secret && req.headers.get('x-garmin-ingest-secret') === secret;

  let ownerId: string;
  if (isServer) {
    if (!isUuid(body.owner_user_id)) return json({ error: 'invalid_owner' }, 400);
    ownerId = body.owner_user_id;
  } else {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return json({ error: 'unauthorized' }, 401);
    const { data: userData, error: authErr } = await admin.auth.getUser(jwt);
    if (authErr || !userData.user) return json({ error: 'unauthorized' }, 401);
    ownerId = userData.user.id;
  }

  try {
    await writeRawEvents(admin, ownerId, body.source, body.raw_events ?? []);
    const activityIds = await writeActivities(admin, ownerId, body.activities ?? []);
    await writeProjectedLogs(admin, ownerId, body.activities ?? [], activityIds);
    await writeHealthDaily(admin, ownerId, body.health ?? []);

    // Best-effort sync watermark; never fails the ingest.
    await admin
      .from('garmin_connections')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('owner_user_id', ownerId);
  } catch (err) {
    return json({ error: 'ingest_failed', detail: String(err instanceof Error ? err.message : err) }, 500);
  }

  return json({
    ok: true,
    counts: {
      raw_events: (body.raw_events ?? []).length,
      activities: (body.activities ?? []).length,
      health: (body.health ?? []).length,
    },
  });
});
