// Garmin "Export All Data" (GDPR) ZIP parser — pure, tolerant (plan §5, §14).
//
// Garmin's self-service export is a ZIP of JSON files under nested, version-
// dependent folder names (DI_CONNECT/DI-Connect-Fitness, .../DI-Connect-Wellness,
// …). Rather than hard-code those paths — which drift between exports — this
// classifies each JSON record by its SHAPE (with the filename as a weak hint),
// so the same parser survives layout changes. Every record is flattened to a
// RawSummaryInput tagged 'activity' | 'daily' | 'sleep'; the downstream
// buildIngestRequest runs the shared normalizer over them.
//
// UNVERIFIED AGAINST A REAL EXPORT: the shape predicates below are derived from
// the documented field names (and mirror normalize.ts's alias lists). On the
// first real export, widen the predicates / filename hints here — the normalizer
// already tolerates extra fields, so only the routing needs tuning.

import { unzipSync, strFromU8 } from 'fflate';
import type { RawSummaryInput, GarminSummaryType } from '@/lib/garmin/ingest';
import type { RawRecord } from '@/lib/garmin/normalize';

// Known wrapper key in the activities export file: an array element shaped
// `{ summarizedActivitiesExport: [ {activity…} ] }`.
const ACTIVITY_WRAPPER_KEYS = ['summarizedActivitiesExport'];

function isRecord(v: unknown): v is RawRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---- shape predicates (routing only; the normalizer does the real mapping) ----

function looksLikeActivity(o: RawRecord): boolean {
  return (
    'activityId' in o ||
    'activityType' in o ||
    'activityTypeKey' in o ||
    ('summaryId' in o && ('durationInSeconds' in o || 'distanceInMeters' in o))
  );
}

function looksLikeSleep(o: RawRecord): boolean {
  return (
    'sleepTimeSeconds' in o ||
    'deepSleepSeconds' in o ||
    'remSleepSeconds' in o ||
    'sleepScores' in o ||
    'overallSleepScore' in o
  );
}

function looksLikeDaily(o: RawRecord): boolean {
  const dated = 'calendarDate' in o || 'calendar_date' in o;
  return (
    dated &&
    ('restingHeartRate' in o ||
      'totalSteps' in o ||
      'steps' in o ||
      'totalKilocalories' in o ||
      'averageStressLevel' in o ||
      'bodyBatteryHighestValue' in o ||
      'averageSpo2' in o)
  );
}

function classify(o: RawRecord): GarminSummaryType | null {
  // Sleep before daily: a sleep record can also carry a calendarDate.
  if (looksLikeActivity(o)) return 'activity';
  if (looksLikeSleep(o)) return 'sleep';
  if (looksLikeDaily(o)) return 'daily';
  return null;
}

// ---- record extraction ----

// Flatten one parsed JSON file to candidate summary records. Files come as: a
// bare array of summaries, an object wrapping a single array (the export's
// common shape), or a lone object. Activity wrappers are unwrapped explicitly.
function recordsFromJson(parsed: unknown): RawRecord[] {
  const out: RawRecord[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const el of node) visit(el);
      return;
    }
    if (!isRecord(node)) return;
    let unwrapped = false;
    for (const key of ACTIVITY_WRAPPER_KEYS) {
      if (Array.isArray(node[key])) {
        visit(node[key]);
        unwrapped = true;
      }
    }
    if (!unwrapped) out.push(node);
  };
  visit(parsed);
  return out;
}

/**
 * Parse a Garmin export ZIP into tagged raw summaries. Tolerant: non-JSON
 * entries, unparseable JSON, and unclassifiable records are skipped silently
 * (the export carries plenty of files we don't map). Returns the summaries in
 * file order; idempotency/merge happen downstream in buildIngestRequest.
 */
export function parseGarminExport(zip: Uint8Array): RawSummaryInput[] {
  const files = unzipSync(zip);
  const summaries: RawSummaryInput[] = [];

  for (const [name, bytes] of Object.entries(files)) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(strFromU8(bytes));
    } catch {
      continue;
    }
    for (const record of recordsFromJson(parsed)) {
      const summary_type = classify(record);
      if (summary_type) summaries.push({ summary_type, payload: record });
    }
  }

  return summaries;
}
