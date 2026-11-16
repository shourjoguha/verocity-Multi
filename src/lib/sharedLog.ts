// A log another user sent: validate it, make it ours, and decide where it goes.
//
// The payload in `shared_items` was written by ANOTHER USER through
// send_shared_items (migration 0052). The RPC builds it from an allow-list,
// but this module treats it as hostile anyway — defence in depth, and the
// validator is what the tests exercise (the retired friends plan (git show edd9f53:docs/FRIENDS_SHARING_PLAN.md; now SPEC §7C) §6).
//
// - validateLogDocument / validateSharedLogPayload REJECT, never repair. What
//   they return is rebuilt from known fields only, so an unknown key in the
//   input never reaches a row.
// - sanitiseSharedLog makes the copy the receiver's: fresh group/item ids,
//   every set `prefilled` (the numbers are the sender's), `rpeRated: false`
//   (an RPE the receiver did not rate must not read as theirs), no `session`.
// - movementOverlap / unionLogs answer the same-day duplicate (§5.5).
// - choosePlanDay attaches a shared log to the receiver's ACTIVE plan (§12.3),
//   matching with compareMovements — never familyOf — and never before the
//   receiver's first log on that plan, so a backdated row cannot renumber the
//   program weeks of everything after it (§7 trap).
// - classifyBulkAccept splits a bulk accept into done vs needs_review (§12.1).
//
// Pure: no DOM, no storage, no queries. Ids come from an injectable `newId`.

import { FRIENDS, METRICS, RPE, SECTIONS, SUBROUTINE, type MetricKey, type SectionKey } from '@/app.config';
import { isAcceptableSwap } from '@/lib/movementSimilarity';
import { normalizeMovementName, type OverrideMap } from '@/lib/movementTaxonomy';
import { nextWeekForDay, planWeekCount } from '@/lib/progression';
import type {
  GroupKind,
  ItemMarkKind,
  LogDocument,
  LogGroup,
  LogItem,
  LogSection,
  LogSet,
  Plan,
  SetActual,
  SharedLogPayload,
  SharedMovementPayload,
  WorkoutLog,
} from '@/lib/types';

const L = FRIENDS.limits;

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

class Reject extends Error {}
function fail(path: string, why: string): never {
  throw new Reject(`${path}: ${why}`);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function obj(v: unknown, path: string): Obj {
  if (!isObj(v)) fail(path, 'expected an object');
  return v;
}
function arr(v: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(v)) fail(path, 'expected an array');
  if (v.length > max) fail(path, `more than ${max} entries`);
  return v;
}
function str(v: unknown, path: string, max: number, { empty = true } = {}): string {
  if (typeof v !== 'string') fail(path, 'expected a string');
  if (v.length > max) fail(path, `longer than ${max} characters`);
  if (!empty && v.trim() === '') fail(path, 'empty');
  return v;
}
function optStr(v: unknown, path: string, max: number): string | undefined {
  return v === undefined ? undefined : str(v, path, max);
}
function num(v: unknown, path: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'expected a finite number');
  if (v < 0) fail(path, 'negative');
  if (v > max) fail(path, `above ${max}`);
  return v;
}
function optNum(v: unknown, path: string, max?: number): number | undefined {
  return v === undefined ? undefined : num(v, path, max);
}
function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, 'expected a boolean');
  return v;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) fail(path, 'unknown value');
  return v as T;
}

const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];
const GROUP_KINDS: readonly GroupKind[] = ['single', 'superset', 'circuit'];
const MARK_KINDS: readonly ItemMarkKind[] = ['height', 'distance', 'off'];
const NUMERIC_ACTUALS = ['weight', 'reps', 'distance', 'time', 'calories', 'mark', 'rest'] as const;
const ACTUAL_KEYS = new Set<string>([...NUMERIC_ACTUALS, 'rpe', 'completed', 'prefilled', 'rpeRated']);

/** http: or https: only. A `javascript:` link in a shared log is stored XSS. */
export function isSafeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function vActual(v: unknown, path: string): SetActual {
  const a = obj(v, path);
  for (const k of Object.keys(a)) if (!ACTUAL_KEYS.has(k)) fail(`${path}.${k}`, 'unknown field');
  const out: SetActual = { completed: bool(a.completed, `${path}.completed`), prefilled: bool(a.prefilled, `${path}.prefilled`) };
  for (const k of NUMERIC_ACTUALS) {
    const n = optNum(a[k], `${path}.${k}`);
    if (n !== undefined) out[k] = n;
  }
  const rpe = optNum(a.rpe, `${path}.rpe`, RPE.max);
  if (rpe !== undefined) out.rpe = rpe;
  if (a.rpeRated !== undefined) out.rpeRated = bool(a.rpeRated, `${path}.rpeRated`);
  return out;
}

function vSet(v: unknown, path: string): LogSet {
  const s = obj(v, path);
  const planned = s.planned === null || s.planned === undefined ? null : str(s.planned, `${path}.planned`, L.plannedChars);
  const notations = arr(s.notations ?? [], `${path}.notations`, L.notations).map((n, i) =>
    str(n, `${path}.notations[${i}]`, L.notationChars),
  );
  const out: LogSet = { planned, actual: vActual(s.actual, `${path}.actual`), notations };
  if (s.added !== undefined) {
    if (s.added !== true) fail(`${path}.added`, 'must be true when present');
    out.added = true;
  }
  return out;
}

function vItem(v: unknown, path: string): LogItem {
  const it = obj(v, path);
  const kind = it.kind === undefined ? undefined : oneOf(it.kind, ['movement', 'subroutine'] as const, `${path}.kind`);
  const out: LogItem = {
    id: str(it.id, `${path}.id`, L.nameChars, { empty: false }),
    movement: str(it.movement, `${path}.movement`, L.nameChars, { empty: false }),
    primaryMetric: oneOf(it.primaryMetric, METRIC_KEYS, `${path}.primaryMetric`),
    sets: arr(it.sets, `${path}.sets`, L.setsPerItem).map((s, i) => vSet(s, `${path}.sets[${i}]`)),
  };
  const rest = optNum(it.restSeconds, `${path}.restSeconds`);
  if (rest !== undefined) out.restSeconds = rest;
  if (it.markKind !== undefined) out.markKind = oneOf(it.markKind, MARK_KINDS, `${path}.markKind`);
  const notes = optStr(it.notes, `${path}.notes`, L.notesChars);
  if (notes !== undefined) out.notes = notes;
  if (kind !== undefined) out.kind = kind;
  const description = optStr(it.description, `${path}.description`, SUBROUTINE.maxDescriptionChars);
  if (description !== undefined) out.description = description;
  const url = optStr(it.url, `${path}.url`, L.urlChars);
  if (url !== undefined) {
    if (!isSafeUrl(url)) fail(`${path}.url`, 'only http and https links are allowed');
    out.url = url;
  }
  return out;
}

function vGroup(v: unknown, path: string): LogGroup {
  const g = obj(v, path);
  const out: LogGroup = {
    id: str(g.id, `${path}.id`, L.nameChars, { empty: false }),
    kind: oneOf(g.kind, GROUP_KINDS, `${path}.kind`),
    items: arr(g.items, `${path}.items`, L.itemsPerGroup).map((it, i) => vItem(it, `${path}.items[${i}]`)),
  };
  const rest = optNum(g.restSeconds, `${path}.restSeconds`);
  if (rest !== undefined) out.restSeconds = rest;
  const completedAt = optStr(g.completedAt, `${path}.completedAt`, 40);
  if (completedAt !== undefined) out.completedAt = completedAt;
  return out;
}

function vDocument(v: unknown, path: string): LogDocument {
  const d = obj(v, path);
  const seen = new Set<SectionKey>();
  const sections = arr(d.sections, `${path}.sections`, SECTIONS.length).map((sv, i): LogSection => {
    const p = `${path}.sections[${i}]`;
    const s = obj(sv, p);
    const key = oneOf(s.key, SECTIONS, `${p}.key`);
    if (seen.has(key)) fail(`${p}.key`, 'duplicate section');
    seen.add(key);
    return {
      key,
      groups: arr(s.groups, `${p}.groups`, L.groupsPerSection).map((g, j) => vGroup(g, `${p}.groups[${j}]`)),
    };
  });
  // `session` is accepted and dropped: it is the sender's sleep / energy /
  // soreness and the RPC never sends it. Rebuilding drops it anyway.
  return { sections };
}

function run<T>(f: () => T): Validated<T> {
  try {
    return { ok: true, value: f() };
  } catch (e) {
    if (e instanceof Reject) return { ok: false, error: e.message };
    throw e;
  }
}

/**
 * Shape-check an untrusted LogDocument. Section keys from SECTIONS, metric keys
 * from METRICS, numbers finite and non-negative, strings and arrays capped by
 * FRIENDS.limits, subroutine urls http(s) only. Rejects on the first problem;
 * the value returned on success is a rebuild holding known fields only.
 */
export function validateLogDocument(doc: unknown): Validated<LogDocument> {
  return run(() => vDocument(doc, 'data'));
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
function isoOrNull(v: unknown, path: string): string | null {
  if (v === null || v === undefined) return null;
  const s = str(v, path, 40);
  if (Number.isNaN(Date.parse(s))) fail(path, 'not a timestamp');
  return s;
}

function vMovement(v: unknown, path: string): SharedMovementPayload {
  const m = obj(v, path);
  return {
    name: str(m.name, `${path}.name`, L.nameChars, { empty: false }),
    category: m.category === null || m.category === undefined ? null : str(m.category, `${path}.category`, L.tagChars),
    tags: arr(m.tags ?? [], `${path}.tags`, L.tags).map((t, i) => str(t, `${path}.tags[${i}]`, L.tagChars)),
    default_metrics: arr(m.default_metrics ?? [], `${path}.default_metrics`, METRIC_KEYS.length).map((k, i) =>
      oneOf(k, METRIC_KEYS, `${path}.default_metrics[${i}]`),
    ),
    primary_metric: oneOf(m.primary_metric, METRIC_KEYS, `${path}.primary_metric`),
    default_rest_seconds: num(m.default_rest_seconds, `${path}.default_rest_seconds`),
    // Shape is checked where it is applied (lib/movementTaxonomy.ts reads a
    // partial profile); here it must at least be an object.
    taxonomy: m.taxonomy === null || m.taxonomy === undefined ? null : (obj(m.taxonomy, `${path}.taxonomy`) as SharedMovementPayload['taxonomy']),
  };
}

/** Validate a whole `shared_items.payload` for a log. Same contract as above. */
export function validateSharedLogPayload(payload: unknown): Validated<SharedLogPayload> {
  return run(() => {
    const p = obj(payload, 'payload');
    const logDate = str(p.log_date, 'log_date', 10);
    if (!YMD.test(logDate) || Number.isNaN(Date.parse(`${logDate}T00:00:00Z`))) fail('log_date', 'not a date');
    return {
      log_date: logDate,
      started_at: isoOrNull(p.started_at, 'started_at'),
      ended_at: isoOrNull(p.ended_at, 'ended_at'),
      total_seconds:
        p.total_seconds === null || p.total_seconds === undefined
          ? null
          : num(p.total_seconds, 'total_seconds', L.totalSeconds),
      activity_type:
        p.activity_type === null || p.activity_type === undefined ? null : str(p.activity_type, 'activity_type', L.tagChars),
      tags: arr(p.tags ?? [], 'tags', L.tags).map((t, i) => str(t, `tags[${i}]`, L.tagChars)),
      data: vDocument(p.data, 'data'),
      movements: arr(p.movements ?? [], 'movements', L.movements).map((m, i) => vMovement(m, `movements[${i}]`)),
    };
  });
}

const defaultId = (): string => crypto.randomUUID();

function sanitiseItem(item: LogItem, newId: () => string): LogItem {
  return {
    ...item,
    id: newId(),
    sets: item.sets.map((s) => ({
      ...s,
      notations: [...s.notations],
      // `completed` is kept as sent; the numbers become the receiver's prefill.
      actual: { ...s.actual, prefilled: true, rpeRated: false },
    })),
  };
}

/**
 * Make a VALIDATED shared document the receiver's: regenerate every group and
 * item id, mark every set prefilled with an unrated RPE, drop `session`, keep
 * `completed` as sent.
 */
export function sanitiseSharedLog(doc: LogDocument, newId: () => string = defaultId): LogDocument {
  return {
    sections: doc.sections.map((s) => ({
      key: s.key,
      groups: s.groups.map((g) => ({ ...g, id: newId(), items: g.items.map((it) => sanitiseItem(it, newId)) })),
    })),
  };
}

// ---- duplicates (§5.5) ----

function nameKey(raw: string): string {
  return normalizeMovementName(raw) || raw.trim().toLowerCase();
}

function movementNames(doc: LogDocument): Set<string> {
  const out = new Set<string>();
  for (const s of doc.sections ?? []) {
    for (const g of s.groups ?? []) {
      for (const it of g.items ?? []) if (it.kind !== 'subroutine') out.add(nameKey(it.movement));
    }
  }
  return out;
}

/**
 * Share of the SHARED log's distinct movements that also appear in mine, 0–1.
 * Names compared with normalizeMovementName; subroutines excluded. 0 when the
 * shared log has no movements.
 */
export function movementOverlap(shared: LogDocument, mine: LogDocument): number {
  const theirs = movementNames(shared);
  if (theirs.size === 0) return 0;
  const ours = movementNames(mine);
  let hit = 0;
  for (const n of theirs) if (ours.has(n)) hit += 1;
  return hit / theirs.size;
}

/** A log that is real training of the receiver's: not cancelled, not itself
 *  awaiting review. The population every same-day comparison runs against. */
export function isCountedLog(log: Pick<WorkoutLog, 'status'>): boolean {
  return log.status !== 'cancelled' && log.status !== 'needs_review';
}

/**
 * The receiver's log on `logDate` that the shared document overlaps most, or
 * null when they logged nothing countable that day. `excludeId` leaves out the
 * review row itself.
 */
export function sameDayOverlap(
  shared: LogDocument,
  logDate: string,
  myLogs: WorkoutLog[],
  excludeId?: string,
): { log: WorkoutLog; overlap: number } | null {
  let best: { log: WorkoutLog; overlap: number } | null = null;
  for (const log of myLogs) {
    if (log.id === excludeId || log.log_date !== logDate || !isCountedLog(log)) continue;
    const overlap = movementOverlap(shared, log.data ?? { sections: [] });
    if (!best || overlap > best.overlap) best = { log, overlap };
  }
  return best;
}

/**
 * Combine: MY document survives, and the shared log's items that mine lacks
 * are appended to the matching section (created in canonical order if mine has
 * none). A shared group that loses items keeps the rest; one item left becomes
 * `single`; none left is dropped. A movement is appended once even if the
 * shared log repeats it. Subroutines dedupe by title against mine's
 * subroutines. `shared` should already be sanitised (fresh ids);
 * `addedItemIds` lets the editor mark what came in.
 */
export function unionLogs(mine: LogDocument, shared: LogDocument): { doc: LogDocument; addedItemIds: string[] } {
  const haveMoves = movementNames(mine);
  const haveSubs = new Set<string>();
  for (const s of mine.sections) {
    for (const g of s.groups) for (const it of g.items) if (it.kind === 'subroutine') haveSubs.add(nameKey(it.movement));
  }
  const sections: LogSection[] = mine.sections.map((s) => ({ ...s, groups: [...s.groups] }));
  const addedItemIds: string[] = [];

  for (const ss of shared.sections) {
    const groups: LogGroup[] = [];
    for (const g of ss.groups) {
      const items = g.items.filter((it) => {
        const key = nameKey(it.movement);
        const have = it.kind === 'subroutine' ? haveSubs : haveMoves;
        if (have.has(key)) return false;
        have.add(key);
        return true;
      });
      if (items.length === 0) continue;
      groups.push({ ...g, kind: items.length === 1 ? 'single' : g.kind, items });
      addedItemIds.push(...items.map((it) => it.id));
    }
    if (groups.length === 0) continue;
    const target = sections.find((s) => s.key === ss.key);
    if (target) {
      target.groups.push(...groups);
    } else {
      const order = SECTIONS.indexOf(ss.key);
      const at = sections.findIndex((s) => SECTIONS.indexOf(s.key) > order);
      sections.splice(at < 0 ? sections.length : at, 0, { key: ss.key, groups });
    }
  }
  return { doc: { ...mine, sections }, addedItemIds };
}

// ---- plan link (§12.3) ----

export interface PlanLink {
  plan_id: string;
  day_key: string;
  week_number: number;
}

function distinctMovements(names: string[]): string[] {
  const seen = new Map<string, string>();
  for (const n of names) {
    const k = nameKey(n);
    if (!seen.has(k)) seen.set(k, n);
  }
  return [...seen.values()];
}

/**
 * Dice overlap between what was logged and what a plan day prescribes:
 * 2·matched / (logged + prescribed), where each prescribed movement may be
 * matched by at most one logged movement that compareMovements calls `same` or
 * `minor`. Symmetric on purpose — a ten-movement log that happens to contain a
 * two-movement day's lifts is not that day.
 */
export function planDayOverlap(logged: string[], prescribed: string[], overrides?: OverrideMap): number {
  const a = distinctMovements(logged);
  const b = distinctMovements(prescribed);
  if (a.length + b.length === 0) return 0;
  const used = new Set<number>();
  let matched = 0;
  for (const p of b) {
    const i = a.findIndex((l, idx) => !used.has(idx) && isAcceptableSwap(p, l, overrides));
    if (i >= 0) {
      used.add(i);
      matched += 1;
    }
  }
  return (2 * matched) / (a.length + b.length);
}

/**
 * Which day of the receiver's ACTIVE plan a shared log should count toward, or
 * null. Both must hold: the best day's planDayOverlap reaches
 * FRIENDS.planMatchThreshold, and `logDate` is on or after the receiver's first
 * counted log on that plan (with none yet, on or after the plan's start date
 * when it has one). The second is the §7 trap: planCycles walks logs in date
 * order, so a row attached three weeks back would renumber every week after it.
 * `logs` is the receiver's history (any statuses; filtered here).
 */
export function choosePlanDay(input: {
  doc: LogDocument;
  logDate: string;
  plan: Plan | null;
  logs: WorkoutLog[];
  overrides?: OverrideMap;
}): PlanLink | null {
  const { doc, logDate, plan, logs, overrides } = input;
  if (!plan) return null;
  if (!canLinkOnDate(plan, logs, logDate)) return null;

  const logged: string[] = [];
  for (const s of doc.sections) {
    for (const g of s.groups) for (const it of g.items) if (it.kind !== 'subroutine') logged.push(it.movement);
  }
  if (logged.length === 0) return null;

  let best: { dayKey: string; score: number } | null = null;
  for (const day of plan.parsed.days ?? []) {
    const prescribed = day.exercises.filter((e) => e.kind !== 'subroutine').map((e) => e.movement);
    const score = planDayOverlap(logged, prescribed, overrides);
    if (!best || score > best.score) best = { dayKey: day.dayKey, score };
  }
  if (!best || best.score < FRIENDS.planMatchThreshold) return null;
  return planLinkFor(plan, best.dayKey, logs);
}

/**
 * The earliest date a log may be attached to `plan` on: the receiver's first
 * counted log on it, or with none yet the plan's start date (null = no floor).
 * The §7 trap: planCycles walks logs in date order, so attaching a row dated
 * before this renumbers the program week of everything after it.
 */
export function planLinkFloor(plan: Plan, logs: WorkoutLog[]): string | null {
  let first: string | null = null;
  for (const l of logs) {
    if (l.plan_id !== plan.id || !l.day_key || !isCountedLog(l)) continue;
    if (first == null || l.log_date < first) first = l.log_date;
  }
  return first ?? plan.start_date;
}

/** Whether a log dated `logDate` may count toward `plan` at all. */
export function canLinkOnDate(plan: Plan, logs: WorkoutLog[], logDate: string): boolean {
  const floor = planLinkFloor(plan, logs);
  return !floor || logDate >= floor;
}

/**
 * The link for a CHOSEN day of `plan` (the Counts-toward control, or
 * choosePlanDay's best match): the week is the cycle that day's next log falls
 * in. `logs` must not contain the log being linked — its own current link
 * would otherwise count as that day already logged and push it a week on.
 */
export function planLinkFor(plan: Plan, dayKey: string, logs: WorkoutLog[]): PlanLink {
  return {
    plan_id: plan.id,
    day_key: dayKey,
    week_number: nextWeekForDay(logs, plan.id, dayKey, planWeekCount(plan.parsed)),
  };
}

// ---- the row an accept inserts ----

export type AcceptedLogStatus = Extract<WorkoutLog['status'], 'done' | 'needs_review'>;

export type AcceptedLogRow = Pick<
  WorkoutLog,
  | 'log_date'
  | 'started_at'
  | 'ended_at'
  | 'total_seconds'
  | 'activity_type'
  | 'tags'
  | 'data'
  | 'status'
  | 'plan_id'
  | 'day_key'
  | 'week_number'
  | 'source'
> & { shared_item_id: string };

/**
 * Validate, sanitise and shape the workout_logs insert for an accepted item.
 * Never carries the sender's notes, heart rate, Garmin link or plan link;
 * `planLink` is the RECEIVER's (choosePlanDay), or null for none.
 */
export function buildAcceptedLogRow(
  payload: unknown,
  status: AcceptedLogStatus,
  planLink: PlanLink | null,
  sharedItemId: string,
  newId: () => string = defaultId,
): Validated<AcceptedLogRow> {
  const v = validateSharedLogPayload(payload);
  if (!v.ok) return v;
  const p = v.value;
  return {
    ok: true,
    value: {
      log_date: p.log_date,
      started_at: p.started_at,
      ended_at: p.ended_at,
      total_seconds: p.total_seconds,
      activity_type: p.activity_type,
      tags: p.tags,
      data: sanitiseSharedLog(p.data, newId),
      status,
      plan_id: planLink?.plan_id ?? null,
      day_key: planLink?.day_key ?? null,
      week_number: planLink?.week_number ?? null,
      source: 'manual',
      shared_item_id: sharedItemId,
    },
  };
}

// ---- bulk accept (§12.1) ----

/** The receiver's logs keyed by log_date, for classifyBulkAccept. */
export function logsByDate<T extends Pick<WorkoutLog, 'log_date'>>(logs: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const l of logs) out.set(l.log_date, [...(out.get(l.log_date) ?? []), l]);
  return out;
}

/**
 * Split a bulk accept. An item whose date already holds a counted log of the
 * receiver's (not cancelled, not needs_review) goes in as `needs_review`, to be
 * resolved by the duplicates sheet; the rest go in as `done`. Siblings in the
 * batch are NOT compared with each other — two shared logs on one day are the
 * sender's business. Order is preserved within each list.
 */
export function classifyBulkAccept<T extends { item_date: string | null }>(
  items: T[],
  myLogsByDate: ReadonlyMap<string, readonly Pick<WorkoutLog, 'status'>[]>,
): { done: T[]; needsReview: T[] } {
  const done: T[] = [];
  const needsReview: T[] = [];
  for (const item of items) {
    const mine = item.item_date ? (myLogsByDate.get(item.item_date) ?? []) : [];
    (mine.some(isCountedLog) ? needsReview : done).push(item);
  }
  return { done, needsReview };
}
