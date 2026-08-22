import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { supabase } from '@/lib/supabase';
import {
  bumpMovementSub,
  createLog,
  deleteLog,
  dismissMovementSub,
  getActivePlan,
  getAllLogs,
  getLogById,
  getMovementSubs,
  getMovements,
  getPlanById,
  getRecentLogs,
  getSessionById,
  updateLog,
} from '@/lib/queries';
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
  addSubroutine,
  groupWithAcrossSections,
  mergeWithNext,
  moveGroup,
  moveGroupToSection,
  patchSetActual,
  removeGroup,
  removeItem,
  removeSet,
  setGroupKind,
  setItemMetric,
  setItemNotes,
  setItemRest,
  setSubroutine,
  swapItemMovement,
  toggleItemNotation,
  ungroup,
} from '@/lib/logEdits';
import { isSubroutine } from '@/lib/subroutine';
import { formatSetActual } from '@/lib/format';
import { activeSessionOf } from '@/lib/activeSession';
import { typeFromLabel } from '@/lib/timeline';
import { SubroutineBody } from '@/components/SubroutineBody';
import { DemoIconButton, MovementDemoSheet } from '@/components/MovementDemo';
import { lastPerformance, plannedReps } from '@/lib/lastPerformance';
import { bestE1rmByMovement, isPrSet } from '@/lib/prs';
import { useCountdown, useStopwatch } from '@/lib/useTimer';
import { parseVoiceSet, useVoiceInput } from '@/lib/voice';
import { weekFromDate } from '@/lib/week';
import { nextWeekForDay, planWeekCount } from '@/lib/progression';
import { ACTIVITY_TAGS, NOTATIONS, SECTIONS, TIMERS, type MetricKey, type SectionKey } from '@/app.config';
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
import { Button, LoadingScreen, SectionHeader } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/Modal';
import { EASE } from '@/components/anim';
import { SetRow } from '@/components/logger/SetRow';
import { SetEntrySheet } from '@/components/logger/SetEntrySheet';
import { MovementPicker } from '@/components/logger/MovementPicker';
import { SubroutineEditor } from '@/components/logger/SubroutineEditor';
import { VibeCheckCard } from '@/components/logger/VibeCheckCard';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  CalGlyph,
  DistanceGlyph,
  LinkGlyph,
  MoreGlyph,
  PlusGlyph,
  RepsGlyph,
  RpeGlyph,
  TimeGlyph,
  TrashGlyph,
  VoiceGlyph,
  WeightGlyph,
} from '@/components/ui/icons';
import { toast } from '@/lib/toast';

const METRIC_CYCLE: MetricKey[] = ['weight', 'reps', 'time', 'distance', 'cal', 'rpe'];

// One glyph per MetricKey. Exhaustive by construction — a new metric in
// app.config.ts fails the build here rather than rendering a blank button.
const METRIC_GLYPH: Record<MetricKey, (p: { className?: string }) => ReactNode> = {
  weight: WeightGlyph,
  reps: RepsGlyph,
  time: TimeGlyph,
  distance: DistanceGlyph,
  cal: CalGlyph,
  rpe: RpeGlyph,
};

// Shared by every icon-only control in a movement card's bands: a real 44px
// target (TOUCH.minTargetPx) holding a ~18px glyph, with no gap between
// neighbours so the cluster reads as one toolbar rather than four buttons.
const ICON_BTN =
  'hill-btn flex h-11 w-11 shrink-0 items-center justify-center transition-colors';
const GLYPH = 'h-[1.15rem] w-[1.15rem]';

// Module-level so the identity is stable across renders (useCountdown takes it
// as a dependency). The countdown also vibrates; this is the on-screen half.
const onRestDone = () => toast('Rest complete');

function clock(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const sectionLabel = (k: SectionKey) => k.charAt(0).toUpperCase() + k.slice(1);
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
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // The Done pile is open by default — you should see what you've finished —
  // but it folds away as one unit when the remaining work needs the screen.
  const [doneOpen, setDoneOpen] = useState(true);
  // Date + tags are correct on the common path, so they start folded away —
  // they were costing ~120px (three wrapped rows at 375px) above the first set.
  const [showDetails, setShowDetails] = useState(false);
  const [showVibe, setShowVibe] = useState(false);
  const [voiceTarget, setVoiceTarget] = useState<string | null>(null);
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
  // Editing a past workout (opened via ?logId=…&edit=1): reuse every logging
  // control but freeze the live-session behaviors (stopwatch, auto-end, finish).
  const [editing, setEditing] = useState(false);
  // Set when this page was asked to START a workout while another one is
  // still running. Nothing is created until the user answers.
  const [blockedBy, setBlockedBy] = useState<{ log: WorkoutLog; label: string } | null>(null);

  const stopwatch = useStopwatch(0, false);
  const rest = useCountdown(onRestDone);
  const voice = useVoiceInput();

  const docRef = useRef(doc);
  const secondsRef = useRef(stopwatch.seconds);
  const statusRef = useRef(status);
  const idRef = useRef(logId);
  const logDateRef = useRef(logDate);
  const tagsRef = useRef(tags);
  const startedAtRef = useRef(startedAt);
  const editingRef = useRef(editing);
  const autoEndedRef = useRef(false);
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
      const editMode = params.get('edit') === '1';
      setEditing(editMode);
      const library = await getMovements();
      setMovements(library);

      if (resumeId) {
        const log = await getLogById(resumeId);
        if (log) {
          setLogId(log.id);
          setPlanId(log.plan_id);
          setDayKey(log.day_key);
          setDoc(log.data ?? { sections: [] });
          setStatus(log.status);
          setLogDate(log.log_date);
          setTags(log.tags ?? []);
          if (log.plan_id) setSubs(await getMovementSubs(log.plan_id));
          if (log.session_id) setLinkedSession(await getSessionById(log.session_id));
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
      const [source, recent, allLogs] = await Promise.all([
        sessionParam
          ? getSessionById(sessionParam)
          : planParam
            ? getPlanById(planParam)
            : getActivePlan(),
        getRecentLogs(50),
        getAllLogs(),
      ]);
      setBestByMovement(bestE1rmByMovement(allLogs));

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
            // Active plan: the week is how many times this day has already been
            // logged (+1) — the Nth session of a day is program week N, grounded
            // in real logging rather than the calendar. A historic plan day
            // (launched via ?plan=) still derives its week from the plan's start
            // date, falling back to a week that has content.
            weekNumber = planParam
              ? resolveWeek(planDay, weekFromDate(plan.start_date, new Date(logDate)))
              : nextWeekForDay(allLogs, plan.id, dk, planWeekCount(plan.parsed));
            built = buildLogFromPlanDay(planDay, resolveWeek(planDay, weekNumber));
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

      for (const section of built.sections) {
        for (const group of section.groups) {
          for (const item of group.items) {
            const last = lastPerformance(recent, item.movement);
            if (!last) continue;
            item.sets = item.sets.map((set) => {
              // Weight prefills from last session; reps come from the target
              // when the prescription states one, so a programmed rep increase
              // is not overwritten by what was lifted last time.
              const target = plannedReps(set.planned, item.primaryMetric);
              return {
                ...set,
                actual: {
                  ...set.actual,
                  weight: last.weight,
                  reps: target ?? last.reps,
                  prefilled: true,
                },
              };
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
      if (!idRef.current) return;
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
    if (autoEndedRef.current || statusRef.current === 'done' || statusRef.current === 'cancelled') {
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

  function saveVibe(vibe: VibeCheck) {
    setDoc((d) => ({ ...d, session: { ...d.session, vibe } }));
    setShowVibe(false);
  }

  function changeDate(value: string) {
    setLogDate(value);
    if (idRef.current) updateLog(idRef.current, { log_date: value });
  }

  function toggleTag(tag: string) {
    setTags((prev) => {
      const next = prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag];
      if (idRef.current) updateLog(idRef.current, { tags: next });
      return next;
    });
  }

  function listen(itemId: string, si: number, gi: number, ii: number) {
    setVoiceTarget(itemId);
    voice.start((transcript) => {
      const parsed = parseVoiceSet(transcript);
      setVoiceTarget(null);
      if (Object.keys(parsed).length === 0) return;
      setDoc((d) => {
        const item = d.sections[si]?.groups[gi]?.items[ii];
        const ki = item ? Math.max(0, item.sets.length - 1) : 0;
        return patchSetActual(d, si, gi, ii, ki, parsed);
      });
    });
  }

  function handlePick(picked: Movement | { name: string }) {
    const name = 'name' in picked ? picked.name : (picked as Movement).name;
    const known = movements.find((m) => m.name.toLowerCase() === name.toLowerCase());
    const metric: MetricKey =
      'primary_metric' in picked ? (picked as Movement).primary_metric : known?.primary_metric ?? 'weight';

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
      const current = doc.sections[si]?.groups[gi]?.items[ii]?.primaryMetric ?? 'weight';
      setDoc((d) => swapItemMovement(d, si, gi, ii, name, swapMetric ?? current));
      if (planId && original && original.toLowerCase() !== name.toLowerCase()) {
        bumpMovementSub(planId, dayKey, original, name).then(() =>
          getMovementSubs(planId).then(setSubs),
        );
      }
    }
    setPicker(null);
  }

  async function finish() {
    setStatus('done');
    stopwatch.pause();
    if (idRef.current) {
      const ok = await updateLog(idRef.current, {
        data: docRef.current,
        total_seconds: secondsRef.current,
        status: 'done',
        ended_at: new Date().toISOString(),
        log_date: logDateRef.current,
        tags: tagsRef.current,
      });
      if (!ok) {
        toast('Save failed — check your connection and try again', 'error');
        return;
      }
    }
    track('workout_completed', { duration_seconds: secondsRef.current, tags: tagsRef.current });
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
    }
    window.location.href = '/app';
  }

  // Finish an edit of a past workout: persist the edited document (plus date/
  // tags) without changing status, duration, or ended_at, then return to the
  // read-only session view.
  async function finishEdit() {
    if (idRef.current) {
      const ok = await updateLog(idRef.current, {
        data: docRef.current,
        log_date: logDateRef.current,
        tags: tagsRef.current,
      });
      if (!ok) {
        toast('Save failed — check your connection and try again', 'error');
        return;
      }
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
    const item = doc.sections[si].groups[gi].items[ii];
    setDoc((d) => {
      const it = d.sections[si].groups[gi].items[ii];
      const src = it.sets[ki].actual;
      let next = d;
      if (ki + 1 >= it.sets.length) next = addSet(next, si, gi, ii);
      const patch: Partial<SetActual> = { prefilled: true };
      if (src.weight != null) patch.weight = src.weight;
      if (src.reps != null) patch.reps = src.reps;
      if (src.time != null) patch.time = src.time;
      if (src.distance != null) patch.distance = src.distance;
      return patchSetActual(next, si, gi, ii, ki + 1, patch);
    });
    const restSeconds = item.restSeconds ?? TIMERS.defaultRestSeconds;
    if (restSeconds > 0 && !editing) rest.start(restSeconds);
  }

  // `footerTrailing` rides in the SAME row as Add set rather than a band of its
  // own — the group-level actions (superset / remove) belong on one line with
  // it. Only a single-movement group passes it; inside a superset each member
  // keeps a bare Add set row and the group owns its own actions.
  function renderItem(
    si: number,
    gi: number,
    ii: number,
    grouped: boolean,
    footerTrailing?: ReactNode,
  ) {
    const group = doc.sections[si].groups[gi];
    const groupId = group.id;
    const item = group.items[ii];
    if (isSubroutine(item)) {
      return (
        <div key={item.id} className={grouped ? 'border-t border-border first:border-0' : ''}>
          {/* Carries its own px-4/py-3 now that the card container is unpadded
              — same band treatment as a movement's identity row. */}
          <div className="flex items-start justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <span className="capitalize text-fg">{item.movement}</span>
              <SubroutineBody description={item.description} url={item.url} className="mt-1" />
            </div>
            <button
              onClick={() => setOptionsFor({ si, gi, ii })}
              className="hill-btn shrink-0 border border-border bg-surface px-2 py-1 t-control text-muted hover:text-fg"
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
      <div key={item.id} className={grouped ? 'border-t border-border first:border-0' : ''}>
        {/* BAND 1 — identity. The metric/voice/rest/options cluster used to
            share this row and wrap onto a second line at 375px; the comment
            that stood here described fighting that wrap with a min-width on
            the name. The design bands the controls below a hairline instead,
            so the name row is a single line at every width and the controls
            get a full row of their own. `min-w-0` is now correct precisely
            because nothing competes for the space any more. */}
        <div className="flex items-center gap-2 px-4 py-0.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                activate(groupId);
                toggleItemComplete(si, gi, ii);
              }}
              // Same box as a set row's ✓, deliberately: they are the same
              // control at two scopes, and at 20px this one read as a decorative
              // tick beside three 44px checkboxes rather than the one that
              // completes all of them. The old comment here defended the small
              // glyph because "the pillow doesn't read at that scale" — that
              // pillow was a drop shadow, and it was retired with the rest of
              // the depth tokens, so the reason no longer holds.
              className={`hill-btn -ml-2 flex h-11 w-11 shrink-0 items-center justify-center border text-lg transition-colors ${
                allDone
                  ? 'border-accent bg-accent text-accent-fg'
                  : 'border-border bg-surface text-muted hover:text-fg'
              }`}
              aria-label="Complete movement"
              aria-pressed={allDone}
            >
              ✓
            </button>
            {collapsible ? (
              <button
                type="button"
                onClick={() => {
                  activate(groupId);
                  toggleCollapse(groupId);
                }}
                className="flex min-h-11 min-w-0 items-center gap-2 text-left text-fg"
                aria-label={isCollapsed ? 'Expand movement' : 'Collapse movement'}
                aria-expanded={!isCollapsed}
              >
                <span className={`inline-block shrink-0 text-[0.7rem] transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>
                  ▸
                </span>
                <span className="truncate capitalize">{item.movement}</span>
              </button>
            ) : (
              <span className="min-w-0 truncate capitalize text-fg">{item.movement}</span>
            )}
            {/* Video icon sits inline right after the name, same row, no vertical
                offset. Renders nothing when the movement has no demo. Opens the
                popup; tapping the scrim (or Escape) closes it. */}
            <DemoIconButton name={item.movement} onOpen={() => setDemoFor(item.movement)} />
          </div>
          {isCollapsed ? (
            <span className="t-control shrink-0 text-muted">
              {item.sets.length} {item.sets.length === 1 ? 'set' : 'sets'}
              {allDone ? ' · done' : ''}
            </span>
          ) : (
            /* Per-movement done/total, right-aligned in the identity band. */
            <span className="shrink-0 t-label text-faint tabular-nums">
              {doneCount}/{item.sets.length}
            </span>
          )}
        </div>

        {isCollapsed ? null : (
          <>
            {/* BAND 2 — controls. Icon-only and gapless: four 44px targets
                sitting flush, so the cluster reads as one toolbar. Each button
                carries an aria-label (the glyphs are aria-hidden) AND a title,
                because an icon that cycles through six metrics is not
                self-evident and the label is the only place the current one is
                written down. */}
            <div className="flex items-center border-t border-border-soft px-2 text-muted">
            {(() => {
              const MetricGlyph = METRIC_GLYPH[item.primaryMetric];
              return (
                <button
                  onClick={() => {
                    activate(groupId);
                    const nextMetric = METRIC_CYCLE[(METRIC_CYCLE.indexOf(item.primaryMetric) + 1) % METRIC_CYCLE.length];
                    setDoc((d) => setItemMetric(d, si, gi, ii, nextMetric));
                  }}
                  className={`${ICON_BTN} hover:text-fg`}
                  aria-label={`Metric: ${item.primaryMetric}. Change metric`}
                  title={`Metric: ${item.primaryMetric}`}
                >
                  <MetricGlyph className={GLYPH} />
                </button>
              );
            })()}
            {/* Voice stays visible at every width — the mockup hides it below
                sm:, and hiding a control on the primary target platform is
                removing a feature, not compacting a layout. Listening state is
                the teal signal token plus aria-pressed, not a text swap. */}
            {voice.supported && !editing ? (
              <button
                onClick={() => {
                  activate(groupId);
                  listen(item.id, si, gi, ii);
                }}
                aria-pressed={voiceTarget === item.id}
                aria-label={voiceTarget === item.id ? 'Listening — stop voice input' : 'Log this movement by voice'}
                title={voiceTarget === item.id ? 'Listening…' : 'Voice'}
                className={`${ICON_BTN} ${
                  voiceTarget === item.id ? 'text-teal' : 'hover:text-fg'
                }`}
              >
                <VoiceGlyph className={GLYPH} />
              </button>
            ) : null}
            {!editing ? (
              <button
                onClick={() => {
                  const restSeconds = item.restSeconds ?? TIMERS.defaultRestSeconds;
                  if (restSeconds > 0) rest.start(restSeconds);
                }}
                className={`${ICON_BTN} hover:text-fg`}
                aria-label={`Start ${item.restSeconds ?? TIMERS.defaultRestSeconds} second rest`}
                title="Rest timer"
              >
                <TimeGlyph className={GLYPH} />
              </button>
            ) : null}
            {/* Options sits hard right, opposite the act-on-this-set controls
                — the design's split toolbar. */}
            <span className="flex-1" />
            <button
              onClick={() => setOptionsFor({ si, gi, ii })}
              className={`${ICON_BTN} hover:text-fg`}
              aria-label="Movement options"
              title="Movement options"
            >
              <MoreGlyph className={GLYPH} />
            </button>
            </div>

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
              <div key={ki} className="flex flex-col gap-2 py-0.5">
                <SetRow
                  metric={item.primaryMetric}
                  set={set}
                  index={ki}
                  showPlanned={anyPlanned}
                  isPr={isPrSet(set.actual, bestByMovement.get(item.movement) ?? null)}
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
        {/* BAND 5 — actions, one line. Add set leads; the group-level
            superset/remove ride the same row via `footerTrailing`, with remove
            pushed hard right so the destructive control is not flush against
            the one tapped between every set. */}
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
          {footerTrailing}
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
        // card, matching the single-movement group's border-border below.
        // Horizontal padding moved off the card and onto the bands inside it,
        // so a superset's member movements band exactly like a standalone one
        // instead of being inset a second time by this container.
        <div
          key={group.id}
          className={`lift border border-border border-l-2 border-l-accent bg-surface ${
            isCollapsed ? 'py-1' : ''
          }`}
        >
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
            <div className="flex shrink-0 gap-1">
              {(['superset', 'circuit'] as GroupKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    activate(group.id);
                    setDoc((d) => setGroupKind(d, si, gi, k));
                  }}
                  aria-pressed={group.kind === k}
                  className={`flex min-h-11 items-center px-2 ${
                    group.kind === k ? 'text-accent' : 'text-muted hover:text-fg'
                  }`}
                >
                  {k}
                </button>
              ))}
              <button
                onClick={() => setDoc((d) => ungroup(d, si, gi))}
                className="flex min-h-11 items-center px-2 text-muted hover:text-fg"
              >
                Ungroup
              </button>
            </div>
            )}
          </div>
          {isCollapsed ? null : group.items.map((_, ii) => renderItem(si, gi, ii, true))}
        </div>
      );
    }
    const singleCollapsed = collapsed.has(group.id);
    return (
      // Flat card, hairline outline, surface fill — the bands inside supply
      // their own padding so every row runs the full width of the card.
      <div
        key={group.id}
        className={`lift border border-border bg-surface ${singleCollapsed ? 'py-1' : ''}`}
      >
        {renderItem(
          si,
          gi,
          0,
          false,
          <>
            {gi < groups.length - 1 ? (
              <button
                onClick={() => setDoc((d) => mergeWithNext(d, si, gi, 'superset'))}
                className={`${ICON_BTN} hover:text-fg`}
                aria-label="Superset this movement with the next one"
                title="Superset with next"
              >
                <LinkGlyph className={GLYPH} />
              </button>
            ) : null}
            <span className="flex-1" />
            <button
              onClick={() => setDoc((d) => removeGroup(d, si, gi))}
              className={`${ICON_BTN} hover:text-fg`}
              aria-label="Remove movement"
              title="Remove movement"
            >
              <TrashGlyph className={GLYPH} />
            </button>
          </>,
        )}
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
      <div key={group.id} className={superset ? 'border-l-2 border-l-accent' : ''}>
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
                {tags.length > 0 ? (
                  <span className="shrink-0 translate-y-[0.15em] text-[0.6rem] leading-none tracking-wide text-faint">
                    {tags.join(' ')}
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
          committed downward scroll, and the rest-timer bar below already
          sticks at top-12 underneath it — a third sticky bar in the same
          scroller means either a hard-coded offset that detaches when the
          app header retracts, or stacked stickies that must know each
          other's heights. The clock is not what you need mid-set; the rest
          timer is, and it is already sticky. */}
      <header className="mb-3">
        {/* Wraps: at 375px a session past the hour mark ("1:05:23" at
            text-4xl) plus Home and Pause does not fit on one line. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {editing ? (
            <div>
              <div className="font-display text-3xl uppercase tracking-tight text-fg">Editing</div>
              <div className={`t-label ${unsaved ? 'text-accent' : 'text-muted'}`}>
                {status}
                {saving ? ' · saving…' : ''}
                {unsaved && !saving ? ' · not saved' : ''}
              </div>
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
                  {status !== 'in_progress' && status !== 'paused' ? ` · ${status}` : ''}
                  {saving ? ' · saving…' : ''}
                  {unsaved && !saving ? ' · not saved' : ''}
                </div>
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
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-border">
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

        {showDetails ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={logDate}
              onChange={(e) => changeDate(e.target.value)}
              className="min-h-11 border border-border bg-surface px-3 text-base tabular-nums text-fg outline-none focus:border-subtle"
              aria-label="Session date"
            />
            {Object.entries(ACTIVITY_TAGS).map(([key, v]) => {
              const on = tags.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleTag(key)}
                  className={`hill-btn flex min-h-11 items-center border bg-surface px-3 t-control transition-colors ${
                    on ? '' : 'border-border text-muted hover:text-fg'
                  }`}
                  style={on ? { borderColor: v.color, color: v.color } : undefined}
                  aria-pressed={on}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
        ) : null}

        {showDetails && linkedSession?.source_text ? (
          <details className="mt-1.5 border border-border">
            <summary className="cursor-pointer px-3 py-2 t-control text-muted hover:text-fg">
              Source{linkedSession.source ? ` · ${linkedSession.source}` : ''}
            </summary>
            <pre className="whitespace-pre-wrap px-3 py-2 text-xs text-muted">
              {linkedSession.source_text}
            </pre>
          </details>
        ) : null}
      </header>

      {showVibe ? <VibeCheckCard onSave={saveVibe} onSkip={() => setShowVibe(false)} /> : null}

      <AnimatePresence>
        {rest.running ? (
          <motion.div
            key="rest"
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 12 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="sticky top-12 z-30 overflow-hidden border border-teal bg-bg pointer-fine:bg-bg/95 pointer-fine:backdrop-blur"
          >
            <div className="flex items-center justify-between gap-3 px-4">
              <span className="t-control text-teal">Rest</span>
              <span className="font-display text-2xl tabular-nums text-fg">{clock(rest.secondsLeft)}</span>
              <button
                onClick={rest.stop}
                className="flex min-h-11 items-center px-2 t-control text-muted hover:text-fg"
              >
                Skip
              </button>
            </div>
            {/* Remaining-fraction rule from the design — the countdown made
                glanceable, which is the whole job of a bar you look at from
                across a rack. Width only, so it composites without repainting
                the sticky bar's blurred backdrop on every tick. `aria-hidden`:
                the clock beside it already announces the real value. */}
            <div aria-hidden className="h-0.5 w-full bg-border-soft">
              <div
                className="h-full bg-teal"
                style={{
                  width: `${Math.min(100, Math.max(0, (rest.secondsLeft / Math.max(1, rest.totalSeconds)) * 100))}%`,
                }}
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {ordered.map((section) => {
        const si = doc.sections.findIndex((s) => s.key === section.key);
        const groups = doc.sections[si].groups;
        return (
          <section key={section.key} className="mb-3">
            {/* The two add-affordances go in SectionHeader's `action` slot
                rather than a second flex row around it — SectionHeader is
                itself a `flex justify-between` with its own mb-3, so wrapping
                it stacked two of them and left the label sitting in a nested
                row it did not own. */}
            <SectionHeader
              // `mb-1.5!` — SectionHeader hardcodes `mb-3` and Tailwind does no
              // class-merging here, so an unmarked override loses the cascade
              // (same trap as Button's `px-3!` above). Overridden per-caller
              // rather than changed in the primitive, which every other view
              // shares.
              className="mb-1.5!"
              action={
                <div className="-my-2 flex shrink-0 gap-1">
                  <button
                    onClick={() => setPicker({ mode: 'add', sectionKey: section.key })}
                    className="flex min-h-11 items-center px-2 t-control text-muted hover:text-fg"
                  >
                    + Movement
                  </button>
                  <button
                    onClick={() => setSubEditor({ mode: 'add', sectionKey: section.key })}
                    className="flex min-h-11 items-center px-2 t-control text-muted hover:text-fg"
                  >
                    + Subroutine
                  </button>
                </div>
              }
            >
              {sectionLabel(section.key)}{' '}
              <span className="text-faint tabular-nums">{groups.length}</span>
            </SectionHeader>
            <div className="flex flex-col gap-2">
              {groups.map((group, gi) => (parked.has(group.id) ? null : renderGroup(si, gi)))}
              {groups.length === 0 ? (
                <p className="text-sm text-muted">No movements yet.</p>
              ) : null}
            </div>
          </section>
        );
      })}

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
            <div className="mt-1 flex flex-col border border-border [&>*+*]:border-t [&>*+*]:border-border-soft">
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
        metric={entryItem?.primaryMetric ?? 'weight'}
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
          const restSeconds = entryItem.restSeconds ?? TIMERS.defaultRestSeconds;
          if (restSeconds > 0 && !editing) rest.start(restSeconds);
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
              const currentKey = doc.sections[si].key;
              const supersetTargets = doc.sections.flatMap((s, tsi) =>
                s.groups
                  .map((g, tgi) => ({ group: g, targetSi: tsi, targetGi: tgi, sectionKey: s.key }))
                  .filter(({ targetSi, targetGi }) => !(targetSi === si && targetGi === gi)),
              );
              const close = () => setOptionsFor(null);
              const rowClass =
                'hill-btn inline-flex min-h-11 items-center justify-center border border-border bg-surface px-4 text-sm uppercase tracking-wider text-fg transition-colors hover:border-fg disabled:opacity-40';
              return (
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <div className="mb-4 text-sm capitalize text-fg">{item.movement}</div>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handoff(() => {
                          if (sub) setSubEditor({ mode: 'edit', si, gi, ii });
                          else setPicker({ mode: 'swap', si, gi, ii });
                        })
                      }
                      className={rowClass}
                    >
                      {sub ? 'Edit subroutine' : 'Swap movement'}
                    </button>
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
                    <button
                      type="button"
                      onClick={() => {
                        setDoc((d) => removeItem(d, si, gi, ii));
                        close();
                      }}
                      className={rowClass}
                    >
                      {sub ? 'Remove subroutine' : 'Remove movement'}
                    </button>
                  </div>

                  <div className="mt-5">
                    <div className="mb-2 t-label text-muted">
                      Move to section
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {SECTIONS.filter((k) => k !== currentKey).map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => {
                            setDoc((d) => moveGroupToSection(d, si, gi, k));
                            close();
                          }}
                          className="hill-btn border border-border bg-surface px-2 py-1 text-xs text-fg transition-colors hover:border-fg"
                        >
                          {sectionLabel(k)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {!sub && supersetTargets.length > 0 ? (
                    <div className="mt-5">
                      <div className="mb-2 t-label text-muted">
                        Superset with
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {supersetTargets.map(({ group: g, targetSi, targetGi, sectionKey }) => (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => {
                              setDoc((d) => groupWithAcrossSections(d, si, gi, targetSi, targetGi, 'superset'));
                              close();
                            }}
                            className="hill-btn border border-border bg-surface px-2 py-1 text-xs capitalize text-fg transition-colors hover:border-fg"
                          >
                            {g.items.map((it) => it.movement).join(' + ')}
                            {sectionKey !== currentKey ? (
                              <span className="ml-1 uppercase tracking-wider text-muted">
                                · {sectionLabel(sectionKey)}
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

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
                      className="w-full resize-none border border-border bg-surface px-2 py-1.5 text-sm text-fg placeholder:text-muted focus:border-fg focus:outline-none"
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
                            className={`hill-btn border bg-surface px-2 py-1 text-xs transition-colors ${
                              on ? 'border-fg text-fg' : 'border-border text-muted hover:text-fg'
                            }`}
                          >
                            {sym}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-5">
                    <div className="mb-2 t-label text-muted">
                      Rest between sets
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {TIMERS.restPresets.map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => setDoc((d) => setItemRest(d, si, gi, ii, sec))}
                          aria-pressed={item.restSeconds === sec}
                          className={`hill-btn border bg-surface px-2 py-1 text-xs tabular-nums transition-colors ${
                            item.restSeconds === sec
                              ? 'border-fg text-fg'
                              : 'border-border text-muted hover:text-fg'
                          }`}
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
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
          {editing ? (
            <Button onClick={finishEdit} className="w-full">
              Done
            </Button>
          ) : (
            <>
              {/* Finish takes the width; discard is a 44px square beside it.
                  The size difference IS the safeguard — the two are one gap
                  apart, so what keeps a shaking hand off the wrong one is that
                  Finish is ~6x the area and filled while discard is a hairline
                  square. It also opens a confirm sheet rather than discarding,
                  which the per-movement trash does not. Both are `min-h-11`
                  with a border so their boxes align to the pixel (see the
                  Button primitive's note on why primary carries a border). */}
              <Button onClick={() => finish()} className="flex-1">
                Finish
                <span className="ml-2 text-bg/45 tabular-nums">
                  {sessionSets.done}/{sessionSets.total}
                </span>
              </Button>
              <button
                type="button"
                onClick={() => setConfirmDiscard(true)}
                className="hill-btn flex h-11 w-11 shrink-0 items-center justify-center border border-border bg-surface text-muted transition-colors hover:text-fg"
                aria-label="Discard session"
                title="Discard session"
              >
                <TrashGlyph className={GLYPH} />
              </button>
            </>
          )}
        </div>
      </div>

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
