// The client half of accepting a log a friend sent (§5.4 step 1, §5.7, §12.1,
// §12.3). The pure rules live in lib/sharedLog.ts; this file only sequences
// them against the query layer:
//
//   validate → copy unknown custom movements → build the row (sanitised, our
//   own plan link or none) → insert → mark the item accepted with that log id.
//
// The insert is guarded by the (owner, shared_item_id) unique index, so a
// retried accept cannot create a second row; when the insert is refused we
// look for the row that already carries this item and finish the job with it.
import {
  createLog,
  createMovement,
  getAllLogs,
  resolveMovement,
  setSharedItemStatus,
} from '@/lib/queries';
import {
  buildAcceptedLogRow,
  choosePlanDay,
  classifyBulkAccept,
  logsByDate,
  validateSharedLogPayload,
  type AcceptedLogStatus,
  type PlanLink,
} from '@/lib/sharedLog';
import type { Movement, Plan, SharedItem, SharedMovementPayload, WorkoutLog } from '@/lib/types';

export type LogItem = Extract<SharedItem, { kind: 'log' }>;

export type AcceptOutcome =
  | { ok: true; log: WorkoutLog; status: AcceptedLogStatus }
  | { ok: false; error: string };

// §5.7: resolve by name against own + shared library; a miss becomes the
// receiver's own custom movement. An empty library means the load failed —
// inserting against it would duplicate shared rows, so skip (the Logger's
// finish sweep picks the names up later, the same way it does for its own).
async function copyMovements(movements: SharedMovementPayload[], library: Movement[]): Promise<void> {
  if (library.length === 0) return;
  for (const m of movements) {
    if (resolveMovement(m.name, library)) continue;
    const created = await createMovement({
      name: m.name,
      category: m.category,
      primary_metric: m.primary_metric,
      default_rest_seconds: m.default_rest_seconds,
      taxonomy: m.taxonomy,
    });
    if (created) library.push(created);
  }
}

/** Accept one shared log as `status`. `myLogs` is appended to on success so a
 *  following accept in the same run sees it (plan weeks, same-day checks). */
export async function acceptSharedLog(
  item: LogItem,
  status: AcceptedLogStatus,
  planLink: PlanLink | null,
  library: Movement[],
  myLogs: WorkoutLog[],
): Promise<AcceptOutcome> {
  const v = validateSharedLogPayload(item.payload);
  if (!v.ok) return { ok: false, error: `This workout can't be read (${v.error}).` };
  const built = buildAcceptedLogRow(item.payload, status, planLink, item.id);
  if (!built.ok) return { ok: false, error: `This workout can't be read (${built.error}).` };

  await copyMovements(v.value.movements, library);

  let log = await createLog(built.value);
  if (!log) {
    // A retry after a lost response: the unique index refused a second row.
    const existing = (await getAllLogs()).find((l) => l.shared_item_id === item.id);
    if (!existing) return { ok: false, error: "Couldn't save this workout. Check your connection and try again." };
    log = existing;
  }
  const marked = await setSharedItemStatus(item.id, 'accepted', log.id);
  if (!marked) return { ok: false, error: 'Saved, but the inbox could not be updated. Reload and try again.' };
  myLogs.push(log);
  return { ok: true, log, status: log.status === 'done' ? 'done' : 'needs_review' };
}

export interface BulkResult {
  added: number;
  needReview: WorkoutLog[];
  failed: string[];
}

/**
 * Accept all / Accept selected (§12.1). Items whose date already holds one of
 * my counted logs go in as needs_review; the rest as `done`, attached to my
 * active plan only when choosePlanDay says so (§12.3). `review: true` is
 * Review all / Review selected: every item goes in as needs_review.
 */
export async function acceptMany(
  items: LogItem[],
  opts: { review: boolean; plan: Plan | null; library: Movement[]; myLogs: WorkoutLog[] },
): Promise<BulkResult> {
  const needsReview = opts.review ? items : classifyBulkAccept(items, logsByDate(opts.myLogs)).needsReview;
  const reviewIds = new Set(needsReview.map((i) => i.id));
  const out: BulkResult = { added: 0, needReview: [], failed: [] };
  // Keep the batch's own order (the inbox's), not done-then-review.
  for (const item of items) {
    const status: AcceptedLogStatus = reviewIds.has(item.id) ? 'needs_review' : 'done';
    let link: PlanLink | null = null;
    if (status === 'done') {
      const v = validateSharedLogPayload(item.payload);
      if (v.ok) link = choosePlanDay({ doc: v.value.data, logDate: v.value.log_date, plan: opts.plan, logs: opts.myLogs });
    }
    const res = await acceptSharedLog(item, status, link, opts.library, opts.myLogs);
    if (!res.ok) out.failed.push(res.error);
    else if (res.status === 'done') out.added += 1;
    else out.needReview.push(res.log);
  }
  return out;
}

/** "5 added · 2 need review (same day as your log)" — §12.1's toast. */
export function bulkToast(r: BulkResult, review: boolean): string {
  const parts: string[] = [];
  if (r.added) parts.push(`${r.added} added`);
  if (r.needReview.length)
    parts.push(
      review
        ? `${r.needReview.length} to review`
        : `${r.needReview.length} need${r.needReview.length === 1 ? 's' : ''} review (same day as your log)`,
    );
  if (r.failed.length) parts.push(`${r.failed.length} couldn't be read`);
  return parts.join(' · ') || 'Nothing accepted';
}
