import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, MotionConfig } from 'motion/react';
import { supabase } from '@/lib/supabase';
import {
  bumpMovementSub,
  createLog,
  deleteLog,
  dismissMovementSub,
  getActivePlan,
  getLogById,
  getMovementSubs,
  createMovement,
  getMovements,
  resolveMovement,
  getPlanById,
  getSessionById,
  getSharedItem,
  removeAcceptedItems,
  updateLog,
} from '@/lib/queries';
import { loadAllLogs, newestLogs } from '@/lib/logStore';
import { canLinkOnDate, choosePlanDay, planLinkFor, sameDayOverlap, unionLogs, type PlanLink } from '@/lib/sharedLog';
import { confirmPatch, duplicateChoice, parseQueue, reviewHref } from '@/lib/reviewFlow';
import { nextReviewAfter } from '@/components/inbox/confirmReview';
import { formatDate } from '@/lib/format';
import { withoutUnreviewed } from '@/lib/stats';
import { LOG_STATUS_LABEL } from '@/components/friends/friendCopy';
import { track } from '@/lib/analytics';
import {
  buildBlankLog,
  buildLogFromPlanDay,
  buildLogFromSession,
  reduceLogDocument,
  resolveWeek,
  type MiniPreset,
} from '@/lib/logBuilder';
import {
  addItem,
  addSet,
  copyForward,
  addSubroutine,
  groupWithAcrossSections,
  mergeWithNext,
  detachItem,
  moveGroup,
  moveGroupToSection,
  moveItemInGroup,
  patchSetActual,
  removeGroup,
  removeItem,
  removeSet,
  setGroupKind,
  setItemMetric,
  setItemNotes,
  setItemRest,
  setItemMark,
  setItemMarkKind,
  setSetRest,
  setSubroutine,
  swapItemMovement,
  toggleItemNotation,
} from '@/lib/logEdits';
import { isSubroutine } from '@/lib/subroutine';
import { AddMenu, type AddKind } from '@/components/logger/AddMenu';
import { inToCm, markKindOf } from '@/lib/jumpMark';
import { formatSetActual } from '@/lib/format';
import { activeSessionOf } from '@/lib/activeSession';
import { typeFromLabel } from '@/lib/timeline';
import { SubroutineBody } from '@/components/SubroutineBody';
import { DemoIconButton, MovementDemoSheet } from '@/components/MovementDemo';
import { lastPerformance, plannedReps, plannedTarget, repAdjustedWeight } from '@/lib/lastPerformance';
import { bestE1rmByTrack, isPrSet } from '@/lib/prs';
import { notationLabel, trackName } from '@/lib/notations';
import { useStopwatch } from '@/lib/useTimer';
import { weekFromDate } from '@/lib/week';
import { blockForWeek, nextWeekForDay, planWeekByLog, planWeekCount } from '@/lib/progression';
import {
  ACTIVITY_TAGS,
  METRICS,
  NOTATIONS,
  VARIATION_KINDS,
  PRIMARY_METRICS,
  SECTIONS,
  TIMERS,
  JUMP_MARK,
  type MetricKey,
  type SectionKey,
} from '@/app.config';
import { DEFAULT_PRIMARY_METRIC } from '@/lib/metrics';
import type {
  GroupKind,
  LogDocument,
  LogItem,
  LogStatus,
  Movement,
  MovementSub,
  Plan,
  ScalingLevel,
  Session,
  SetActual,
  VibeCheck,
  WorkoutLog,
} from '@/lib/types';
import { Button, FIELD, LoadingScreen, SectionHeader } from '@/components/ui/primitives';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { Modal } from '@/components/ui/Modal';
import { EASE } from '@/components/anim';
import { SetRow } from '@/components/logger/SetRow';
import { SetEntrySheet } from '@/components/logger/SetEntrySheet';
import { FocusItem } from '@/components/logger/FocusItem';
import { firstOpenSet, nextOpenSet } from '@/components/logger/focusSet';
import { MovementPicker } from '@/components/logger/MovementPicker';
import { SubroutineEditor } from '@/components/logger/SubroutineEditor';
import { VibeCheckCard } from '@/components/logger/VibeCheckCard';
import {
  FinishDetailsSheet,
  type FinishDetails,
  type LastHeartRate,
} from '@/components/logger/FinishDetailsSheet';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  LinkGlyph,
  MoreGlyph,
  PlusGlyph,
  TrashGlyph,
  UnlinkGlyph,
} from '@/components/ui/icons';
import { toast } from '@/lib/toast';

// Only the primary-eligible metrics cycle. `weight` and `rpe` are still real
// per-set fields and still resolve on stored rows, but neither is a primary any
// more: weight is an always-on field on reps/time/distance, and rpe was never a
// primary that rendered anything. See PRIMARY_METRICS in app.config.ts.
const METRIC_CYCLE: MetricKey[] = [...PRIMARY_METRICS];
// The metric a tap on the metric button moves to. indexOf is -1 for a legacy
// `weight`/`rpe` row, which would otherwise jump to index 1 and skip the first
// option, so "not in the cycle" is treated as "before the start".
const nextMetric = (current: MetricKey): MetricKey => {
  const at = METRIC_CYCLE.indexOf(current);
  return METRIC_CYCLE[at < 0 ? 0 : (at + 1) % METRIC_CYCLE.length];
};

// Shared by every icon-only control in a movement card's bands: a real 44px
// target (TOUCH.minTargetPx) holding a ~18px glyph, with no gap between
// neighbours so the cluster reads as one toolbar rather than four buttons.
const ICON_BTN =
  'hill-btn flex h-11 w-11 shrink-0 items-center justify-center transition-colors';
const GLYPH = 'h-[1.15rem] w-[1.15rem]';
// Counts toward's value for "leave this log on the (inactive) plan it is on".
const KEEP_LINK = '__keep';

// The newest other finished session that logged a heart rate — where the
// finish sheet's HR wheels rest. getAllLogs orders by date only, so a same-day
// pair is split by started_at.
function lastHeartRate(logs: WorkoutLog[], currentId: string | null): LastHeartRate | null {
  let best: WorkoutLog | null = null;
  const key = (l: WorkoutLog) => `${l.log_date}|${l.started_at ?? ''}`;
  for (const l of logs) {
    if (l.id === currentId || l.status !== 'done') continue;
    if (l.hr_avg == null && l.hr_max == null) continue;
    if (!best || key(l) > key(best)) best = l;
  }
  return best ? { avg: best.hr_avg, max: best.hr_max } : null;
}

function clock(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const sectionLabel = (k: SectionKey) => k.charAt(0).toUpperCase() + k.slice(1);

// The SetActual field a timed, distance or calorie movement is scored in. Reps
// have their own precedence (plannedReps) and weight/rpe are not primaries.
const PRIMARY_FIELD: Partial<Record<MetricKey, 'time' | 'distance' | 'calories'>> = {
  time: 'time',
  distance: 'distance',
  cal: 'calories',
};
const today = () => new Date().toISOString().slice(0, 10);

// What a finished movement reads as in the Done pile: the same comma-joined
// actuals the completed-session surfaces use (LogQuickView, SessionDetail), so
// a workout looks the same the moment it is done as it does when reopened.
const doneSetSummary = (item: LogItem) =>
  item.sets.map((s) => formatSetActual(s.actual)).join(', ');

// Notations are stored per set but toggled per item (toggleItemNotation writes
// every set), so the union IS the movement's tag set. Rendered as a subscript
// after the name rather than a chip row — it is provenance, not a control.
const doneNotations = (item: LogItem) =>
  Array.from(new Set(item.sets.flatMap((s) => s.notations)));

type Picker =
  | { mode: 'add'; sectionKey: SectionKey }
  | { mode: 'swap'; si: number; gi: number; ii: number };

type SubEditor =
  | { mode: 'add'; sectionKey: SectionKey }
  | { mode: 'edit'; si: number; gi: number; ii: number };

// Brings the focus card into view when the focus moves to a DIFFERENT movement
// group — after logging a movement's last set, or tapping an Up-next row. Not
// on first render (the page opens where it opens), and not when the live set
// moves between members of one superset: that card is already on screen.
// scrollIntoView scrolls the nearest scrollable ancestor, which under the app
// shell is `[data-scroll-root]`, never the document (see CLAUDE.md). The
// scroll margin clears the sticky app header. Reduced motion jumps instead of
// gliding. No focus() call: moving keyboard focus into a field here would
// raise the iOS keyboard mid-layout.
// `last` lives in the Logger, not here: the anchor remounts when the focus
// crosses into another section, and a ref of its own would forget where the
// focus had been and skip exactly that scroll.
function FocusAnchor({
  groupId,
  last,
  children,
}: {
  groupId: string;
  last: { current: string | null };
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const prev = last.current;
    last.current = groupId;
    if (prev === null || prev === groupId) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    ref.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }, [groupId, last]);
  return (
    <div ref={ref} data-focus-anchor className="scroll-mt-20">
      {children}
    </div>
  );
}

export default function Logger() {
  const [ready, setReady] = useState(false);
  const [logId, setLogId] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [doc, setDoc] = useState<LogDocument>({ sections: [] });
  const [status, setStatus] = useState<LogStatus>('in_progress');
  const [saving, setSaving] = useState(false);
  // Set when an autosave round-trip fails, cleared when one succeeds.
  const [unsaved, setUnsaved] = useState(false);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [subs, setSubs] = useState<MovementSub[]>([]);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [subEditor, setSubEditor] = useState<SubEditor | null>(null);
  const [optionsFor, setOptionsFor] = useState<{ si: number; gi: number; ii: number } | null>(null);
  // "Vary by set" under the rest tags: collapsed per opening of the sheet, and
  // forced open whenever a set already carries its own rest.
  const [varyRest, setVaryRest] = useState(false);
  useEffect(() => setVaryRest(false), [optionsFor]);
  // Which set the entry sheet is editing. Set rows are read-only summaries;
  // all numeric entry happens in SetEntrySheet.
  const [entryFor, setEntryFor] = useState<{ si: number; gi: number; ii: number; ki: number } | null>(
    null,
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  // Which movements' notes are expanded past the one-line clamp — keyed by
  // item id, same shape as `collapsed`.
  const [notesOpen, setNotesOpen] = useState<Set<string>>(new Set());
  const toggleNotesOpen = (id: string) =>
    setNotesOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  // Movement whose demo GIF popup is open, by name (the demo mapping is
  // name-keyed). One sheet for the whole logger, opened from the header icon.
  const [demoFor, setDemoFor] = useState<string | null>(null);
  // Completed groups that have been "parked" into the Done list at the bottom. A
  // fully-complete group parks only once the user starts a DIFFERENT movement
  // (deferred), so nothing jumps away mid-set. Parked groups render collapsed but
  // stay fully editable. `activate(id)` is called on any interaction with a
  // movement: it parks every OTHER already-complete group, in completion order.
  const [parked, setParked] = useState<Set<string>>(new Set());
  const activate = (groupId: string) => {
    const toPark = doc.sections
      .flatMap((s) => s.groups)
      .filter((g) => g.completedAt && g.id !== groupId)
      .map((g) => g.id);
    if (toPark.length === 0) return;
    const addAll = (prev: Set<string>) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of toPark)
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      return changed ? next : prev;
    };
    setParked(addAll);
    setCollapsed(addAll);
  };
  // Which movement the focus card shows. Null = follow the work: the first
  // group, in section order, with a set still to log (nextOpenSet). Tapping an
  // Up-next row pins a group (and, in a superset, a member); logging a set
  // drops the member pin so the card follows the round order across the group,
  // and finishing the group drops the pin entirely so the card advances.
  const [focus, setFocus] = useState<{ groupId: string; itemId?: string } | null>(null);
  // The group the focus card last showed, for FocusAnchor's scroll-on-move.
  const lastFocusGroup = useRef<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Finish always asks for type / duration / HR in a sheet; `rowHr` is a
  // resumed row's heart rate, which the sheet starts on.
  const [askDetails, setAskDetails] = useState(false);
  const [rowHr, setRowHr] = useState<LastHeartRate | null>(null);
  const [lastHr, setLastHr] = useState<LastHeartRate | null>(null);
  // The Done pile is open by default — you should see what you've finished —
  // but it folds away as one unit when the remaining work needs the screen.
  const [doneOpen, setDoneOpen] = useState(true);
  // The folded empty-sections row's dropdown pick.
  const [foldPick, setFoldPick] = useState<SectionKey | null>(null);
  // Date + tags are correct on the common path, so they start folded away —
  // they were costing ~120px (three wrapped rows at 375px) above the first set.
  const [showDetails, setShowDetails] = useState(false);
  const [showVibe, setShowVibe] = useState(false);
  const [logDate, setLogDate] = useState<string>(today());
  const [tags, setTags] = useState<string[]>([]);
  // Pre-session all-time best e1RM per movement, for the PR ring on completion.
  const [bestByMovement, setBestByMovement] = useState<Map<string, number>>(new Map());
  const [startedAt, setStartedAt] = useState<string | null>(null);
  // The saved-session template this workout was launched from (or resumed
  // into via its logged session_id), kept only for its display metadata —
  // source / source_text / instructions — under Session details. Null for
  // plan days and blank workouts, which have none of these fields.
  const [linkedSession, setLinkedSession] = useState<Session | null>(null);
  // Which plan day and cycle this session is, and that day's note for it. The
  // day and cycle sit under the clock so they can be checked mid-workout; the
  // note stays under Session details rather than as a card in the workout.
  const [cycle, setCycle] = useState<{ day: string; week: number; of: number; note?: string } | null>(null);
  // Editing a past workout (opened via ?logId=…&edit=1): reuse every logging
  // control but freeze the live-session behaviors (stopwatch, auto-end, finish).
  const [editing, setEditing] = useState(false);
  // Set when this page was asked to START a workout while another one is
  // still running. Nothing is created until the user answers.
  const [blockedBy, setBlockedBy] = useState<{ log: WorkoutLog; label: string } | null>(null);
  // ---- a log a friend sent (the retired friends plan (git show edd9f53:docs/FRIENDS_SHARING_PLAN.md; now SPEC §7C) §5.4–5.6, §12.3) ----
  // Review mode: this row is `needs_review` — the friend's numbers until
  // Confirm. `sender` is read from the shared_items row, else "a friend".
  const [review, setReview] = useState<{ sender: string; sharedItemId: string | null } | null>(null);
  // The ordered subset the inbox handed over (`&queue=`); Confirm steps to the
  // next row of it that is still waiting.
  const [queue, setQueue] = useState<string[]>([]);
  // My own counted log on the same day, and the duplicates sheet over it.
  const [dup, setDup] = useState<{ log: WorkoutLog; overlap: number } | null>(null);
  const [dupOpen, setDupOpen] = useState(false);
  // "Use shared": on Confirm, delete my original — after asking once more.
  const [replaceMine, setReplaceMine] = useState(false);
  const [askReplace, setAskReplace] = useState(false);
  const [askDiscardReview, setAskDiscardReview] = useState(false);
  // Combine: this is MY log with the review row's extra movements merged in
  // (unsaved until Save combined, which also deletes the review row).
  const [combine, setCombine] = useState<{ reviewId: string; sender: string } | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  // Counts toward: the active plan's days for a review row or any log that
  // came from a share. `others` is my history without this row (its own link
  // must not count as that day already logged). `dirty` = write on save.
  const [link, setLink] = useState<{
    plan: Plan;
    others: WorkoutLog[];
    choice: string;
    dirty: boolean;
    orig: Pick<WorkoutLog, 'plan_id' | 'day_key' | 'week_number'>;
  } | null>(null);
  const [leaving, setLeaving] = useState(false);

  const stopwatch = useStopwatch(0, false);

  const docRef = useRef(doc);
  const secondsRef = useRef(stopwatch.seconds);
  const statusRef = useRef(status);
  const idRef = useRef(logId);
  const logDateRef = useRef(logDate);
  const tagsRef = useRef(tags);
  const startedAtRef = useRef(startedAt);
  const editingRef = useRef(editing);
  const autoEndedRef = useRef(false);
  // Combine holds an unsaved merge: autosave and the instant date/tag writes
  // stand down so leaving mid-way changes nothing.
  const combineRef = useRef(false);
  // Set by the Home button so the unload guard below stands down for the one
  // exit that is deliberate and already flushed.
  const leavingRef = useRef(false);
  docRef.current = doc;
  secondsRef.current = stopwatch.seconds;
  statusRef.current = status;
  idRef.current = logId;
  logDateRef.current = logDate;
  tagsRef.current = tags;
  startedAtRef.current = startedAt;
  editingRef.current = editing;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        window.location.href = '/login';
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const resumeId = params.get('logId');
      let editMode = params.get('edit') === '1';
      setEditing(editMode);
      const library = await getMovements();
      setMovements(library);

      if (resumeId) {
        const log = await getLogById(resumeId);
        if (log) {
          // A friend's unconfirmed row is never a live session: whatever the
          // URL said, it opens in the editor (no clock, no autoEnd, no Finish).
          if (log.status === 'needs_review' && !editMode) {
            editMode = true;
            setEditing(true);
          }
          setLogId(log.id);
          setPlanId(log.plan_id);
          setDayKey(log.day_key);
          setDoc(log.data ?? { sections: [] });
          setStatus(log.status);
          setLogDate(log.log_date);
          setTags(log.tags ?? []);
          if (log.hr_avg != null || log.hr_max != null) setRowHr({ avg: log.hr_avg, max: log.hr_max });
          // Not awaited: only the finish sheet reads it, and the history is
          // usually already cached by the page that sent you here.
          loadAllLogs().then((logs) => setLastHr(lastHeartRate(logs, log.id)));
          if (log.plan_id) setSubs(await getMovementSubs(log.plan_id));
          if (log.session_id) setLinkedSession(await getSessionById(log.session_id));
          if (log.plan_id && log.day_key && log.week_number) {
            const plan = await getPlanById(log.plan_id);
            const day = plan?.parsed.days.find((d) => d.dayKey === log.day_key);
            if (plan && day) {
              setCycle({
                day: day.label,
                week: log.week_number,
                of: planWeekCount(plan.parsed),
                note: day.notesByWeek?.[log.week_number],
              });
            }
          }
          setStartedAt(log.started_at);
          // Seed the clock BEFORE starting it. Without this the stopwatch
          // resumed from 0 and the autosave wrote that straight over the real
          // duration — see docs/LESSONS.md § "a resumed session's duration
          // resets to zero". A live session is wall-clock since started_at (you
          // can leave the Logger and browse the app while it runs, so the time
          // away counts); anything else seeds from its recorded duration.
          if (!editMode) {
            const live = log.status === 'in_progress' && log.started_at;
            stopwatch.set(
              live
                ? Math.min(
                    TIMERS.maxWorkoutSeconds,
                    Math.floor((Date.now() - new Date(log.started_at!).getTime()) / 1000),
                  )
                : (log.total_seconds ?? 0),
            );
            // Editing a past workout keeps the recorded duration frozen.
            if (live) stopwatch.start();
          }
          if (editMode) await setupShared(log, params);
        }
        setReady(true);
        return;
      }

      const dk = params.get('day');
      const sessionParam = params.get('session');
      const levelParam = (params.get('level') ?? undefined) as ScalingLevel | undefined;
      const planParam = params.get('plan');
      const miniParam = params.get('mini');
      const dateParam = params.get('date');
      const logDate = dateParam ?? today();

      // Source the workout from a saved session, a specific (possibly historic)
      // plan day, or — by default — the active plan.
      const [source, allLogs] = await Promise.all([
        sessionParam
          ? getSessionById(sessionParam)
          : planParam
            ? getPlanById(planParam)
            : getActivePlan(),
        loadAllLogs(),
      ]);
      // A needs_review row holds a friend's numbers: never a prefill or PR source.
      const counted = withoutUnreviewed(allLogs);
      const recent = newestLogs(counted, 50);
      setBestByMovement(bestE1rmByTrack(counted));
      setLastHr(lastHeartRate(allLogs, null));

      // Everything below builds and creates a NEW row, so this is the one
      // place every entry point converges on — the Home CTA and its ⋯ chooser,
      // the tab bar +, the calendar, the plan and the saved-session lists all
      // land here. Gating a second start here covers all of them at once;
      // wiring a confirm into each chooser would not. Nothing has been created
      // at this point, so answering the gate is free either way.
      const running = activeSessionOf(allLogs);
      if (running) {
        const plan = sessionParam ? null : (source as Plan | null);
        const runningDay = running.day_key
          ? plan?.parsed.days.find((d) => d.dayKey === running.day_key)
          : undefined;
        setBlockedBy({
          log: running,
          label: runningDay ? typeFromLabel(runningDay.label) : 'workout',
        });
        setReady(true);
        return;
      }

      let built: LogDocument;
      let weekNumber: number | null = null;
      let linkedPlanId: string | null = null;
      let linkedSessionId: string | null = null;
      let linkedDayKey: string | null = dk;
      let initialTags: string[] = [];

      if (sessionParam) {
        const session = source as Session | null;
        built = session ? buildLogFromSession(session.frame, levelParam) : buildBlankLog();
        linkedSessionId = session?.id ?? null;
        initialTags = session?.tags ?? [];
        linkedDayKey = null;
        setLinkedSession(session);
      } else {
        const plan = source as Plan | null;
        if (plan && dk) {
          const planDay = plan.parsed.days.find((d) => d.dayKey === dk);
          if (planDay) {
            // Active plan: the week is the plan cycle this log falls in (see
            // planCycles) — grounded in real logging rather than the calendar.
            // A historic plan day (launched via ?plan=) still derives its week
            // from the plan's start date, falling back to a week that has content.
            weekNumber = planParam
              ? resolveWeek(planDay, weekFromDate(plan.start_date, new Date(logDate)))
              : nextWeekForDay(allLogs, plan.id, dk, planWeekCount(plan.parsed));
            const openedWeek = resolveWeek(planDay, weekNumber);
            built = buildLogFromPlanDay(planDay, openedWeek);
            setCycle({
              day: planDay.label,
              week: openedWeek,
              of: planWeekCount(plan.parsed),
              note: planDay.notesByWeek?.[openedWeek],
            });
            // "Short on time?" — trim to a mini of the same plan day (primary
            // work intact). plan_id + day_key still link it, so it stays on-plan.
            if (miniParam === 'express' || miniParam === 'half') {
              built = reduceLogDocument(built, miniParam as MiniPreset);
            }
          } else {
            built = buildBlankLog();
          }
          linkedPlanId = plan.id;
        } else {
          built = buildBlankLog();
        }
      }

      // Which prior logs must not seed a prefill. A deload's reduced load is
      // not the base the next hard week builds on — without this, week 6 of an
      // intensification block inherited week 5's deload weights rather than
      // stepping up from week 4. A deload week itself still reads the last week
      // that was pushed, which is what the reduced prescription is relative to.
      const skipLogIds = new Set<string>();
      const planSource = sessionParam ? null : (source as Plan | null);
      if (planSource && weekNumber != null) {
        const blocks = planSource.parsed.blocks;
        if (blockForWeek(blocks, weekNumber) !== 'deload') {
          const weekByLog = planWeekByLog(planSource.id, allLogs, planWeekCount(planSource.parsed));
          for (const [logId, w] of weekByLog) {
            if (blockForWeek(blocks, w) === 'deload') skipLogIds.add(logId);
          }
        }
      }

      // Prefill, per set. The plan's target owns what it states for the
      // movement's own metric — reps, seconds, metres or calories — so a
      // programmed increase lands (see plannedReps). The last logged set owns
      // load and effort once there is one; until then the plan's "@kg" and
      // "RPE" stand in, so a movement's first session opens on the plan.
      for (const section of built.sections) {
        for (const group of section.groups) {
          for (const item of group.items) {
            const last = lastPerformance(recent, item.movement, skipLogIds);
            const field = PRIMARY_FIELD[item.primaryMetric];
            item.sets = item.sets.map((set) => {
              const plan = plannedTarget(set.planned, item.primaryMetric);
              const repTarget = plannedReps(set.planned, item.primaryMetric);
              // When the rep target moved, the LOAD has to move with it: the
              // reference weight is re-priced to hold the same estimated 1RM,
              // so a block that cuts reps prescribes more weight instead of
              // repeating last block's.
              const lastWeight =
                last && item.primaryMetric === 'weight'
                  ? (repAdjustedWeight(last.weight, last.reps, repTarget) ?? last.weight)
                  : last?.weight;
              const patch: Partial<SetActual> = {};
              const weight = lastWeight ?? plan.weight;
              if (weight != null) patch.weight = weight;
              const reps = repTarget ?? last?.reps;
              if (reps != null) patch.reps = reps;
              if (field) {
                const value = plan.value ?? last?.[field];
                if (value != null) patch[field] = value;
              }
              const rpe = last?.rpe ?? plan.rpe;
              if (rpe != null) patch.rpe = rpe;
              // A box height or a distance mark carries over like a load: last
              // session's is the reference the athlete tries to match or beat.
              if (last?.mark != null && markKindOf(item)) patch.mark = last.mark;
              if (Object.keys(patch).length === 0) return set;
              return { ...set, actual: { ...set.actual, ...patch, prefilled: true, rpeRated: false } };
            });
          }
        }
      }

      const startedIso = new Date().toISOString();
      const created = await createLog({
        log_date: logDate,
        plan_id: linkedPlanId,
        day_key: linkedDayKey,
        week_number: weekNumber,
        status: 'in_progress',
        started_at: startedIso,
        data: built,
        tags: initialTags,
        // Only attach session_id when launched from a saved session, so plan /
        // blank / activity workouts don't depend on migration 0008 being live.
        ...(linkedSessionId ? { session_id: linkedSessionId } : {}),
      });
      setDoc(built);
      setLogDate(logDate);
      setPlanId(linkedPlanId);
      setDayKey(linkedDayKey);
      setTags(initialTags);
      if (created) setLogId(created.id);
      setStartedAt(startedIso);
      if (linkedPlanId) setSubs(await getMovementSubs(linkedPlanId));
      setShowVibe(true);
      // Anchored to started_at, not to now: the create and the subs fetch
      // above are network round-trips, and Finish's duration is meant to be
      // exactly end − started_at for a session that was never paused.
      stopwatch.set(Math.floor((Date.now() - new Date(startedIso).getTime()) / 1000));
      stopwatch.start();
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seed the Done list from a reopened workout: any group already stamped
  // complete parks (collapsed), ordered by completedAt at render time.
  useEffect(() => {
    if (!ready) return;
    const done = doc.sections.flatMap((s) => s.groups).filter((g) => g.completedAt);
    if (done.length === 0) return;
    const ids = done.map((g) => g.id);
    setParked(new Set(ids));
    setCollapsed((prev) => new Set([...prev, ...ids]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Un-park a group that has gone incomplete (e.g. a set was added or unticked
  // while editing it in Done) — completedAt is cleared, so it returns to its
  // section.
  useEffect(() => {
    setParked((prev) => {
      if (prev.size === 0) return prev;
      const stillDone = new Set(
        doc.sections.flatMap((s) => s.groups).filter((g) => g.completedAt).map((g) => g.id),
      );
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (stillDone.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [doc]);

  useEffect(() => {
    const id = setInterval(async () => {
      if (!idRef.current || combineRef.current) return;
      // When editing a past workout, persist the document/date/tags regardless
      // of status, but never touch the recorded duration or status/ended_at.
      if (editingRef.current) {
        setSaving(true);
        const ok = await updateLog(idRef.current, {
          data: docRef.current,
          log_date: logDateRef.current,
          tags: tagsRef.current,
        });
        setSaving(false);
        setUnsaved(!ok);
        return;
      }
      if (statusRef.current === 'done' || statusRef.current === 'cancelled') return;
      setSaving(true);
      const ok = await updateLog(idRef.current, {
        data: docRef.current,
        total_seconds: secondsRef.current,
        status: statusRef.current,
        log_date: logDateRef.current,
        tags: tagsRef.current,
      });
      setSaving(false);
      // A gym is exactly where the connection drops. updateLog's result was
      // being thrown away, so a failed autosave looked identical to a good one.
      setUnsaved(!ok);
    }, TIMERS.autosaveSeconds * 1000);
    return () => clearInterval(id);
  }, []);

  // Warn before a tab close / back-navigation drops up to one autosave interval
  // of entry. Only while a live session is actually in progress.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (leavingRef.current) return;
      if (editingRef.current) return;
      if (statusRef.current === 'done' || statusRef.current === 'cancelled') return;
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Auto-end an in-progress workout once it has been running over 2 hours
  // (wall-clock since started_at) — covers sessions left open and reopened. Caps
  // the duration at 2:00 and notifies; the user can edit the end time later.
  async function autoEnd() {
    if (
      autoEndedRef.current ||
      statusRef.current === 'done' ||
      statusRef.current === 'cancelled' ||
      // An accepted-from-a-friend row awaiting review is not a live session.
      statusRef.current === 'needs_review'
    ) {
      return;
    }
    autoEndedRef.current = true;
    setStatus('done');
    stopwatch.pause();
    const start = startedAtRef.current;
    const endedIso = start
      ? new Date(new Date(start).getTime() + TIMERS.maxWorkoutSeconds * 1000).toISOString()
      : new Date().toISOString();
    if (idRef.current) {
      await updateLog(idRef.current, {
        data: docRef.current,
        total_seconds: TIMERS.maxWorkoutSeconds,
        status: 'done',
        ended_at: endedIso,
        log_date: logDateRef.current,
        tags: tagsRef.current,
      });
      await persistDocumentMovements(docRef.current);
    }
    toast('Workout passed 2 hours — auto-ended at 2:00. You can edit the time anytime.', 'success');
  }

  useEffect(() => {
    if (!ready || editing || status !== 'in_progress' || !startedAt) return;
    const check = () => {
      const elapsed = (Date.now() - new Date(startedAt).getTime()) / 1000;
      if (elapsed >= TIMERS.maxWorkoutSeconds) autoEnd();
    };
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, status, startedAt]);

  // Review, combine and Counts toward, for a log opened in the editor. Only
  // reads; nothing is written until Confirm / Save combined / Done.
  async function setupShared(log: WorkoutLog, params: URLSearchParams) {
    const q = parseQueue(params.get('queue'));
    setQueue(q);
    const combineId = params.get('combine');
    const needsReview = log.status === 'needs_review';
    if (!needsReview && !combineId && !log.shared_item_id) return;
    const allLogs = await loadAllLogs();

    if (combineId && !needsReview && combineId !== log.id) {
      const other = await getLogById(combineId);
      if (other && other.status === 'needs_review') {
        const item = other.shared_item_id ? await getSharedItem(other.shared_item_id) : null;
        const merged = unionLogs(log.data ?? { sections: [] }, other.data ?? { sections: [] });
        combineRef.current = true;
        setDoc(merged.doc);
        setAddedIds(new Set(merged.addedItemIds));
        setCombine({ reviewId: other.id, sender: item?.sender_name || 'a friend' });
        return;
      }
    }

    if (needsReview) {
      const item = log.shared_item_id ? await getSharedItem(log.shared_item_id) : null;
      setReview({ sender: item?.sender_name || 'a friend', sharedItemId: log.shared_item_id ?? null });
      const same = sameDayOverlap(log.data ?? { sections: [] }, log.log_date, allLogs, log.id);
      if (same) {
        setDup(same);
        setDupOpen(true);
      }
    }

    const plan = await getActivePlan();
    if (!plan) return;
    const others = allLogs.filter((l) => l.id !== log.id);
    let choice = '';
    if (needsReview) {
      choice = choosePlanDay({ doc: log.data ?? { sections: [] }, logDate: log.log_date, plan, logs: others })?.day_key ?? '';
    } else if (log.plan_id === plan.id && log.day_key) {
      choice = log.day_key;
    } else if (log.plan_id) {
      choice = KEEP_LINK;
    }
    setLink({
      plan,
      others,
      choice,
      dirty: needsReview,
      orig: { plan_id: log.plan_id, day_key: log.day_key, week_number: log.week_number },
    });
  }

  // The plan link to write on save: a PlanLink, null to detach, or undefined
  // to leave the row's link alone (control untouched, or "keep").
  function chosenLink(): PlanLink | null | undefined {
    if (!link) return review ? null : undefined;
    if (!link.dirty || link.choice === KEEP_LINK) return undefined;
    if (link.choice === '' || !canLinkOnDate(link.plan, link.others, logDateRef.current)) return null;
    if (link.orig.plan_id === link.plan.id && link.orig.day_key === link.choice && link.orig.week_number != null) {
      return { plan_id: link.plan.id, day_key: link.choice, week_number: link.orig.week_number };
    }
    return planLinkFor(link.plan, link.choice, link.others);
  }

  function stopWriting() {
    leavingRef.current = true;
    idRef.current = null;
    setLogId(null);
    setLeaving(true);
  }

  // Confirm (§5.4.2): `done`, the movements swept into the library, the plan
  // link from Counts toward; Use shared then deletes my original. Then the
  // next row of the queue, or the inbox.
  async function confirmReview(deleteMine: boolean) {
    const id = idRef.current;
    if (!id || leaving) return;
    setLeaving(true);
    const ok = await updateLog(id, {
      data: docRef.current,
      log_date: logDateRef.current,
      tags: tagsRef.current,
      ...confirmPatch(chosenLink() ?? null),
    });
    if (!ok) {
      setLeaving(false);
      toast('Save failed — check your connection and try again', 'error');
      return;
    }
    statusRef.current = 'done';
    setStatus('done');
    await persistDocumentMovements(docRef.current);
    if (deleteMine && dup && !(await deleteLog(dup.log.id))) {
      toast("Confirmed, but your original couldn't be deleted. Delete it from its session page.", 'error');
    }
    stopWriting();
    window.location.href = await nextReviewAfter(queue, id);
  }

  // Discard / Keep mine: the review row goes. Through remove_accepted_items so
  // the inbox item reads "Removed"; a row whose item is gone, or still pending
  // (the accept's status write failed), is deleted directly.
  async function discardReview() {
    const id = idRef.current;
    if (!id || leaving) return;
    setLeaving(true);
    const removed = review?.sharedItemId ? await removeAcceptedItems([review.sharedItemId], false) : null;
    const ok = (removed?.total ?? 0) > 0 || (await deleteLog(id));
    if (!ok) {
      setLeaving(false);
      toast('Discard failed — check your connection and try again', 'error');
      return;
    }
    stopWriting();
    window.location.href = await nextReviewAfter(queue, id);
  }

  // Save combined: my log takes the merge, then the review row is deleted.
  async function saveCombined() {
    const id = idRef.current;
    if (!id || !combine || leaving) return;
    setLeaving(true);
    const ok = await updateLog(id, { data: docRef.current, log_date: logDateRef.current, tags: tagsRef.current });
    if (!ok) {
      setLeaving(false);
      toast('Save failed — check your connection and try again', 'error');
      return;
    }
    await persistDocumentMovements(docRef.current);
    if (!(await deleteLog(combine.reviewId))) {
      toast("Combined, but the friend's copy couldn't be removed. Discard it from the inbox.", 'error');
    }
    stopWriting();
    window.location.href = await nextReviewAfter(queue, combine.reviewId);
  }

  function saveVibe(vibe: VibeCheck) {
    setDoc((d) => ({ ...d, session: { ...d.session, vibe } }));
    setShowVibe(false);
  }

  function changeDate(value: string) {
    setLogDate(value);
    if (idRef.current && !combineRef.current) updateLog(idRef.current, { log_date: value });
  }

  function toggleTag(tag: string) {
    setTags((prev) => {
      const next = prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag];
      if (idRef.current && !combineRef.current) updateLog(idRef.current, { tags: next });
      return next;
    });
  }

  // A movement typed into the picker's "Add …" row exists only inside this
  // workout unless it is written to the library — which is why a custom swap
  // could not be searched for in the next session. Not awaited: the pick has
  // already been applied to the document, so a failed insert costs the library
  // entry, not the set — and `finish` sweeps the document and retries it.
  async function persistCustomMovement(
    name: string,
    metric: MetricKey,
    library?: Movement[],
  ): Promise<boolean> {
    const known = library ?? movements;
    // The library is never empty — it carries the shared rows — so an empty one
    // means the load failed. Inserting against it would duplicate every shared
    // movement as a custom row; leave it to the sweep, which reloads.
    if (known.length === 0) return false;
    if (resolveMovement(name, known)) return true;
    const created = await createMovement({
      name,
      category: null,
      primary_metric: metric,
      default_rest_seconds: TIMERS.defaultRestSeconds,
    });
    if (!created) return false;
    // The sweep's working copy, so a name repeated in one document inserts once.
    library?.push(created);
    setMovements((prev) =>
      [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
    );
    track('movement_created', { category: null, primary_metric: metric, source: 'logger' });
    return true;
  }

  // Every movement in the saved document gets a library row, so it is
  // searchable next time. Covers a pick whose insert failed mid-workout (a
  // phone in a gym loses signal; the error used to vanish), plan-prefilled
  // names, and anything else that reached the document without the picker.
  // Runs on every way out of the Logger — finish, finish-edit, auto-end and
  // leave-for-later — and reloads the library first, because the copy loaded
  // at mount may be empty (a failed load) or stale (a row added elsewhere).
  async function persistDocumentMovements(d: LogDocument) {
    const library = await getMovements();
    for (const section of d.sections) {
      for (const group of section.groups) {
        for (const item of group.items) {
          const name = item.movement?.trim();
          if (!name || isSubroutine(item)) continue;
          await persistCustomMovement(name, item.primaryMetric ?? DEFAULT_PRIMARY_METRIC, library);
        }
      }
    }
  }

  function handlePick(picked: Movement | { name: string }) {
    const name = 'name' in picked ? picked.name : (picked as Movement).name;
    const known = movements.find((m) => m.name.toLowerCase() === name.toLowerCase());
    const metric: MetricKey =
      'primary_metric' in picked ? (picked as Movement).primary_metric : known?.primary_metric ?? DEFAULT_PRIMARY_METRIC;
    if (!('id' in picked)) {
      persistCustomMovement(name, metric).then((ok) => {
        if (!ok) toast(`Couldn't add “${name}” to your library — will retry when you finish`, 'error');
      });
    }

    if (picker?.mode === 'add') {
      if ('kind' in picked && isSubroutine(picked)) {
        const { sectionKey } = picker;
        setDoc((d) => addSubroutine(d, sectionKey, picked.name, picked.notes ?? '', picked.url ?? undefined));
      } else {
        setDoc((d) => addItem(d, picker.sectionKey, name, metric));
      }
    } else if (picker?.mode === 'swap') {
      const { si, gi, ii } = picker;
      const original = doc.sections[si]?.groups[gi]?.items[ii]?.movement ?? '';
      const swapMetric = 'primary_metric' in picked ? (picked as Movement).primary_metric : known?.primary_metric;
      const current = doc.sections[si]?.groups[gi]?.items[ii]?.primaryMetric ?? DEFAULT_PRIMARY_METRIC;
      setDoc((d) => swapItemMovement(d, si, gi, ii, name, swapMetric ?? current));
      if (planId && original && original.toLowerCase() !== name.toLowerCase()) {
        bumpMovementSub(planId, dayKey, original, name).then(() =>
          getMovementSubs(planId).then(setSubs),
        );
      }
    }
    setPicker(null);
  }

  async function finish(details?: FinishDetails) {
    setStatus('done');
    stopwatch.pause();
    // The sheet opens on the session's tags, so its answer is the whole answer
    // — including deselecting one.
    const finalTags = details ? details.tags : tagsRef.current;
    const finalSeconds = details?.seconds ?? secondsRef.current;
    if (idRef.current) {
      const ok = await updateLog(idRef.current, {
        data: docRef.current,
        total_seconds: finalSeconds,
        status: 'done',
        ended_at: new Date().toISOString(),
        log_date: logDateRef.current,
        tags: finalTags,
        ...(details ? { hr_avg: details.hrAvg, hr_max: details.hrMax } : {}),
      });
      if (!ok) {
        toast('Save failed — check your connection and try again', 'error');
        return;
      }
      await persistDocumentMovements(docRef.current);
    }
    track('workout_completed', { duration_seconds: finalSeconds, tags: finalTags });
    window.location.href = idRef.current ? `/app/session?id=${idRef.current}` : '/app';
  }

  // Discard DELETES the row. It used to flip status to 'cancelled' and leave it
  // behind, which surfaced the discarded session on /app/you and made the user
  // delete it a second time by hand — `getAllLogs` was the one log query of the
  // three that did not filter cancelled out. The confirm copy has always said
  // "This deletes everything logged in this session"; now that is true.
  async function discard() {
    if (idRef.current) {
      const ok = await deleteLog(idRef.current);
      if (!ok) {
        toast('Discard failed — check your connection and try again', 'error');
        return;
      }
    }
    // Only once the row is actually gone, and imperatively as well as through
    // state: autosave and the unload warning read the REF, which React refreshes
    // on the next render, so setStatus alone leaves a window in which a tick
    // could fire against a row that no longer exists.
    statusRef.current = 'cancelled';
    setStatus('cancelled');
    leavingRef.current = true;
    stopwatch.pause();
    track('workout_cancelled', { duration_seconds: secondsRef.current });
    window.location.href = '/app';
  }

  // Leave the Logger WITHOUT ending the session: the row stays `in_progress`,
  // Home's primary CTA turns into "Resume …", and the clock keeps running on
  // wall-clock. The flush is not optional — autosave runs every
  // TIMERS.autosaveSeconds, so walking out between ticks would drop entry.
  //
  // A full navigation rather than a ClientRouter one, matching finish(): a soft
  // nav would leave Home seeded from a stale queryCache entry, so the CTA would
  // paint "Start" and only flip to "Resume" once revalidation landed.
  async function goHome() {
    leavingRef.current = true;
    stopwatch.pause();
    if (idRef.current) {
      const ok = await updateLog(idRef.current, {
        data: docRef.current,
        total_seconds: secondsRef.current,
        status: 'in_progress',
        log_date: logDateRef.current,
        tags: tagsRef.current,
      });
      if (!ok) {
        leavingRef.current = false;
        stopwatch.resume();
        toast('Save failed — check your connection and try again', 'error');
        return;
      }
      await persistDocumentMovements(docRef.current);
    }
    window.location.href = '/app';
  }

  // Finish an edit of a past workout: persist the edited document (plus date/
  // tags) without changing status, duration, or ended_at, then return to the
  // read-only session view.
  async function finishEdit() {
    if (idRef.current) {
      // A log that came from a share may have been attached to (or detached
      // from) a plan day with Counts toward (§12.3); status stays as it is.
      const planLink = chosenLink();
      const ok = await updateLog(idRef.current, {
        data: docRef.current,
        log_date: logDateRef.current,
        tags: tagsRef.current,
        ...(planLink === undefined
          ? {}
          : { plan_id: planLink?.plan_id ?? null, day_key: planLink?.day_key ?? null, week_number: planLink?.week_number ?? null }),
      });
      if (!ok) {
        toast('Save failed — check your connection and try again', 'error');
        return;
      }
      await persistDocumentMovements(docRef.current);
    }
    window.location.href = idRef.current ? `/app/session?id=${idRef.current}` : '/app';
  }

  // Session-wide sets counter for header row 2 and the Finish button. A plain
  // derived value, not a hook — but declared here, above every early return
  // in this component, on purpose: see docs/LESSONS.md § "The whole page is
  // blank, and two of the three audits are green on it" for what a hook
  // placed below an early return does (React error "rendered more hooks than
  // during the previous render", a fully blank page, with audit:shell and
  // audit:mobile both green because an empty DOM vacuously satisfies both).
  // This isn't a hook, so hook order was never at risk —
  // the placement is the same discipline anyway, so nobody has to re-derive
  // that fact the next time something is added near it.
  const sessionSets = doc.sections
    .flatMap((s) => s.groups)
    .flatMap((g) => g.items)
    .filter((it) => !isSubroutine(it))
    .reduce(
      (acc, it) => ({
        done: acc.done + it.sets.filter((s) => s.actual.completed).length,
        total: acc.total + it.sets.length,
      }),
      { done: 0, total: 0 },
    );

  // Plan day and cycle, under the clock. Cycle first and never truncated — it
  // is the part you forget mid-workout; a long day label gives way instead, so
  // this line cannot widen the clock column and push Home/Pause to a new row.
  const cycleLine = cycle ? (
    <div className="flex max-w-48 items-baseline gap-1.5 t-label text-fg tabular-nums">
      <span className="shrink-0">
        Cycle {cycle.week}/{cycle.of}
      </span>
      <span className="truncate text-muted">· {cycle.day}</span>
    </div>
  ) : null;

  if (!ready) return <LoadingScreen />;

  // Asked to START a workout while another one is still running. Nothing has
  // been created yet and there is nothing behind this to look at, so the gate
  // IS the page — rendering the (empty) logging screen under it would read as
  // a blank workout already begun. No safe silent dismiss either: the scrim
  // and Escape both go Home.
  if (blockedBy) {
    return (
      <ErrorBoundary>
        <Modal
          open
          onClose={() => {
            window.location.href = '/app';
          }}
          title="Session already running"
        >
          <div className="flex flex-col gap-4 p-4">
            <p className="text-sm text-muted">
              You have a <span className="capitalize text-fg">{blockedBy.label}</span> session
              running since{' '}
              <span className="tabular-nums text-fg">
                {new Date(blockedBy.log.started_at!).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              . Discarding it deletes everything logged in it, and can't be undone.
            </p>
            <div className="flex flex-col gap-2">
              <Button
                onClick={() => {
                  window.location.href = `/app/log?logId=${blockedBy.log.id}`;
                }}
                className="w-full"
              >
                Resume it
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  const ok = await deleteLog(blockedBy.log.id);
                  if (!ok) {
                    toast('Discard failed — check your connection and try again', 'error');
                    return;
                  }
                  // Re-enter through the front door: with the old session
                  // deleted the gate no longer trips, and the build path
                  // runs exactly as it would have.
                  window.location.reload();
                }}
                className="w-full"
              >
                Discard it and start this one
              </Button>
            </div>
          </div>
        </Modal>
      </ErrorBoundary>
    );
  }

  const ordered = doc.sections
    .slice()
    .sort((a, b) => SECTIONS.indexOf(a.key) - SECTIONS.indexOf(b.key));
  // A section is "live" while it has a group not yet parked in Done.
  const liveSections = ordered.filter((sec) => sec.groups.some((g) => !parked.has(g.id)));
  const emptySections = ordered.filter((sec) => !sec.groups.some((g) => !parked.has(g.id)));
  // The folded row's dropdown: a stale pick (that section has filled up)
  // falls back to the first empty one.
  const foldSection: SectionKey =
    foldPick && emptySections.some((sec) => sec.key === foldPick) ? foldPick : (emptySections[0]?.key ?? 'accessory');
  const addTo = (sectionKey: SectionKey, kind: AddKind) =>
    kind === 'movement' ? setPicker({ mode: 'add', sectionKey }) : setSubEditor({ mode: 'add', sectionKey });
  // Parked (completed) groups collected across all sections, in completion
  // order, rendered under the "Done" header. Real (si, gi) indices are kept so
  // every mutation/handler works exactly as it does in-section.
  const doneGroups = doc.sections
    .flatMap((s, si) => s.groups.map((g, gi) => ({ si, gi, g })))
    .filter(({ g }) => parked.has(g.id))
    .sort((a, b) => (a.g.completedAt ?? '').localeCompare(b.g.completedAt ?? ''));
  // The header says "movements", so count movements — a finished superset is
  // one group and two of them. It used to count groups, which was invisible
  // while the pile showed one card per group and reads as a plain miscount now
  // that every movement has its own row.
  const doneMovements = doneGroups.reduce(
    (n, { g }) => n + g.items.filter((it) => !isSubroutine(it)).length,
    0,
  );
  // The focused movement. Groups in render order (sections by SECTIONS, then
  // their own order), parked ones excluded — the Done pile keeps its own
  // expand-to-full-card path. A pin that no longer resolves (group removed,
  // or parked) falls back to following the work.
  const liveGroups = ordered.flatMap((section) => {
    const si = doc.sections.findIndex((s) => s.key === section.key);
    return doc.sections[si].groups
      .map((g, gi) => ({ si, gi, g }))
      .filter(({ g }) => !parked.has(g.id));
  });
  const pinned = focus ? liveGroups.find(({ g }) => g.id === focus.groupId) : undefined;
  const focused = pinned ?? liveGroups.find(({ g }) => nextOpenSet(g) !== null) ?? null;
  // Which member of the focused group gets the live editor: a pinned member,
  // else the one holding the group's next set in round order, else the first
  // movement. -1 means the group is subroutines only.
  const focusIi = (() => {
    if (!focused) return -1;
    const items = focused.g.items;
    const byPin =
      pinned && focus?.itemId ? items.findIndex((it) => it.id === focus.itemId && !isSubroutine(it)) : -1;
    if (byPin >= 0) return byPin;
    const next = nextOpenSet(focused.g);
    if (next) return next.ii;
    return items.findIndex((it) => !isSubroutine(it));
  })();
  const focusItemId = focused && focusIi >= 0 ? focused.g.items[focusIi].id : null;

  // The session progress strip: one segment per movement in render order,
  // sized by its set count and filled by sets logged.
  const progress = ordered.flatMap((section) => {
    const si = doc.sections.findIndex((s) => s.key === section.key);
    return doc.sections[si].groups.flatMap((g) =>
      g.items
        .filter((it) => !isSubroutine(it) && it.sets.length > 0)
        .map((it) => ({
          id: it.id,
          total: it.sets.length,
          done: it.sets.filter((st) => st.actual.completed).length,
        })),
    );
  });

  // The set the entry sheet is bound to, resolved fresh each render so the sheet
  // always shows current values. Any index that no longer exists (set deleted,
  // movement removed) resolves to null and closes the sheet.
  const entryItem = entryFor
    ? (doc.sections[entryFor.si]?.groups[entryFor.gi]?.items[entryFor.ii] ?? null)
    : null;
  const entrySet =
    entryItem && !isSubroutine(entryItem) ? (entryItem.sets[entryFor!.ki] ?? null) : null;

  const swapSuggestions = (movement: string) =>
    subs
      .filter((s) => s.original.toLowerCase() === movement.toLowerCase())
      .map((s) => ({ id: s.id, replacement: s.replacement, count: s.count }));

  function toggleItemComplete(si: number, gi: number, ii: number) {
    setDoc((d) => {
      const it = d.sections[si].groups[gi].items[ii];
      const everyDone = it.sets.length > 0 && it.sets.every((s) => s.actual.completed);
      let next = d;
      it.sets.forEach((_, ki) => {
        next = patchSetActual(next, si, gi, ii, ki, { completed: !everyDone });
      });
      return next;
    });
  }

  function cloneForward(si: number, gi: number, ii: number, ki: number) {
    // Decided on the current doc so the toast and the edit agree; see
    // copyForward in lib/logEdits.ts for when it may add a set.
    if (copyForward(doc, si, gi, ii, ki).outcome === 'last-open') {
      toast('Last set — log it first, or tap + to add one');
      return;
    }
    setDoc((d) => copyForward(d, si, gi, ii, ki).doc);
  }

  // `footer` rides in the SAME row as Add set rather than a band of its own —
  // the group-level actions belong on one line with it. A single-movement group
  // passes link + remove; each superset member passes unlink + remove.
  function renderItem(
    si: number,
    gi: number,
    ii: number,
    grouped: boolean,
    footer?: { link?: ReactNode; unlink?: ReactNode; remove?: ReactNode },
  ) {
    const group = doc.sections[si].groups[gi];
    const groupId = group.id;
    const item = group.items[ii];
    if (isSubroutine(item)) {
      return (
        <div key={item.id} className={grouped ? 'border-t border-border-soft first:border-0' : ''}>
          {/* Carries its own px-4/py-3 now that the card container is unpadded
              — same band treatment as a movement's identity row. */}
          <div className="flex items-start justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <span className="capitalize text-fg">{item.movement}</span>
              <SubroutineBody description={item.description} url={item.url} className="mt-1" />
            </div>
            <button
              onClick={() => setOptionsFor({ si, gi, ii })}
              className="hill-btn shrink-0 border border-transparent bg-tappable px-2 py-1 t-control text-muted hover:text-fg"
              aria-label="Subroutine options"
            >
              ⋯
            </button>
          </div>
        </div>
      );
    }
    const allDone = item.sets.length > 0 && item.sets.every((s) => s.actual.completed);
    const doneCount = item.sets.filter((s) => s.actual.completed).length;
    // A single-movement group collapses via its own header (tap the movement
    // name). Inside a superset the group header owns collapse, so items here
    // always render their sets.
    const collapsible = !grouped;
    const isCollapsed = collapsible && collapsed.has(groupId);
    // Reserve the planned column for the whole movement, not per row — see the
    // `showPlanned` note in SetRow.
    const anyPlanned = item.sets.some((s) => !!s.planned);
    return (
      <div key={item.id} className={grouped ? 'border-t border-border-soft first:border-0' : ''}>
        {/* BAND 1 — identity. The ✓ is a full-height cell flush with the
            card's edge, divided from the name by a hairline: the whole cell is
            the 44px target, so the visible box and the hit box are the same
            thing. There is no chevron — the name itself is the collapse
            control (aria-expanded carries the state), which bought back the
            width that options (⋯) now takes on the right. */}
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={() => {
              activate(groupId);
              toggleItemComplete(si, gi, ii);
            }}
            // No `hill-btn`, and the reason is no longer the fill: the global
            // `.hill-btn[aria-pressed]` rule now paints accent / tappable, which
            // is what this cell wants. But `.hill-btn`'s border-radius is
            // unlayered too, so it would round all four corners of a cell that
            // sits flush against the card edge and beat the per-corner
            // rounded-*-card below that keeps the fill inside a standalone
            // card's radius — and its hover/press `border-color` would outline
            // the cell. So this paints its own fill, on = accent, off = tappable.
            className={`flex w-11 shrink-0 items-center justify-center border-r text-sm transition-colors ${
              grouped ? '' : `rounded-tl-card ${isCollapsed ? 'rounded-bl-card' : ''}`
            } ${allDone ? 'border-r-accent bg-accent text-accent-fg' : 'border-r-transparent bg-tappable text-muted'}`}
            aria-label="Complete movement"
            aria-pressed={allDone}
          >
            <span aria-hidden>✓</span>
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2 pl-2.5">
            {collapsible ? (
              <button
                type="button"
                onClick={() => {
                  activate(groupId);
                  toggleCollapse(groupId);
                }}
                className="flex min-h-11 min-w-0 items-center text-left text-fg"
                aria-expanded={!isCollapsed}
              >
                <span className="truncate capitalize">{item.movement}</span>
              </button>
            ) : (
              <span className="flex min-h-11 min-w-0 items-center text-fg">
                <span className="truncate capitalize">{item.movement}</span>
              </span>
            )}
            {/* Video icon sits inline right after the name, same row, no vertical
                offset. Renders nothing when the movement has no demo. Opens the
                popup; tapping the scrim (or Escape) closes it. */}
            <DemoIconButton name={item.movement} onOpen={() => setDemoFor(item.movement)} />
            {/* Combine marks what came in from the friend's log (§5.5). */}
            {addedIds.has(item.id) ? <span className="shrink-0 t-label text-muted">Added</span> : null}
          </div>
          <button
            onClick={() => setOptionsFor({ si, gi, ii })}
            className={`${ICON_BTN} self-center text-muted hover:text-fg`}
            aria-label="Movement options"
            title="Movement options"
          >
            <MoreGlyph className={GLYPH} />
          </button>
          {isCollapsed ? (
            <span className="flex shrink-0 items-center pr-4 t-control text-muted">
              {item.sets.length} {item.sets.length === 1 ? 'set' : 'sets'}
              {allDone ? ' · done' : ''}
            </span>
          ) : (
            /* Per-movement done/total, hard right in the identity band. */
            <span className="flex shrink-0 items-center pr-4 t-label text-faint tabular-nums">
              {doneCount}/{item.sets.length}
            </span>
          )}
        </div>

        {isCollapsed ? null : (
          <>

        {item.notes ? (
          // BAND 3 — coach's note. Tap-to-expand, one-line clamp;
          // `line-clamp-1` is a Tailwind v4 core utility, not hand-rolled CSS
          // (see docs/LESSONS.md § "Hand-written CSS loses its unprefixed
          // property" for why a hand-rolled -webkit-line-clamp rule is the
          // wrong call here). The -my-2 that used to collapse this row's
          // height is gone: the note is its own band now, so the 44px target
          // is the band rather than something pulled back out of the flow.
          <button
            type="button"
            onClick={() => toggleNotesOpen(item.id)}
            aria-expanded={notesOpen.has(item.id)}
            className="flex min-h-11 w-full items-center border-t border-border-soft px-4 py-1 text-left"
          >
            {/* Sentence case, not `t-control`. A coach's note is prose — the
                uppercase control tier was rendering "Belt on from set 2…" as
                "BELT ON FROM SET 2…", which reads as a warning label rather
                than an instruction and costs width on the clamp. */}
            <span
              className={`whitespace-pre-wrap text-xs leading-snug text-muted ${
                notesOpen.has(item.id) ? '' : 'line-clamp-1'
              }`}
            >
              {item.notes}
            </span>
          </button>
        ) : null}
        {/* BAND 4 — the sets. Flush to the card edge with inner hairlines, so
            the ordinal gutter and the ✓ column line up down the whole card. */}
        <div className="flex flex-col border-t border-border-soft [&>*+*]:border-t [&>*+*]:border-border-soft">
          {item.sets.map((set, ki) => {
            const prev = ki > 0 ? item.sets[ki - 1] : null;
            const cliff =
              !!prev &&
              prev.actual.completed &&
              set.actual.completed &&
              prev.actual.weight != null &&
              set.actual.weight != null &&
              prev.actual.weight === set.actual.weight &&
              prev.actual.reps != null &&
              set.actual.reps != null &&
              prev.actual.reps - set.actual.reps > 2;
            return (
              // No `px-*`: SetRow supplies its own, so its left rule can sit on
              // the card border. The cliff note below keeps a matching inset.
              <div key={ki} className="flex flex-col gap-2">
                <SetRow
                  metric={item.primaryMetric}
                  markKind={markKindOf(item)}
                  set={set}
                  index={ki}
                  showPlanned={anyPlanned}
                  isPr={isPrSet(set.actual, bestByMovement.get(trackName(item.movement, set.notations)) ?? null)}
                  restOverride={
                    set.actual.rest != null && set.actual.rest !== item.restSeconds ? set.actual.rest : null
                  }
                  onOpen={() => {
                    activate(groupId);
                    setEntryFor({ si, gi, ii, ki });
                  }}
                  onToggle={() => {
                    activate(groupId);
                    setDoc((d) => patchSetActual(d, si, gi, ii, ki, { completed: !set.actual.completed }));
                  }}
                />
                {cliff ? (
                  <div className="pl-3.5 pr-2 t-control text-accent">
                    Rep drop {prev!.actual.reps! - set.actual.reps!} — extend rest or stop
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {/* BAND 5 — every control, one line: add set, superset and
            metric, with remove pushed hard right so the destructive control
            is not flush against the one tapped between every set. The
            group-level link/unlink/remove arrive via `footer`: a standalone
            movement gets link + remove, a superset member unlink + remove. */}
        <div className="flex items-center border-t border-border-soft px-2 text-muted">
          <button
            onClick={() => {
              activate(groupId);
              setDoc((d) => addSet(d, si, gi, ii));
            }}
            className={`${ICON_BTN} hover:text-fg`}
            aria-label="Add set"
            title="Add set"
          >
            <PlusGlyph className={GLYPH} />
          </button>
          {footer?.link}
          {/* The metric is written out, not drawn: its glyph was the only
              place the current metric showed, and the Distance arrow read as
              "swap". Tapping still cycles it; ↻ says so. */}
          <button
            onClick={() => {
              activate(groupId);
              setDoc((d) => setItemMetric(d, si, gi, ii, nextMetric(item.primaryMetric)));
            }}
            className="hill-btn flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 px-2 t-control text-fg transition-colors"
            aria-label={`Metric: ${METRICS[item.primaryMetric].label}. Change metric`}
            title={`Metric: ${METRICS[item.primaryMetric].label}`}
          >
            {METRICS[item.primaryMetric].label}
            <span aria-hidden className="text-faint">
              ↻
            </span>
          </button>
          <span className="flex-1" />
          {footer?.unlink}
          {footer?.remove}
        </div>
        </>
        )}
      </div>
    );
  }

  // Render a whole group (single movement or superset). A superset collapses as
  // one unit via its own header; single movements collapse through renderItem's
  // header. Called with real (si, gi) so it works identically in a section and
  // in the Done list.
  function renderGroup(si: number, gi: number) {
    const groups = doc.sections[si].groups;
    const group = groups[gi];
    if (group.items.length > 1) {
      const isCollapsed = collapsed.has(group.id);
      const groupDone = !!group.completedAt;
      return (
        // Left accent rule, not an all-round accent border — the mockup's
        // "superset with previous" cue on an otherwise ordinary bordered
        // card, matching the single-movement group's border-outline below.
        // Horizontal padding moved off the card and onto the bands inside it,
        // so a superset's member movements band exactly like a standalone one
        // instead of being inset a second time by this container.
        //
        // The stripe is its own straight element, not the card's border-l: on
        // a 12px-radius card a left border bends round both corners. It sits
        // over the card's (transparent) 2px left border so nothing inside
        // moves, and stops 12px short of each end, where the corner curve
        // starts. Not `overflow-hidden` on the card instead: SetRow's PR
        // ring-pop scales to 2.4x a 44px box and is meant to escape it.
        <div
          key={group.id}
          className={`lift relative rounded-card border border-outline border-l-2 bg-surface ${
            isCollapsed ? 'py-1' : ''
          }`}
        >
          <span aria-hidden className="pointer-events-none absolute inset-y-3 -left-0.5 w-0.5 bg-accent" />
          <div
            className={`flex items-center justify-between gap-2 px-4 t-control ${
              isCollapsed ? '' : 'border-b border-border-soft'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                activate(group.id);
                toggleCollapse(group.id);
              }}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-muted"
              aria-label={isCollapsed ? 'Expand superset' : 'Collapse superset'}
              aria-expanded={!isCollapsed}
            >
              <span className={`inline-block shrink-0 text-[0.7rem] transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>
                ▸
              </span>
              <span className="truncate">
                {group.items.length} movements{groupDone ? ' · done' : ''}
              </span>
            </button>
            {isCollapsed ? null : (
            // One of two → the shared segmented control. Its 36px shell fits
            // inside this 44px band and its buttons stay min-h-11, so neither
            // the band height nor the tap targets change. Default size, not
            // `sm`: `sm` would drop the label from t-control's 11px to 10px.
            <SegmentedTabs
              as="radiogroup"
              ariaLabel="Group kind"
              className="shrink-0"
              tabs={(['superset', 'circuit'] as GroupKind[]).map((k) => ({ key: k, label: k }))}
              active={group.kind}
              onChange={(k) => {
                activate(group.id);
                setDoc((d) => setGroupKind(d, si, gi, k as GroupKind));
              }}
            />
            )}
          </div>
          {isCollapsed
            ? null
            : group.items.map((_, ii) =>
                // Each member carries its own unlink and remove, with remove
                // in the same far-right slot as on a standalone card, so that
                // position always means "remove". Unlinking down to one
                // member dissolves the group, which is why the header no
                // longer needs an Ungroup of its own.
                renderItem(si, gi, ii, true, {
                  unlink: (
                    <button
                      onClick={() => {
                        activate(group.id);
                        setDoc((d) => detachItem(d, si, gi, ii));
                      }}
                      className={`${ICON_BTN} hover:text-fg`}
                      aria-label="Unlink this movement from the superset"
                      title="Unlink from superset"
                    >
                      <UnlinkGlyph className={GLYPH} />
                    </button>
                  ),
                  remove: (
                    <button
                      onClick={() => setDoc((d) => removeItem(d, si, gi, ii))}
                      className={`${ICON_BTN} text-danger`}
                      aria-label="Remove movement"
                      title="Remove movement"
                    >
                      <TrashGlyph className={GLYPH} />
                    </button>
                  ),
                }),
              )}
        </div>
      );
    }
    return (
      // Flat card, hairline outline, surface fill — the bands inside supply
      // their own padding so every row runs the full width of the card.
      <div
        key={group.id}
        className="lift rounded-card border border-outline bg-surface"
      >
        {renderItem(si, gi, 0, false, {
          link:
            gi < groups.length - 1 ? (
              <button
                onClick={() => setDoc((d) => mergeWithNext(d, si, gi, 'superset'))}
                className={`${ICON_BTN} hover:text-fg`}
                aria-label="Superset this movement with the next one"
                title="Superset with next"
              >
                <LinkGlyph className={GLYPH} />
              </button>
            ) : null,
          // --color-danger: the one colour legal on chrome, because severity
          // is the information. The accessible name still says "remove".
          remove: (
            <button
              onClick={() => setDoc((d) => removeGroup(d, si, gi))}
              className={`${ICON_BTN} text-danger`}
              aria-label="Remove movement"
              title="Remove movement"
            >
              <TrashGlyph className={GLYPH} />
            </button>
          ),
        })}
      </div>
    );
  }

  // A parked group as it reads in the Done pile: one row per movement, name and
  // logged sets on a single line, no card padding and no per-card border — the
  // compressed shape of the completed-session views rather than a shrunken
  // logging card. A superset keeps its accent rule and lists its movements
  // indented underneath, which the old collapsed card hid behind "2 movements".
  //
  // Tapping any row expands the group back into renderGroup's full editable
  // card, so nothing here is a removed feature — the ✓ toggle, metric, rest,
  // options and set rows all live one tap away, which is where they belong for
  // work that is already finished.
  function renderDoneGroup(si: number, gi: number) {
    const group = doc.sections[si].groups[gi];
    if (!collapsed.has(group.id)) {
      // Inset so the expanded card's own border does not sit flush against the
      // pile's outer hairline and read as one 2px line.
      return (
        <div key={group.id} className="p-2">
          {renderGroup(si, gi)}
        </div>
      );
    }
    const superset = group.items.length > 1;
    return (
      // Same straight stripe as the superset card (see renderGroup), kept off
      // the rows' own border so it cannot poke past the pile's rounded corner
      // when this group is the pile's first or last.
      <div key={group.id} className={superset ? 'relative border-l-2 border-l-transparent' : ''}>
        {superset ? (
          <span aria-hidden className="pointer-events-none absolute inset-y-3 -left-0.5 w-0.5 bg-accent" />
        ) : null}
        {superset ? (
          // 'single' is unreachable for a multi-item group, but printing it
          // raw would read as a bug rather than a label if it ever arrived.
          <div className="px-2 pt-1.5 t-label text-faint">
            {group.kind === 'circuit' ? 'circuit' : 'superset'}
          </div>
        ) : null}
        {group.items.map((item) => {
          const sub = isSubroutine(item);
          const tags = sub ? [] : doneNotations(item);
          // min-h-11 is the real 44px target and stays: these are stacked
          // rows, so a negative margin would only fake the number for
          // audit:mobile — the exclusive tap band of a row in a column is its
          // visible height. The compression comes from the padding, borders
          // and gaps that are gone, not from the row height.
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                activate(group.id);
                toggleCollapse(group.id);
              }}
              aria-label={`Expand ${item.movement}`}
              aria-expanded={false}
              className={`flex min-h-11 w-full items-center gap-2 px-2 text-left ${
                superset ? 'pl-5' : ''
              }`}
            >
              <span
                aria-hidden
                className={`flex h-4 w-4 shrink-0 items-center justify-center border text-[0.5rem] ${
                  sub ? 'border-border text-transparent' : 'border-accent bg-accent text-accent-fg'
                }`}
              >
                ✓
              </span>
              {/* The tags are a SIBLING of the name, not inside it: nested in
                  the truncating span they were the first thing an over-long
                  movement name cut off, which is exactly backwards — the name
                  survives truncation, a two-character tag cannot. */}
              <span className="flex min-w-0 flex-1 items-baseline gap-1">
                <span className="min-w-0 truncate text-sm capitalize text-fg">
                  {item.movement}
                </span>
                {addedIds.has(item.id) ? <span className="shrink-0 t-label text-muted">Added</span> : null}
                {tags.length > 0 ? (
                  <span className="shrink-0 translate-y-[0.15em] text-[0.6rem] leading-none tracking-wide text-faint">
                    {tags.map(notationLabel).join(' ')}
                  </span>
                ) : null}
              </span>
              {sub ? null : (
                // Capped at 40% so the NAME wins the row: a truncated summary
                // still shows the first (heaviest) set, a truncated name shows
                // nothing you can identify the movement by.
                <span className="max-w-[40%] shrink-0 truncate text-right text-xs tabular-nums text-muted">
                  {doneSetSummary(item)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  // Log the focus card's live set. The write is the one SetEntrySheet's Log
  // makes — `{ completed: true }` on that set, nothing else. What follows is
  // only where the card goes next: if that set finished the group, the group
  // parks into Done at once (the card is leaving it anyway, so parking now is
  // one change on screen rather than two) and focus follows the work again;
  // otherwise the member pin is dropped so a superset moves to its next set
  // in round order.
  function logFocusSet(si: number, gi: number, ii: number, ki: number) {
    const groupId = doc.sections[si].groups[gi].id;
    activate(groupId);
    const after = patchSetActual(doc, si, gi, ii, ki, { completed: true });
    setDoc((d) => patchSetActual(d, si, gi, ii, ki, { completed: true }));
    const g = after.sections[si].groups[gi];
    if (nextOpenSet(g)) {
      setFocus({ groupId });
      return;
    }
    if (g.completedAt) {
      const park = (prev: Set<string>) => (prev.has(groupId) ? prev : new Set([...prev, groupId]));
      setParked(park);
      setCollapsed(park);
    }
    setFocus(null);
  }

  // The focused group as a card: a single movement is FocusItem on a card
  // with the in-progress stripe; a superset/circuit keeps its own card, header
  // and ink stripe, and only the member holding the live set opens up — the
  // others are one tappable row each, so the group stays visibly together.
  // A subroutine-only group has nothing to log and keeps its ordinary card.
  function renderFocusGroup(si: number, gi: number, focusAt: number) {
    const group = doc.sections[si].groups[gi];
    if (focusAt < 0) return renderGroup(si, gi);
    const focusItem = (ii: number, grouped: boolean) => {
      const item = group.items[ii];
      const open = firstOpenSet(item);
      // The live set is the group's next set when it falls in this member;
      // a member pinned out of round order logs its own first open set.
      const next = nextOpenSet(group);
      const liveKi = next && next.ii === ii ? next.ki : open >= 0 ? open : null;
      return (
        <FocusItem
          key={item.id}
          item={item}
          liveKi={liveKi}
          markKind={markKindOf(item)}
          grouped={grouped}
          added={addedIds.has(item.id)}
          onPatchSet={(ki, patch) => {
            activate(group.id);
            setDoc((d) => patchSetActual(d, si, gi, ii, ki, patch));
          }}
          onLogSet={(ki) => logFocusSet(si, gi, ii, ki)}
          onOpenSet={(ki) => {
            activate(group.id);
            setEntryFor({ si, gi, ii, ki });
          }}
          onToggleSet={(ki) => {
            activate(group.id);
            const was = item.sets[ki].actual.completed;
            setDoc((d) => patchSetActual(d, si, gi, ii, ki, { completed: !was }));
          }}
          onAddSet={() => {
            activate(group.id);
            setDoc((d) => addSet(d, si, gi, ii));
          }}
          onCycleMetric={() => {
            activate(group.id);
            setDoc((d) => setItemMetric(d, si, gi, ii, nextMetric(item.primaryMetric)));
          }}
          onToggleAll={() => {
            activate(group.id);
            toggleItemComplete(si, gi, ii);
          }}
          onOptions={() => setOptionsFor({ si, gi, ii })}
          onDemo={() => setDemoFor(item.movement)}
        />
      );
    };
    if (group.items.length === 1) {
      return (
        <div key={group.id} className="lift relative rounded-card border border-outline border-l-2 bg-surface">
          {/* The in-progress marker: the same straight stripe as a superset's
              (see renderGroup for why it is not the card's border-l), in the
              in-progress accent rather than ink. */}
          <span aria-hidden className="pointer-events-none absolute inset-y-3 -left-0.5 w-0.5 bg-teal" />
          {focusItem(0, false)}
        </div>
      );
    }
    return (
      <div key={group.id} className="lift relative rounded-card border border-outline border-l-2 bg-surface">
        <span aria-hidden className="pointer-events-none absolute inset-y-3 -left-0.5 w-0.5 bg-accent" />
        <div className="flex items-center justify-between gap-2 border-b border-border-soft px-4 t-control">
          <span className="flex min-h-11 items-center text-muted">{group.items.length} movements</span>
          <SegmentedTabs
            as="radiogroup"
            ariaLabel="Group kind"
            className="shrink-0"
            tabs={(['superset', 'circuit'] as GroupKind[]).map((k) => ({ key: k, label: k }))}
            active={group.kind}
            onChange={(k) => {
              activate(group.id);
              setDoc((d) => setGroupKind(d, si, gi, k as GroupKind));
            }}
          />
        </div>
        {group.items.map((item, ii) => {
          if (ii === focusAt) {
            return (
              <div key={item.id} className={ii > 0 ? 'border-t border-border-soft' : ''}>
                {focusItem(ii, true)}
              </div>
            );
          }
          if (isSubroutine(item)) return renderItem(si, gi, ii, true);
          return movementRow(group.id, item, `px-4 ${ii > 0 ? 'border-t border-border-soft' : ''}`);
        })}
      </div>
    );
  }

  // One movement as a one-line, genuinely 44px row (stacked, so no negative
  // margins — LESSONS § "The slim-thumb trick does not transfer to a stacked
  // list"): ✓ when every set is logged, the name, then the next set's values
  // and done/total. Tapping it focuses that movement.
  function movementRow(groupId: string, item: LogItem, pad: string) {
    const sub = isSubroutine(item);
    const done = sub ? 0 : item.sets.filter((st) => st.actual.completed).length;
    const open = sub ? -1 : firstOpenSet(item);
    const allDone = !sub && item.sets.length > 0 && open < 0;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => {
          activate(groupId);
          setFocus({ groupId, itemId: sub ? undefined : item.id });
        }}
        className={`flex min-h-11 w-full items-center gap-2 text-left ${pad}`}
      >
        {allDone ? (
          <span
            aria-hidden
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-chip border border-accent bg-accent text-[0.5rem] text-accent-fg"
          >
            ✓
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-sm capitalize text-fg">{item.movement}</span>
        {addedIds.has(item.id) ? <span className="shrink-0 t-label text-muted">Added</span> : null}
        {sub ? (
          <span className="shrink-0 t-label text-faint">note</span>
        ) : (
          <span className="max-w-[45%] shrink-0 truncate text-right text-xs tabular-nums text-muted">
            {open >= 0 ? `${formatSetActual({ ...item.sets[open].actual, rpe: undefined })} · ` : ''}
            {done}/{item.sets.length}
          </span>
        )}
      </button>
    );
  }

  // A not-focused group as it reads under "Up next": the Done pile's row
  // shape, a superset keeping its stripe and kind label with its members
  // indented. Tapping a row focuses that movement; everything else (sets,
  // options, metric) is on the card it opens into.
  function renderUpNextGroup(si: number, gi: number) {
    const group = doc.sections[si].groups[gi];
    const superset = group.items.length > 1;
    return (
      <div key={group.id} className={superset ? 'relative border-l-2 border-l-transparent' : ''}>
        {superset ? (
          <>
            <span aria-hidden className="pointer-events-none absolute inset-y-3 -left-0.5 w-0.5 bg-accent" />
            <div className="px-3 pt-1.5 t-label text-faint">
              {group.kind === 'circuit' ? 'circuit' : 'superset'}
            </div>
          </>
        ) : null}
        {group.items.map((item) => movementRow(group.id, item, superset ? 'pl-6 pr-3' : 'px-3'))}
      </div>
    );
  }

  // Hand off from the options sheet to another sheet. Sheets now unmount the
  // moment they close, so closing this one and opening the next in the same
  // commit leaves no overlap — no two scrims stacked, and no delay to wait out.
  const handoff = (openNext: () => void) => {
    setOptionsFor(null);
    openNext();
  };

  // The subroutine sheet stays mounted (see below), so its seed values have to
  // survive `subEditor` going null while it slides out — hence a plain derived
  // value rather than a lookup inside a conditional render.
  const subEditItem =
    subEditor?.mode === 'edit'
      ? doc.sections[subEditor.si]?.groups[subEditor.gi]?.items[subEditor.ii]
      : undefined;

  return (
    <ErrorBoundary>
    <MotionConfig reducedMotion="user">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="flex flex-1 flex-col"
      >
      {/* Fills the scrollport rather than measuring one: `#main` is a flex
          column inside App.astro's non-scrolling shell, so `flex-1` here lands
          the Finish bar on the bottom edge on a short session without this
          having to know the header's height. (`min-h-svh` did know it, and was
          wrong by exactly that much.) The reading column moved in here; the
          outer div is full-bleed so the bar can span the screen. */}
      <div className="mx-auto w-full max-w-2xl flex-1 px-3 sm:px-4 pb-4 pt-2">
      {/* Recomposed header: row 1 is the clock/status + Home/Pause (or the
          "Editing" heading), row 2 is the Session details toggle plus the
          sets count and date — one <header>, replacing the previous two
          separate blocks (clock row, then a full-width details row) so the
          hairline between them sits once instead of twice.
          DELIBERATE DEVIATION from the mockup: the mockup's header is
          `sticky top-0`. Ours stays IN FLOW, not sticky. App.astro already
          sticks its own h-12 header at top-0 and auto-hides it on 24px of
          committed downward scroll, and a second sticky bar in the same
          scroller means either a hard-coded offset that detaches when the
          app header retracts, or stacked stickies that must know each
          other's heights. The clock is not what you need mid-set. (There is
          no rest countdown: it paused when the phone locked. Rest is logged
          as a tag — the "Rest between sets" presets in movement options.) */}
      <header className="mb-3">
        {/* Wraps: at 375px a session past the hour mark ("1:05:23" at
            text-4xl) plus Home and Pause does not fit on one line. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {editing ? (
            <div>
              <div className="font-display text-3xl uppercase tracking-tight text-fg">
                {review ? 'Review' : combine ? 'Combine' : 'Editing'}
              </div>
              <div className={`t-label ${unsaved ? 'text-accent' : 'text-muted'}`}>
                {LOG_STATUS_LABEL[status]}
                {saving ? ' · saving…' : ''}
                {unsaved && !saving ? ' · not saved' : ''}
              </div>
              {cycleLine}
            </div>
          ) : (
            <>
              <div>
                <div className="font-display text-4xl tabular-nums text-fg">{clock(stopwatch.seconds)}</div>
                {/* Run-state dot + word, from the design. The dot is teal only
                    while the clock is actually running, which is information
                    (a paused session still autosaves and still reads
                    `in_progress`, so the status string alone never showed it).
                    Colour is never the only carrier — the word next to it says
                    the same thing, per the monochrome-chrome rule. */}
                <div className={`flex items-center gap-1.5 t-label ${unsaved ? 'text-accent' : 'text-muted'}`}>
                  <span
                    aria-hidden
                    className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                      stopwatch.running ? 'bg-teal' : 'bg-faint'
                    }`}
                  />
                  {stopwatch.running ? 'In progress' : 'Paused'}
                  {/* The dot reads the CLOCK; `status` is the persisted row
                      state and the two are different axes. They agree on the
                      common path, so printing both would just be noise — but a
                      log resumed as `planned`, or one that has gone `done` or
                      `cancelled` under us, still has to say so. */}
                  {status !== 'in_progress' && status !== 'paused' ? ` · ${LOG_STATUS_LABEL[status]}` : ''}
                  {saving ? ' · saving…' : ''}
                  {unsaved && !saving ? ' · not saved' : ''}
                </div>
                {cycleLine}
              </div>
              {/* Home leaves the session RUNNING — it is not a third way to
                  end one, which is why it sits up here with the clock rather
                  than in the Finish bar, where both actions stop the
                  workout. min-h-11 stays; only the horizontal padding
                  tightens (px-3! wins over Button's own px-4 — Tailwind has
                  no class-merge here, so an unmarked override can silently
                  lose the cascade). */}
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="ghost" onClick={goHome} className="px-3!">
                  Home
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => (stopwatch.running ? stopwatch.pause() : stopwatch.resume())}
                  className="px-3!"
                >
                  {stopwatch.running ? 'Pause' : 'Resume'}
                </Button>
              </div>
            </>
          )}
        </div>

        {/* `flex-wrap`, and the two meta spans grouped so they wrap as a unit.
            Without it the row is three non-shrinking children that do not fit
            at 375px, and the date runs past the hairline — clipped by
            `[data-scroll-root]`'s `overflow-x-hidden`, which is why
            audit:mobile stays green on it (docs/LESSONS.md § "A fix silently
            switched off an existing guard"). Caught by screenshot, not by a
            check. */}
        {/* Session progress, merged into this row as its top edge rather than
            a row of its own: the 4px strip replaces the 1px hairline that sat
            here, so it costs 3px. One segment per movement, sized by its set
            count; logged sets fill in ink, the rest is the neutral track, and
            the focused movement's remaining sets take the in-progress accent.
            It is data, not a control, and it reads without colour — the
            "done/total sets" count on the row beneath says the same thing. */}
        {progress.length > 0 ? (
          <div
            role="progressbar"
            aria-label="Session progress"
            aria-valuemin={0}
            aria-valuemax={sessionSets.total}
            aria-valuenow={sessionSets.done}
            className="mt-2 flex h-1 gap-0.5"
          >
            {progress.map((p) => (
              <span
                key={p.id}
                className={`flex h-full overflow-hidden rounded-[1px] ${
                  p.id === focusItemId ? 'bg-teal' : 'bg-border'
                }`}
                style={{ flexGrow: p.total, flexBasis: 0 }}
              >
                <span className="h-full bg-fg" style={{ width: `${(p.done / p.total) * 100}%` }} />
              </span>
            ))}
          </div>
        ) : null}
        <div
          className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border ${
            progress.length > 0 ? '' : 'mt-2 border-t'
          }`}
        >
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            aria-expanded={showDetails}
            className="flex min-h-11 items-center gap-2 t-control text-muted transition-colors hover:text-fg"
          >
            <span
              aria-hidden
              className={`inline-block text-[0.7rem] transition-transform ${showDetails ? 'rotate-90' : ''}`}
            >
              ▸
            </span>
            Session details
            {cycle?.note && !showDetails ? (
              <span aria-label="has a note for this cycle" className="t-label text-fg">
                !
              </span>
            ) : null}
          </button>
          <span className="ml-auto flex items-center gap-3">
            <span className="t-label text-faint tabular-nums">
              {sessionSets.done}/{sessionSets.total} sets
            </span>
            {/* MM/DD, per the design. The full ISO date left this row touching
                the hairline at 390px with nothing to spare, and the year is
                the one part of today's date nobody is reading — the picker
                under Session details still shows it in full. */}
            <span className="t-label text-muted tabular-nums">
              {logDate.slice(5).replace('-', '/')}
              {tags.length ? ` · ${tags.length}` : ''}
            </span>
          </span>
        </div>

        {showDetails && cycle?.note ? (
          <p className="mt-1.5 rounded-card border border-outline bg-surface px-3 py-2 text-sm text-fg">
            <span className="t-label text-muted">Cycle {cycle.week} · </span>
            {cycle.note}
          </p>
        ) : null}

        {showDetails ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={logDate}
              onChange={(e) => changeDate(e.target.value)}
              // FIELD is `w-full`; max-w-max keeps this one at its own width so the
              // tag toggles still wrap beside it.
              className={`${FIELD} max-w-max tabular-nums`}
              aria-label="Session date"
            />
            {Object.entries(ACTIVITY_TAGS).map(([key, v]) => {
              const on = tags.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleTag(key)}
                  // Fills from `.hill-btn[aria-pressed]` (accent / tappable);
                  // the activity colour stays as the on chip's outline.
                  className={`hill-btn flex min-h-11 items-center border px-3 t-control transition-colors ${
                    on ? '' : 'text-muted hover:text-fg'
                  }`}
                  style={on ? { borderColor: v.color } : undefined}
                  aria-pressed={on}
                >
                  {v.label}
                </button>
              );
            })}
            {editing ? (
              <button
                type="button"
                onClick={() => setShowVibe(true)}
                className="hill-btn flex min-h-11 items-center border border-transparent bg-tappable px-3 t-control text-fg transition-colors hover:bg-tappable-hover"
              >
                Readiness
              </button>
            ) : null}
          </div>
        ) : null}

        {showDetails && linkedSession?.source_text ? (
          <details className="mt-1.5 rounded-card border border-outline bg-surface">
            <summary className="cursor-pointer px-3 py-2 t-control text-muted hover:text-fg">
              Source{linkedSession.source ? ` · ${linkedSession.source}` : ''}
            </summary>
            <pre className="whitespace-pre-wrap px-3 py-2 text-xs text-muted">
              {linkedSession.source_text}
            </pre>
          </details>
        ) : null}
      </header>

      {review || combine || link ? (
        <section aria-label={review ? 'Review' : 'Shared workout'} className="mb-3 rounded-card border border-outline bg-surface p-3">
          {review ? (
            <p className="text-sm text-fg">
              From {review.sender}. These are {review.sender}&rsquo;s numbers until you confirm.
            </p>
          ) : null}
          {combine ? (
            <p className="text-sm text-fg">
              Adding {combine.sender}&rsquo;s movements to your log. New ones are marked Added; nothing is saved
              until you tap Save combined.
            </p>
          ) : null}
          {review && dup ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-2">
              <span className="min-w-0 text-xs text-muted">
                {replaceMine
                  ? `Confirming deletes your log from ${formatDate(dup.log.log_date)}.`
                  : `Same day as your log · ${duplicateChoice(dup).percent}% overlap`}
              </span>
              <button
                type="button"
                onClick={() => setDupOpen(true)}
                className="inline-flex min-h-11 items-center t-control text-fg underline underline-offset-2"
              >
                {replaceMine ? 'Change' : 'Resolve'}
              </button>
            </div>
          ) : null}
          {link ? (
            <label className={`block ${review || combine ? 'mt-3' : ''}`}>
              <span className="t-label text-muted">Counts toward</span>
              <select
                value={link.choice}
                onChange={(e) => setLink({ ...link, choice: e.target.value, dirty: true })}
                className={`${FIELD} mt-1`}
              >
                <option value="">None</option>
                {link.choice === KEEP_LINK ? <option value={KEEP_LINK}>Keep its current plan</option> : null}
                {link.plan.parsed.days.map((d) => (
                  <option key={d.dayKey} value={d.dayKey} disabled={!canLinkOnDate(link.plan, link.others, logDate)}>
                    {d.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-muted">
                {canLinkOnDate(link.plan, link.others, logDate)
                  ? `A day of ${link.plan.name}, for plan adherence. None keeps it in your history only.`
                  : `Dated before your first log on ${link.plan.name}, so it can't count toward it without renumbering your weeks.`}
              </span>
            </label>
          ) : null}
        </section>
      ) : null}

      {showVibe ? (
        <VibeCheckCard
          onSave={saveVibe}
          onSkip={() => setShowVibe(false)}
          initial={editing ? doc.session?.vibe : undefined}
          saveLabel={editing ? 'Save' : undefined}
          skipLabel={editing ? 'Cancel' : undefined}
        />
      ) : null}


      {liveSections.map((section) => {
        const si = doc.sections.findIndex((s) => s.key === section.key);
        const groups = doc.sections[si].groups;
        return (
          <section key={section.key} className="mb-3">
            {/* The one "+" goes in SectionHeader's `action` slot rather than a
                second flex row around it — SectionHeader is itself a
                `flex justify-between` with its own mb-3. */}
            <SectionHeader
              // `mb-1.5!` — SectionHeader hardcodes `mb-3` and Tailwind does no
              // class-merging here, so an unmarked override loses the cascade
              // (same trap as Button's `px-3!` above). Overridden per-caller
              // rather than changed in the primitive, which every other view
              // shares.
              className="mb-1.5!"
              action={
                <AddMenu
                  sections={[section.key]}
                  labelFor={sectionLabel}
                  onPick={addTo}
                  label={`Add to ${sectionLabel(section.key)}`}
                />
              }
            >
              {sectionLabel(section.key)}{' '}
              <span className="text-faint tabular-nums">{groups.length}</span>
            </SectionHeader>
            {/* The focused movement as its card, then every other unparked
                group in this section as one-line rows in a single card —
                "Up next" in the focused section, unlabelled elsewhere since
                the section header already says what they are. */}
            <div className="flex flex-col gap-2">
              {focused && focused.si === si ? (
                <FocusAnchor groupId={focused.g.id} last={lastFocusGroup}>{renderFocusGroup(si, focused.gi, focusIi)}</FocusAnchor>
              ) : null}
              {(() => {
                const rest = groups
                  .map((g, gi) => ({ g, gi }))
                  .filter(({ g, gi }) => !parked.has(g.id) && !(focused && focused.si === si && focused.gi === gi));
                if (rest.length === 0) return null;
                return (
                  <div className="rounded-card border border-outline bg-surface">
                    {focused && focused.si === si ? (
                      <div className="px-3 pt-2 t-label text-muted">Up next</div>
                    ) : null}
                    <div className="flex flex-col [&>*+*]:border-t [&>*+*]:border-border-soft">
                      {rest.map(({ gi }) => renderUpNextGroup(si, gi))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </section>
        );
      })}

      {/* Sections with nothing left to show — empty, or everything in them
          already in Done — fold into ONE row: pick the section from the
          dropdown, then "+" asks movement or subroutine. A full header each
          said nothing, and their names on one line cut off. */}
      {emptySections.length > 0 ? (
        <section className="mb-3 flex items-center gap-2">
          <select
            value={foldSection}
            onChange={(e) => setFoldPick(e.target.value as SectionKey)}
            aria-label="Section to add to"
            className={`${FIELD} min-w-0 flex-1`}
          >
            {emptySections.map((sec) => (
              <option key={sec.key} value={sec.key}>
                {sectionLabel(sec.key)}
              </option>
            ))}
          </select>
          <AddMenu
            sections={[foldSection]}
            labelFor={sectionLabel}
            onPick={addTo}
            label={`Add to ${sectionLabel(foldSection)}`}
          />
        </section>
      ) : null}

      {doneGroups.length > 0 ? (
        <section className="mb-3 border-t border-border pt-2">
          {/* The whole Done pile folds as one unit, so what's left to do can be
              the only thing on screen. Each group inside stays individually
              expandable and fully editable. */}
          <button
            type="button"
            onClick={() => setDoneOpen((v) => !v)}
            aria-expanded={doneOpen}
            className="flex min-h-11 w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className={`inline-block shrink-0 text-[0.7rem] text-muted transition-transform ${
                  doneOpen ? 'rotate-90' : ''
                }`}
              >
                ▸
              </span>
              <span className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-fg">
                Done
              </span>
            </span>
            <span className="t-control text-muted">
              {doneMovements} {doneMovements === 1 ? 'movement' : 'movements'}
            </span>
          </button>
          {doneOpen ? (
            // One bordered pile with inner hairlines between groups, instead of
            // a stack of individually bordered cards separated by an 8px gap:
            // the card chrome was costing more height per finished movement
            // than the movement itself.
            <div className="mt-1 flex flex-col rounded-card border border-outline bg-surface [&>*+*]:border-t [&>*+*]:border-border-soft">
              {doneGroups.map(({ si, gi }) => renderDoneGroup(si, gi))}
            </div>
          ) : null}
        </section>
      ) : null}

      {picker ? (
        <MovementPicker
            movements={movements}
            title={picker.mode === 'add' ? 'Add movement' : 'Swap movement'}
            suggestions={
              picker.mode === 'swap'
                ? swapSuggestions(doc.sections[picker.si]?.groups[picker.gi]?.items[picker.ii]?.movement ?? '')
                : []
            }
            onPick={handlePick}
            onDismiss={(id) => {
              dismissMovementSub(id).then(() => {
                if (planId) getMovementSubs(planId).then(setSubs);
              });
            }}
          onClose={() => setPicker(null)}
        />
      ) : null}

      <SetEntrySheet
        open={entrySet !== null}
        metric={entryItem?.primaryMetric ?? DEFAULT_PRIMARY_METRIC}
        markKind={entryItem && !isSubroutine(entryItem) ? markKindOf(entryItem) : null}
        movement={entryItem?.movement ?? ''}
        setIndex={entryFor?.ki ?? 0}
        setCount={entryItem?.sets.length ?? 0}
        set={entrySet}
        onPatch={(patch) => {
          if (!entryFor) return;
          const { si, gi, ii, ki } = entryFor;
          setDoc((d) => patchSetActual(d, si, gi, ii, ki, patch));
        }}
        onLog={() => {
          if (!entryFor || !entryItem) return;
          const { si, gi, ii, ki } = entryFor;
          setDoc((d) => patchSetActual(d, si, gi, ii, ki, { completed: true }));
          setEntryFor(null);
        }}
        onCloneForward={() => {
          if (!entryFor) return;
          const { si, gi, ii, ki } = entryFor;
          cloneForward(si, gi, ii, ki);
          setEntryFor(null);
        }}
        onRemove={() => {
          if (!entryFor) return;
          const { si, gi, ii, ki } = entryFor;
          setDoc((d) => removeSet(d, si, gi, ii, ki));
          setEntryFor(null);
        }}
        onClose={() => setEntryFor(null)}
      />

      <MovementDemoSheet
        name={demoFor}
        open={demoFor !== null}
        onClose={() => setDemoFor(null)}
      />

      <Modal open={optionsFor !== null} onClose={() => setOptionsFor(null)} title="Movement">
        {optionsFor
          ? (() => {
              const { si, gi, ii } = optionsFor;
              const item = doc.sections[si]?.groups[gi]?.items[ii];
              if (!item) return null;
              const sub = isSubroutine(item);
              const groups = doc.sections[si].groups;
              const inGroup = groups[gi].items.length > 1;
              const groupWord = groups[gi].kind === 'circuit' ? 'circuit' : 'superset';
              const restRows = inGroup ? item.sets : item.sets.slice(0, -1);
              const currentKey = doc.sections[si].key;
              const supersetTargets = doc.sections.flatMap((s, tsi) =>
                s.groups
                  .map((g, tgi) => ({ group: g, targetSi: tsi, targetGi: tgi, sectionKey: s.key }))
                  .filter(({ targetSi, targetGi }) => !(targetSi === si && targetGi === gi)),
              );
              const close = () => setOptionsFor(null);
              const rowClass =
                'hill-btn inline-flex min-h-11 items-center justify-center border border-transparent bg-tappable px-4 text-sm uppercase tracking-wider text-fg transition-colors hover:bg-tappable-hover disabled:opacity-40';
              return (
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <div className="mb-4 text-sm capitalize text-fg">{item.movement}</div>
                  <div className="flex flex-col gap-2">
                    {/* Swap takes the width, remove is a square beside it —
                        the Finish/Discard pairing from the bottom bar. Red is
                        --color-danger, the one place colour is legal on chrome
                        because severity is the information; the accessible
                        name still says "remove", so it survives without hue. */}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handoff(() => {
                            if (sub) setSubEditor({ mode: 'edit', si, gi, ii });
                            else setPicker({ mode: 'swap', si, gi, ii });
                          })
                        }
                        className={`flex-1 ${rowClass}`}
                      >
                        {sub ? 'Edit subroutine' : 'Swap movement'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDoc((d) => removeItem(d, si, gi, ii));
                          close();
                        }}
                        className="hill-btn flex h-11 w-11 shrink-0 items-center justify-center border border-transparent bg-tappable text-danger transition-colors hover:border-danger"
                        aria-label={sub ? 'Remove subroutine' : 'Remove movement'}
                        title={sub ? 'Remove subroutine' : 'Remove movement'}
                      >
                        <TrashGlyph className={GLYPH} />
                      </button>
                    </div>
                    {inGroup ? <div className="mt-2 t-label text-muted">Whole {groupWord}</div> : null}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={gi === 0}
                        onClick={() => {
                          setDoc((d) => moveGroup(d, si, gi, -1));
                          // Follow the group to its new index and stay open —
                          // closing after every step made moving three places
                          // cost nine taps.
                          setOptionsFor({ si, gi: gi - 1, ii });
                        }}
                        className={`flex-1 ${rowClass}`}
                      >
                        ↑ Up
                      </button>
                      <button
                        type="button"
                        disabled={gi >= groups.length - 1}
                        onClick={() => {
                          setDoc((d) => moveGroup(d, si, gi, 1));
                          setOptionsFor({ si, gi: gi + 1, ii });
                        }}
                        className={`flex-1 ${rowClass}`}
                      >
                        ↓ Down
                      </button>
                    </div>
                    {/* Inside a superset: the order of its movements is the
                        order the sets alternate in, which decides whose rest
                        falls between which sets — so it is editable here, and
                        the movement can be taken back out. The row above still
                        moves the whole group. */}
                    {inGroup ? (
                      <>
                        <div className="mt-2 t-label text-muted">In this {groupWord}</div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={ii === 0}
                            onClick={() => {
                              setDoc((d) => moveItemInGroup(d, si, gi, ii, -1));
                              setOptionsFor({ si, gi, ii: ii - 1 });
                            }}
                            className={`flex-1 ${rowClass}`}
                          >
                            ↑ Earlier
                          </button>
                          <button
                            type="button"
                            disabled={ii >= groups[gi].items.length - 1}
                            onClick={() => {
                              setDoc((d) => moveItemInGroup(d, si, gi, ii, 1));
                              setOptionsFor({ si, gi, ii: ii + 1 });
                            }}
                            className={`flex-1 ${rowClass}`}
                          >
                            ↓ Later
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setDoc((d) => detachItem(d, si, gi, ii));
                            setOptionsFor({ si, gi: gi + 1, ii: 0 });
                          }}
                          className={rowClass}
                        >
                          Remove from {groupWord}
                        </button>
                      </>
                    ) : null}
                  </div>

                  {/* Two one-shot pickers. Native <select>: it costs no JS
                      state, gets the OS wheel on a phone, and collapses two
                      wrapping chip grids (five sections and up to N movements,
                      ~180px of the sheet) into two 44px rows. Both are ACTIONS,
                      not stored settings, so each stays on its placeholder and
                      fires on change — hence `value=""` rather than a bound
                      value. */}
                  <div className="mt-4 flex flex-col gap-2">
                    <label className="flex items-center gap-3">
                      <span className="w-32 shrink-0 t-label text-muted">Move to section</span>
                      <select
                        value=""
                        onChange={(e) => {
                          const k = e.target.value as SectionKey;
                          if (!k) return;
                          setDoc((d) => moveGroupToSection(d, si, gi, k));
                          close();
                        }}
                        className={`${FIELD} min-w-0 flex-1`}
                      >
                        <option value="">Choose…</option>
                        {SECTIONS.filter((k) => k !== currentKey).map((k) => (
                          <option key={k} value={k}>
                            {sectionLabel(k)}
                          </option>
                        ))}
                      </select>
                    </label>

                    {!sub && supersetTargets.length > 0 ? (
                      <label className="flex items-center gap-3">
                        <span className="w-32 shrink-0 t-label text-muted">Superset with</span>
                        <select
                          value=""
                          onChange={(e) => {
                            const target = supersetTargets.find((t) => t.group.id === e.target.value);
                            if (!target) return;
                            setDoc((d) =>
                              groupWithAcrossSections(d, si, gi, target.targetSi, target.targetGi, 'superset'),
                            );
                            close();
                          }}
                          className={`${FIELD} min-w-0 flex-1 capitalize`}
                        >
                          <option value="">Choose…</option>
                          {supersetTargets.map(({ group: g, sectionKey }) => (
                            <option key={g.id} value={g.id}>
                              {g.items.map((it) => it.movement).join(' + ')}
                              {sectionKey !== currentKey ? ` · ${sectionLabel(sectionKey)}` : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>

                  {!sub ? (
                  <>
                  <div className="mt-5">
                    <div className="mb-2 t-label text-muted">
                      Notes
                    </div>
                    <textarea
                      key={item.id}
                      defaultValue={item.notes ?? ''}
                      onChange={(e) => setDoc((d) => setItemNotes(d, si, gi, ii, e.target.value))}
                      rows={2}
                      placeholder="Optional — cue, setup, how it felt"
                      className={`${FIELD} resize-none py-1.5`}
                    />
                  </div>

                  <div className="mt-5">
                    <div className="mb-2 t-label text-muted">
                      Notations
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(NOTATIONS).map(([sym, desc]) => {
                        const on =
                          item.sets.length > 0 && item.sets.every((s) => s.notations.includes(sym));
                        return (
                          <button
                            key={sym}
                            type="button"
                            title={desc}
                            onClick={() => setDoc((d) => toggleItemNotation(d, si, gi, ii, sym))}
                            aria-pressed={on}
                            className={`hill-btn border px-2 py-1 text-xs transition-colors ${
                              on ? '' : 'text-muted hover:text-fg'
                            }`}
                          >
                            {sym}
                          </button>
                        );
                      })}
                    </div>
                    {/* What the variation changes. Shown only while [v] is on,
                        because a kind is a note ON a variation; turning [v] off
                        clears them (toggleItemNotation). Multi-select, so
                        toggle buttons, not SegmentedTabs. Annotation only —
                        nothing that measures reads a kind. */}
                    {item.sets.length > 0 && item.sets.every((s) => s.notations.includes('(v)')) ? (
                      <div className="mt-3">
                        <div className="mb-2 t-label text-muted">
                          Variation — different muscles? Rename the movement instead
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(VARIATION_KINDS).map(([sym, { label, desc }]) => {
                            const on = item.sets.every((s) => s.notations.includes(sym));
                            return (
                              <button
                                key={sym}
                                type="button"
                                title={desc}
                                onClick={() => setDoc((d) => toggleItemNotation(d, si, gi, ii, sym))}
                                aria-pressed={on}
                                className={`hill-btn border px-2 py-1 text-xs transition-colors ${
                                  on ? '' : 'text-muted hover:text-fg'
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-5">
                    <div className="mb-2 t-label text-muted">
                      Rest after each set
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {TIMERS.restPresets.map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => setDoc((d) => setItemRest(d, si, gi, ii, sec))}
                          aria-pressed={item.restSeconds === sec}
                          className={`hill-btn border px-2 py-1 text-xs tabular-nums transition-colors ${
                            item.restSeconds === sec ? '' : 'text-muted hover:text-fg'
                          }`}
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
                    {/* Vary by set. Rest often climbs through a movement (60s
                        after the early sets, 180s before the last), so a set can
                        carry its own rest AFTER it. Collapsed by default to keep
                        the sheet short; native selects keep each row one line on
                        a phone. A lone movement's last set has nothing after it,
                        so it gets no row; in a superset it can still precede a
                        partner's set (5 pull-ups against 6 dips), so every set
                        keeps one. */}
                    {restRows.length > 0 ? (
                      (() => {
                        const varied = item.sets.some((st) => st.actual.rest != null);
                        const open = varyRest || varied;
                        return (
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => setVaryRest((v) => !v)}
                              aria-expanded={open}
                              disabled={varied}
                              className="flex min-h-11 items-center gap-1 t-control text-muted transition-colors hover:text-fg disabled:hover:text-muted"
                            >
                              <span aria-hidden>{open ? '▾' : '▸'}</span>
                              Vary by set{varied ? ' · on' : ''}
                            </button>
                            {open ? (
                              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                                {restRows.map((st, ki) => {
                                  const base = item.restSeconds;
                                  return (
                                    <label key={ki} className="flex min-w-0 items-center gap-2 t-control text-muted">
                                      <span className="shrink-0 tabular-nums">After {ki + 1}</span>
                                      <select
                                        value={st.actual.rest ?? ''}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          setDoc((d) => setSetRest(d, si, gi, ii, ki, v === '' ? null : Number(v)));
                                        }}
                                        aria-label={`Rest after set ${ki + 1}`}
                                        // Not FIELD: two of these share a 375px row with their labels, and
                                        // FIELD's text-base / px-3 would clip "Same (120s)". FIELD's fill
                                        // and focus ink at the old size.
                                        className="min-h-11 min-w-0 flex-1 rounded-control border border-transparent bg-tappable px-2 text-xs tabular-nums text-fg outline-none focus:border-fg"
                                      >
                                        <option value="">{base != null ? `Same (${base}s)` : 'Same'}</option>
                                        {TIMERS.restPresets.map((sec) => (
                                          <option key={sec} value={sec}>
                                            {sec}s
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      })()
                    ) : null}
                  </div>

                  {/* Jump mark. Defaults from the name (lib/jumpMark.ts) and can be
                      switched for any movement, so the pattern list is a default,
                      not a gate. Box presets write every set at once — a box does
                      not change height between sets; distances are per jump, in
                      the set sheet. */}
                  <div className="mt-5">
                    <div className="mb-2 t-label text-muted">Jump mark</div>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          ['off', 'Off'],
                          ['height', 'Box height'],
                          ['distance', 'Distance'],
                        ] as const
                      ).map(([key, label]) => {
                        const on = (markKindOf(item) ?? 'off') === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setDoc((d) => setItemMarkKind(d, si, gi, ii, key))}
                            aria-pressed={on}
                            className={`hill-btn border px-2 py-1 text-xs transition-colors ${
                              on ? '' : 'text-muted hover:text-fg'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    {markKindOf(item) === 'height' ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {JUMP_MARK.boxPresetsIn.map((inches) => {
                          const cm = inToCm(inches);
                          const on = item.sets.length > 0 && item.sets.every((st) => st.actual.mark === cm);
                          return (
                            <button
                              key={inches}
                              type="button"
                              onClick={() => setDoc((d) => setItemMark(d, si, gi, ii, cm))}
                              aria-pressed={on}
                              aria-label={`Box ${inches} inches, ${cm} centimetres, all sets`}
                              className={`hill-btn border px-2 py-1 text-xs tabular-nums transition-colors ${
                                on ? '' : 'text-muted hover:text-fg'
                              }`}
                            >
                              {inches}in
                            </button>
                          );
                        })}
                      </div>
                    ) : markKindOf(item) === 'distance' ? (
                      <div className="mt-2 t-control text-muted">Log each jump's distance in the set.</div>
                    ) : null}
                  </div>
                  </>
                  ) : null}
                </div>
              );
            })()
          : null}
      </Modal>

      {/* Mounted permanently and toggled with `open`. Unmounting it instead
          destroyed the AnimatePresence inside Modal along with the child it was
          supposed to animate out, so the sheet vanished in a single frame. */}
      <SubroutineEditor
        open={subEditor !== null}
        initial={{
          title: subEditItem?.movement ?? '',
          description: subEditItem?.description ?? '',
          url: subEditItem?.url ?? '',
        }}
        onSave={({ title, description, url }) => {
          if (!subEditor) return;
          if (subEditor.mode === 'add') {
            setDoc((d) => addSubroutine(d, subEditor.sectionKey, title, description, url));
          } else {
            const { si, gi, ii } = subEditor;
            setDoc((d) => setSubroutine(d, si, gi, ii, { title, description, url }));
          }
          setSubEditor(null);
        }}
        onClose={() => setSubEditor(null)}
      />
      </div>

      {/* Sticky against `[data-scroll-root]`, NOT the document. Both `fixed`
          and `sticky` resolve `bottom: 0` against iOS Safari's layout
          viewport, which lags while the address bar retracts — that is what
          stranded this bar mid-screen. App.astro's shell moved the scrolling
          into an inner box, so the scrollport this sticks to is a real element
          whose bottom edge cannot lag. Last in-flow child of the column, so it
          pins until the page ends — which is also why the column dropped its
          `pb-32` bar reserve. */}
      <div className="pb-safe sticky bottom-0 border-t border-border bg-bg px-3 pt-3 pointer-fine:bg-bg/95 pointer-fine:backdrop-blur sm:px-4">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          {review ? (
            <>
              <Button onClick={() => (replaceMine && dup ? setAskReplace(true) : confirmReview(false))} disabled={leaving} className="flex-1">
                {leaving ? 'Saving…' : 'Confirm'}
              </Button>
              <Button variant="ghost" onClick={() => setAskDiscardReview(true)} disabled={leaving}>
                Discard
              </Button>
            </>
          ) : combine ? (
            <>
              <Button onClick={saveCombined} disabled={leaving} className="flex-1">
                {leaving ? 'Saving…' : 'Save combined'}
              </Button>
              <Button
                variant="ghost"
                disabled={leaving}
                onClick={() => {
                  window.location.href = reviewHref(combine.reviewId, queue);
                }}
              >
                Cancel
              </Button>
            </>
          ) : editing ? (
            <Button onClick={finishEdit} className="w-full">
              Done
            </Button>
          ) : (
            <>
              {/* Finish takes the width; discard is a 44px square beside it.
                  The size difference IS the safeguard — the two are one gap
                  apart, so what keeps a shaking hand off the wrong one is that
                  Finish is ~6x the area and accent-filled while discard is a grey
                  square. It also opens a confirm sheet rather than discarding,
                  which the per-movement trash does not. Both are `min-h-11`
                  with a border so their boxes align to the pixel (see the
                  Button primitive's note on why primary carries a border). */}
              <Button
                onClick={() => setAskDetails(true)}
                className="flex-1"
              >
                Finish
                <span className="ml-2 text-accent-fg/45 tabular-nums">
                  {sessionSets.done}/{sessionSets.total}
                </span>
              </Button>
              <button
                type="button"
                onClick={() => setConfirmDiscard(true)}
                className="hill-btn flex h-11 w-11 shrink-0 items-center justify-center border border-transparent bg-tappable text-muted transition-colors hover:text-fg"
                aria-label="Discard session"
                title="Discard session"
              >
                <TrashGlyph className={GLYPH} />
              </button>
            </>
          )}
        </div>
      </div>

      <FinishDetailsSheet
        open={askDetails}
        seconds={stopwatch.seconds}
        tags={tags}
        hr={rowHr}
        lastHr={lastHr}
        onClose={() => setAskDetails(false)}
        onSave={finish}
      />

      {/* §5.5: opened over the editor when this review row has a same-day log
          of mine. Closing it decides nothing — Resolve in the banner reopens it. */}
      <Modal open={dupOpen && dup !== null} onClose={() => setDupOpen(false)} title="Same day as your log">
        {dup ? (
          <div className="flex flex-col gap-4 p-4">
            <p className="text-sm text-fg">
              You already logged this day — {duplicateChoice(dup).percent}% of movements overlap.
            </p>
            <div className="flex flex-col gap-3">
              <div>
                <Button
                  onClick={() => {
                    window.location.href = reviewHref(dup.log.id, queue, { combine: logId ?? '' });
                  }}
                  className="w-full"
                >
                  Combine
                </Button>
                <p className="mt-1 text-xs text-muted">Add the movements yours lacks to your log, then remove this copy.</p>
              </div>
              <div>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDupOpen(false);
                    discardReview();
                  }}
                  className="w-full"
                >
                  Keep mine
                </Button>
                <p className="mt-1 text-xs text-muted">Remove {review?.sender ?? 'the friend'}&rsquo;s copy.</p>
              </div>
              <div>
                <Button
                  variant="ghost"
                  disabled={!duplicateChoice(dup).canUseShared}
                  onClick={() => {
                    setReplaceMine(true);
                    setDupOpen(false);
                  }}
                  className="w-full"
                >
                  Use shared
                </Button>
                <p className="mt-1 text-xs text-muted">
                  {duplicateChoice(dup).canUseShared
                    ? 'Review theirs; confirming deletes yours.'
                    : 'Not for a log recorded by Garmin — yours holds the device data.'}
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={askReplace} onClose={() => setAskReplace(false)} title="Replace your log">
        <div className="flex flex-col gap-4 p-4">
          <p className="text-sm text-muted">
            Confirming deletes your log from {dup ? formatDate(dup.log.log_date) : 'that day'} and keeps this one. It
            can&rsquo;t be undone.
          </p>
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => {
                setAskReplace(false);
                confirmReview(true);
              }}
              className="w-full"
            >
              Delete mine and confirm
            </Button>
            <Button variant="ghost" onClick={() => setAskReplace(false)} className="w-full">
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={askDiscardReview} onClose={() => setAskDiscardReview(false)} title="Discard this workout">
        <div className="flex flex-col gap-4 p-4">
          <p className="text-sm text-muted">
            This removes {review?.sender ?? 'the friend'}&rsquo;s workout from your logs. Your own logs are not
            touched.
          </p>
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => {
                setAskDiscardReview(false);
                discardReview();
              }}
              className="w-full"
            >
              Discard
            </Button>
            <Button variant="ghost" onClick={() => setAskDiscardReview(false)} className="w-full">
              Keep reviewing
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={confirmDiscard} onClose={() => setConfirmDiscard(false)} title="Discard session">
        <div className="flex flex-col gap-4 p-4">
          <p className="text-sm text-muted">
            This deletes everything logged in this session. It can't be undone.
          </p>
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => {
                setConfirmDiscard(false);
                discard();
              }}
              className="w-full"
            >
              Discard
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDiscard(false)} className="w-full">
              Keep logging
            </Button>
          </div>
        </div>
      </Modal>
    </motion.div>
    </MotionConfig>
    </ErrorBoundary>
  );
}
