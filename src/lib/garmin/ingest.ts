// Garmin ingest request builder — pure, source-agnostic (plan §5, §6, §14).
//
// Every ingestion source (the GDPR "Export All Data" ZIP importer, the
// unofficial daily client, and the eventual official push) runs the SAME shared
// normalizer (normalize.ts) and hands the result to the `garmin-ingest` Edge
// Function, which is the single service-role writer of the Garmin tables. This
// module is the adapter-side half of that contract: it turns a batch of raw
// Garmin summaries into the typed `GarminIngestRequest` payload that gets POSTed
// to the function.
//
// Keeping composition here (not in the function) means normalization and
// projection live in ONE place — the Node/TS world that can import app.config —
// while the Deno function stays a thin persistence layer that mirrors the
// request shape. The function never re-derives domain config (tags, units); it
// only writes what this builder produced.

import {
  mergeHealthDaily,
  normalizeActivity,
  normalizeDailySummary,
  normalizeSleep,
  projectActivityToLog,
  type NormalizedActivity,
  type NormalizedHealthDaily,
  type ProjectedLog,
  type RawRecord,
} from '@/lib/garmin/normalize';

// Which adapter produced the batch (mirrors garmin_raw_events.source).
export type GarminSource = 'zip' | 'client' | 'webhook';

// The three summary kinds we map today (mirrors the migration comment:
// 'activity' | 'daily' | 'sleep'). Unknown kinds are ignored but their raw JSON
// is still landed for later replay.
export type GarminSummaryType = 'activity' | 'daily' | 'sleep';

// One raw Garmin summary as handed to the importer/worker.
export interface RawSummaryInput {
  summary_type: GarminSummaryType;
  payload: RawRecord;
}

// A raw summary as it lands in garmin_raw_events (untouched JSON + a stable,
// per-summary idempotency key).
export interface RawEvent {
  summary_type: GarminSummaryType;
  summary_id: string;
  payload: RawRecord;
}

// A normalized activity paired with its pre-computed workout_logs projection.
// The function upserts `activity`, then links `log` to the new
// garmin_activities.id (the surrogate id only exists post-insert).
export interface IngestActivity {
  activity: NormalizedActivity;
  log: ProjectedLog | null;
}

// The payload POSTed to the `garmin-ingest` Edge Function. The function mirrors
// this shape in Deno (the `@/` alias can't cross the runtime boundary).
export interface GarminIngestRequest {
  owner_user_id: string;
  source: GarminSource;
  raw_events: RawEvent[];
  activities: IngestActivity[];
  health: NormalizedHealthDaily[];
}

/**
 * Build the ingest request for a batch of raw summaries. Pure: no I/O, no
 * config beyond the shared normalizer. Activities are normalized + projected;
 * dated health summaries (daily + sleep) are merged to one row per calendar
 * date. Every summary that yields a stable id also lands a raw event for the
 * audit log / replay; summaries the normalizer can't place (no id, no date) are
 * skipped entirely so they never produce a half-written row.
 */
export function buildIngestRequest(
  ownerUserId: string,
  source: GarminSource,
  summaries: RawSummaryInput[],
): GarminIngestRequest {
  const raw_events: RawEvent[] = [];
  const activities: IngestActivity[] = [];
  const healthPartials: NormalizedHealthDaily[] = [];

  for (const { summary_type, payload } of summaries) {
    if (summary_type === 'activity') {
      const activity = normalizeActivity(payload);
      if (!activity) continue;
      raw_events.push({ summary_type, summary_id: activity.provider_activity_id, payload });
      activities.push({ activity, log: projectActivityToLog(activity) });
      continue;
    }

    const health =
      summary_type === 'sleep' ? normalizeSleep(payload) : normalizeDailySummary(payload);
    if (!health) continue;
    // The summary_type disambiguates the daily and sleep rows that share a date,
    // so the same night's sleep and day's wellness keep distinct audit rows.
    raw_events.push({ summary_type, summary_id: `${health.calendar_date}:${summary_type}`, payload });
    healthPartials.push(health);
  }

  return {
    owner_user_id: ownerUserId,
    source,
    raw_events,
    activities,
    health: mergeHealthDaily(healthPartials),
  };
}
