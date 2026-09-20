// How much of the plan you actually did.
//
// WHAT THIS REPLACES. The Stats "Adherence" tile used to read completed sets
// over sets PRESENT IN THE LOG DOCUMENT, across a rolling 8-week window. That
// number could only ever be near 100: a set enters the denominator when it is
// added to a session, and you tick it when you do it. It measured checkbox
// hygiene. It never opened `plans.parsed`, so a prescription you skipped
// entirely — or a whole training day you stopped showing up for — was invisible
// to it, and `reduceLogDocument` minis trimmed their own denominator away.
//
// THE DENOMINATOR IS PACED BY LOGGING, NOT THE CALENDAR. Program week is
// `currentProgramWeek` — the most times any one day has been logged — so a week
// that took ten days costs nothing, which is the whole reason weeks are
// logging-grounded elsewhere in the app. But the cursor advances for the WHOLE
// plan: reaching week 8 on Mondays makes week 8's Friday due as well, so a day
// you quietly stopped training shows up as the miss it is. A per-day cursor
// (the obvious first cut) never grows for a day you never log, which hides
// exactly the failure worth seeing.
//
// THE IN-FLIGHT WEEK IS NOT A FAILURE. Weeks 1..E-1 count in full; week E
// counts only the days already logged in it. Otherwise Wednesday reads as
// missed on Monday evening, and adherence sawtooths every week for no reason.
//
// OVERSHOOT IS NOT ADHERENCE AND NOT A PENALTY. Extra sets are counted and
// reported beside the bar, never in the ratio. The per-exercise cap is there so
// five sets of a prescribed three cannot PAY FOR a skipped row elsewhere — it
// does not subtract anything.
//
// Pure: no DOM, no storage, no Date, no queries. `today` is passed in.

import type { ParsedPlan, PlanDay, WorkoutLog } from '@/lib/types';
import type { OverrideMap } from '@/lib/movementTaxonomy';
import { parsePlanned } from '@/lib/logBuilder';
import { compareMovements, type SwapVerdict } from '@/lib/movementSimilarity';
import { currentProgramWeek, planWeekByLog, planWeekCount } from '@/lib/progression';
import { isSubroutine } from '@/lib/subroutine';

/** One prescribed movement, rolled up across every elapsed week of one day. */
export interface AdherenceRow {
  dayKey: string;
  /** The plan day's label, for display — plan days are keyed, not named. */
  label: string;
  movement: string;
  prescribedSets: number;
  /** Done as written. */
  exactSets: number;
  /** Done via a movement that trains the same thing (see movementSimilarity). */
  swapSets: number;
  /** Done, but in some other session than the one it was prescribed in. */
  makeUpSets: number;
  missedSets: number;
  /** What you did instead, and whether it counted. */
  substitutions: { movement: string; sets: number; verdict: SwapVerdict }[];
  /** exactSets + swapSets + makeUpSets, over prescribedSets. */
  pct: number;
}

export interface PlanAdherence {
  /** Program week reached — the most times any one day has been logged. */
  elapsedWeeks: number;
  /** Weeks the plan programmes in total. */
  planWeeks: number;
  /** ymd of the first done log against this plan; the anchor for everything. */
  firstLogDate: string;
  /**
   * Weeks of wall clock since that first log. Reported ALONGSIDE the
   * percentage, never inside it: training the plan slower than it is written is
   * a pacing fact, not a failure to follow it, and folding the two together is
   * what makes a calendar-paced denominator punish an honest ten-day week.
   */
  calendarWeeks: number;
  prescribedSets: number;
  exactSets: number;
  swapSets: number;
  makeUpSets: number;
  missedSets: number;
  /** Sets beyond the prescription: added movements, and overshoot on a row. */
  extraSets: number;
  /** (exact + swap + makeUp) / prescribed, 0-100, capped at 100. */
  pct: number;
  rows: AdherenceRow[];
}

/** A logged movement and how many of its sets were ticked. */
interface LoggedWork {
  movement: string;
  sets: number;
}

/** A prescribed movement awaiting credit. */
interface Owed {
  dayKey: string;
  week: number;
  movement: string;
  sets: number;
}

function loggedWork(log: WorkoutLog): LoggedWork[] {
  const out: LoggedWork[] = [];
  for (const section of log.data?.sections ?? []) {
    for (const group of section.groups ?? []) {
      for (const item of group.items ?? []) {
        if (isSubroutine(item)) continue;
        const sets = item.sets.filter((s) => s.actual.completed).length;
        if (sets > 0) out.push({ movement: item.movement, sets });
      }
    }
  }
  return out;
}

/** Exercises a day prescribes in a given week. Subroutines carry no sets. */
function prescribedFor(day: PlanDay, week: number): { movement: string; sets: number }[] {
  const out: { movement: string; sets: number }[] = [];
  for (const ex of day.exercises) {
    if (isSubroutine(ex)) continue;
    const planned = ex.plannedByWeek[week]?.trim();
    if (!planned) continue;
    out.push({ movement: ex.movement, sets: parsePlanned(planned).count });
  }
  return out;
}

function weeksBetween(startYmd: string, end: Date): number {
  const start = new Date(`${startYmd}T00:00:00Z`);
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000);
  return Math.max(1, Math.floor(days / 7) + 1);
}

/**
 * Credit `owed` against `available`, best match first.
 *
 * Exact names are settled across the whole cell BEFORE any swap is considered.
 * Without that ordering, a day prescribing both Pull-up and Lat Pulldown could
 * spend the logged Lat Pulldown sets on the Pull-up row — they are a minor swap
 * for each other — and then report the movement you actually did as missed.
 *
 * Within a pass it is first-come. A cell holding two prescriptions that accept
 * the same substitute can credit either; they are interchangeable by
 * construction, so which one wins does not move any total.
 *
 * Mutates both lists, leaving unmet prescriptions and unclaimed work behind.
 */
function credit(
  owed: Owed[],
  available: LoggedWork[],
  overrides: OverrideMap | undefined,
  onCredit: (to: Owed, from: LoggedWork, sets: number, verdict: SwapVerdict) => void,
): void {
  for (const verdict of ['same', 'minor'] as const) {
    for (const want of owed) {
      if (want.sets <= 0) continue;
      for (const have of available) {
        if (have.sets <= 0 || want.sets <= 0) continue;
        if (compareMovements(want.movement, have.movement, overrides) !== verdict) continue;
        const n = Math.min(want.sets, have.sets);
        onCredit(want, have, n, verdict);
        want.sets -= n;
        have.sets -= n;
      }
    }
  }
}

export function computePlanAdherence(
  planId: string,
  parsed: ParsedPlan,
  logs: WorkoutLog[],
  today: Date,
  overrides?: OverrideMap,
): PlanAdherence | null {
  const done = logs.filter((l) => l.status === 'done');
  const planLogs = done.filter((l) => l.plan_id === planId && l.day_key);
  if (planLogs.length === 0) return null;

  const planWeeks = planWeekCount(parsed);
  const elapsedWeeks = currentProgramWeek(planId, planLogs, planWeeks);
  const weekByLog = planWeekByLog(planId, planLogs, planWeeks);
  const firstLogDate = planLogs
    .map((l) => l.log_date.slice(0, 10))
    .reduce((a, b) => (a < b ? a : b));

  const dayByKey = new Map(parsed.days.map((d) => [d.dayKey, d]));

  // Which (day, week) cells are due. Weeks 1..E-1 in full; week E only where a
  // log already exists.
  const loggedCells = new Set<string>();
  for (const log of planLogs) {
    const w = weekByLog.get(log.id);
    if (w != null) loggedCells.add(`${log.day_key}|${w}`);
  }

  const owed: Owed[] = [];
  for (const day of parsed.days) {
    for (let w = 1; w <= elapsedWeeks; w += 1) {
      if (w === elapsedWeeks && !loggedCells.has(`${day.dayKey}|${w}`)) continue;
      for (const p of prescribedFor(day, w)) {
        owed.push({ dayKey: day.dayKey, week: w, movement: p.movement, sets: p.sets });
      }
    }
  }

  const prescribedSets = owed.reduce((a, o) => a + o.sets, 0);
  if (prescribedSets === 0) return null;

  // Rows are keyed by the prescription, not by the week — "what did I stick to"
  // is a question about a movement across the block.
  const rows = new Map<string, AdherenceRow>();
  const rowFor = (o: Owed): AdherenceRow => {
    const key = `${o.dayKey}|${o.movement.toLowerCase()}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        dayKey: o.dayKey,
        label: dayByKey.get(o.dayKey)?.label ?? o.dayKey,
        movement: o.movement,
        prescribedSets: 0,
        exactSets: 0,
        swapSets: 0,
        makeUpSets: 0,
        missedSets: 0,
        substitutions: [],
        pct: 0,
      };
      rows.set(key, row);
    }
    return row;
  };
  for (const o of owed) rowFor(o).prescribedSets += o.sets;

  const noteSub = (row: AdherenceRow, movement: string, sets: number, verdict: SwapVerdict) => {
    const hit = row.substitutions.find(
      (s) => s.movement.toLowerCase() === movement.toLowerCase() && s.verdict === verdict,
    );
    if (hit) hit.sets += sets;
    else row.substitutions.push({ movement, sets, verdict });
  };

  let exactSets = 0;
  let swapSets = 0;
  let makeUpSets = 0;

  // PASS 1 — each plan-linked session against its own cell.
  const leftoverByCell = new Map<string, LoggedWork[]>();
  for (const log of planLogs) {
    const week = weekByLog.get(log.id);
    const dayKey = log.day_key;
    if (week == null || !dayKey || !dayByKey.has(dayKey)) {
      // A log pointing at a day the plan no longer has. Its work is not owed to
      // anything, but it is still work — offer it to the make-up pass.
      const orphan = leftoverByCell.get('orphan') ?? [];
      leftoverByCell.set('orphan', [...orphan, ...loggedWork(log)]);
      continue;
    }
    const cell = `${dayKey}|${week}`;
    const cellOwed = owed.filter((o) => o.dayKey === dayKey && o.week === week);
    const work = [...(leftoverByCell.get(cell) ?? []), ...loggedWork(log)];

    credit(cellOwed, work, overrides, (o, from, n, verdict) => {
      const row = rowFor(o);
      if (verdict === 'same') {
        row.exactSets += n;
        exactSets += n;
      } else {
        row.swapSets += n;
        swapSets += n;
        noteSub(row, from.movement, n, verdict);
      }
    });

    leftoverByCell.set(cell, work.filter((w) => w.sets > 0));
  }

  // PASS 2 — "I skipped it on the day and went back to the gym later".
  // Everything still owed gets one more chance against every completed set the
  // plan has not already been credited for: work left over in its own session,
  // work from a session pointed at a different plan day, and work from sessions
  // logged off-plan entirely inside the block's span. Without this, finishing a
  // missed lift two days later reads as a miss AND as unrelated extra work.
  const stillOwed = owed.filter((o) => o.sets > 0);
  if (stillOwed.length > 0) {
    const planLogIds = new Set(planLogs.map((l) => l.id));
    const offPlan = done
      .filter((l) => !planLogIds.has(l.id) && l.log_date.slice(0, 10) >= firstLogDate)
      .flatMap(loggedWork);
    const pool = [...[...leftoverByCell.values()].flat(), ...offPlan].filter((w) => w.sets > 0);

    credit(stillOwed, pool, overrides, (o, from, n, verdict) => {
      const row = rowFor(o);
      row.makeUpSets += n;
      makeUpSets += n;
      if (verdict !== 'same') noteSub(row, from.movement, n, verdict);
    });
  }

  // Extra is what the PLAN's own sessions did beyond the prescription —
  // overshoot on a row, plus movements you added. `credit` mutates these
  // entries in place, so what is left here is what nothing claimed. Off-plan
  // sessions are deliberately absent: they can pay off a missed prescription
  // above, but an unrelated workout is not this plan's overshoot.
  const extraSets = [...leftoverByCell.values()].flat().reduce((a, w) => a + w.sets, 0);

  // Whatever is still owed was never done. A major swap is recorded against the
  // row it displaced so the table can say what happened instead of just "0".
  let missedSets = 0;
  for (const o of owed) {
    if (o.sets <= 0) continue;
    rowFor(o).missedSets += o.sets;
    missedSets += o.sets;
  }

  for (const row of rows.values()) {
    const hit = row.exactSets + row.swapSets + row.makeUpSets;
    row.pct = row.prescribedSets > 0 ? Math.round((hit / row.prescribedSets) * 100) : 0;
  }

  const hit = exactSets + swapSets + makeUpSets;
  return {
    elapsedWeeks,
    planWeeks,
    firstLogDate,
    calendarWeeks: weeksBetween(firstLogDate, today),
    prescribedSets,
    exactSets,
    swapSets,
    makeUpSets,
    missedSets,
    extraSets,
    pct: Math.min(100, Math.round((hit / prescribedSets) * 100)),
    // Worst first: the table's job is to surface what you stopped doing.
    rows: [...rows.values()].sort(
      (a, b) => a.pct - b.pct || b.prescribedSets - a.prescribedSets,
    ),
  };
}
