import { getAllLogs } from '@/lib/queries';
import { cacheGeneration, getCached, setCached } from '@/lib/queryCache';
import type { WorkoutLog } from '@/lib/types';

// The signed-in user's whole log history, fetched once and shared by every
// island that reads logs. Home, Stats, Plan, Review, Body, Calendar, Shares and
// the Logger each fetched it (or a slice of it) themselves, so walking Home →
// Stats → Plan downloaded the same rows three times, plus a 120-day window and
// a recent-30 that were subsets of them. Measured with `npm run perf:baseline`.
//
// App mode only. The showcase reads through the anon client and must never
// share a cache slot with the owner's own rows.
//
// Freshness: a result is reused for FRESH_MS, so a tab switch costs nothing.
// Every log write on this device goes through createLog/updateLog/deleteLog,
// which clear the query cache — that drops the stored list, and the next read
// fetches. Writes from another device reach Home through its realtime channel,
// which calls invalidateLogs(). A read that was in flight across a clear does
// not store its result (cacheGeneration), so it cannot resurrect pre-write rows.
const KEY = 'logs:all';
const FRESH_MS = 60_000;

let inflight: Promise<WorkoutLog[]> | null = null;
// The cache generation `inflight` was started under. A request from before a
// clear (a write, or a sign-out followed by another account signing in) is
// never handed to a caller after it.
let inflightGen = -1;
let fetchedAt = 0;
// Bumped by invalidateLogs(), for the same reason as cacheGeneration(): a
// request started before an invalidation must not land after a newer one.
let epoch = 0;

export function loadAllLogs(): Promise<WorkoutLog[]> {
  const cached = getCached<WorkoutLog[]>(KEY);
  if (cached && Date.now() - fetchedAt < FRESH_MS) return Promise.resolve(cached);
  const gen = cacheGeneration();
  if (inflight && inflightGen === gen) return inflight;
  const started = epoch;
  const request = getAllLogs()
    .then((logs) => {
      if (cacheGeneration() === gen && epoch === started) {
        setCached(KEY, logs);
        fetchedAt = Date.now();
      }
      return logs;
    })
    .finally(() => {
      if (inflight === request) inflight = null;
    });
  inflight = request;
  inflightGen = gen;
  return request;
}

// The next loadAllLogs() fetches, even inside the fresh window. The cached list
// stays readable meanwhile, so seeded views keep painting it.
export function invalidateLogs(): void {
  fetchedAt = 0;
  inflight = null;
  epoch++;
}

// What getRecentLogs(n) returned: newest first by log_date.
export function newestLogs(all: WorkoutLog[], n: number): WorkoutLog[] {
  return all.slice(-n).reverse();
}

// What getLogsInRange(from, to) returned: inclusive YYYY-MM-DD bounds, oldest
// first.
export function logsBetween(all: WorkoutLog[], from: string, to: string): WorkoutLog[] {
  return all.filter((l) => l.log_date >= from && l.log_date <= to);
}
