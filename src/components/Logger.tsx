import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { supabase } from '@/lib/supabase';
import {
  bumpMovementSub,
  createLog,
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
import { activeSessionOf } from '@/lib/activeSession';
import { typeFromLabel } from '@/lib/timeline';
import { SubroutineBody } from '@/components/SubroutineBody';
import { lastPerformance } from '@/lib/lastPerformance';
import { bestE1rmByMovement, isPrSet } from '@/lib/prs';
import { useCountdown, useStopwatch } from '@/lib/useTimer';
import { parseVoiceSet, useVoiceInput } from '@/lib/voice';
import { weekFromDate } from '@/lib/week';
import { nextWeekForDay, planWeekCount } from '@/lib/progression';
import { ACTIVITY_TAGS, NOTATIONS, SECTIONS, TIMERS, type MetricKey, type SectionKey } from '@/app.config';
import type {
  GroupKind,
  LogDocument,
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
import { toast } from '@/lib/toast';

const METRIC_CYCLE: MetricKey[] = ['weight', 'reps', 'time', 'distance', 'cal', 'rpe'];

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
            item.sets = item.sets.map((set) => ({
              ...set,
              actual: { ...set.actual, weight: last.weight, reps: last.reps, prefilled: true },
            }));
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

  async function finish(next: 'done' | 'cancelled') {
    setStatus(next);
    stopwatch.pause();
    if (idRef.current) {
      const ok = await updateLog(idRef.current, {
        data: docRef.current,
        total_seconds: secondsRef.current,
        status: next,
        ended_at: new Date().toISOString(),
        log_date: logDateRef.current,
        tags: tagsRef.current,
      });
      if (!ok) {
        toast('Save failed — check your connection and try again', 'error');
        return;
      }
    }
    if (next === 'done') {
      track('workout_completed', { duration_seconds: secondsRef.current, tags: tagsRef.current });
    } else {
      track('workout_cancelled', { duration_seconds: secondsRef.current });
    }
    window.location.href =
      next === 'done' && idRef.current ? `/app/session?id=${idRef.current}` : '/app';
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
              . Starting a new one leaves it behind.
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
                  const ok = await updateLog(blockedBy.log.id, {
                    status: 'cancelled',
                    ended_at: new Date().toISOString(),
                  });
                  if (!ok) {
                    toast('Save failed — check your connection and try again', 'error');
                    return;
                  }
                  // Re-enter through the front door: with the old session
                  // cancelled the gate no longer trips, and the build path
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

  function renderItem(si: number, gi: number, ii: number, grouped: boolean) {
    const group = doc.sections[si].groups[gi];
    const groupId = group.id;
    const item = group.items[ii];
    if (isSubroutine(item)) {
      return (
        <div key={item.id} className={grouped ? 'border-t border-border pt-3 first:border-0 first:pt-0' : ''}>
          <div className="flex items-start justify-between gap-2">
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
    return (
      <div key={item.id} className={grouped ? 'border-t border-border pt-3 first:border-0 first:pt-0' : ''}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {/* A definite min-width is what makes the wrap actually happen: with
              min-w-0 the name collapses to nothing so the controls always
              "fit" on one line and cover it. */}
          <div className="flex min-w-[8rem] flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                activate(groupId);
                toggleItemComplete(si, gi, ii);
              }}
              className="-ml-2 flex min-h-11 w-11 shrink-0 items-center justify-center"
              aria-label="Complete movement"
              aria-pressed={allDone}
            >
              {/* The glyph stays 20px — the pillow doesn't read at that scale —
                  but the tap target around it meets TOUCH.minTargetPx. */}
              <span
                aria-hidden
                className={`flex h-5 w-5 items-center justify-center border text-[0.6rem] ${
                  allDone
                    ? 'border-accent bg-accent text-accent-fg'
                    : 'border-border text-muted'
                }`}
              >
                ✓
              </span>
            </button>
            {collapsible ? (
              <button
                type="button"
                onClick={() => {
                  activate(groupId);
                  toggleCollapse(groupId);
                }}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-fg"
                aria-label={isCollapsed ? 'Expand movement' : 'Collapse movement'}
                aria-expanded={!isCollapsed}
              >
                <span className={`inline-block shrink-0 text-[0.7rem] transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>
                  ▸
                </span>
                <span className="truncate capitalize">{item.movement}</span>
              </button>
            ) : (
              <span className="capitalize text-fg">{item.movement}</span>
            )}
          </div>
          {isCollapsed ? (
            <span className="t-control shrink-0 text-muted">
              {item.sets.length} {item.sets.length === 1 ? 'set' : 'sets'}
              {allDone ? ' · done' : ''}
            </span>
          ) : (
          <>
            {/* Per-movement done/total — the mockup's "2/4" between the name
                and the chip row. Fragment, not a wrapping div, so this and
                the chip row stay siblings of the name block above and the
                whole header keeps wrapping as ONE flex-wrap row rather than
                stacking into two. */}
            <span className="shrink-0 t-label text-faint tabular-nums">
              {doneCount}/{item.sets.length}
            </span>
            <div className="flex items-center gap-2 t-control text-muted">
            <button
              onClick={() => {
                activate(groupId);
                const nextMetric = METRIC_CYCLE[(METRIC_CYCLE.indexOf(item.primaryMetric) + 1) % METRIC_CYCLE.length];
                setDoc((d) => setItemMetric(d, si, gi, ii, nextMetric));
              }}
              className="hill-btn flex min-h-11 items-center border border-border bg-surface px-2 hover:text-fg"
              aria-label="Change metric"
            >
              {item.primaryMetric}
            </button>
            {/* Voice stays visible at every width — the mockup hides it below
                sm:, and hiding a control on the primary target platform is
                removing a feature, not compacting a layout. The row wraps
                instead (parent is flex-wrap). */}
            {voice.supported && !editing ? (
              <button
                onClick={() => {
                  activate(groupId);
                  listen(item.id, si, gi, ii);
                }}
                aria-pressed={voiceTarget === item.id}
                className={`hill-btn flex min-h-11 items-center border bg-surface px-2 hover:text-fg ${
                  voiceTarget === item.id ? 'border-accent text-accent' : 'border-border'
                }`}
              >
                {voiceTarget === item.id ? 'Listening…' : 'Voice'}
              </button>
            ) : null}
            {!editing ? (
              <button
                onClick={() => {
                  const restSeconds = item.restSeconds ?? TIMERS.defaultRestSeconds;
                  if (restSeconds > 0) rest.start(restSeconds);
                }}
                className="hill-btn flex min-h-11 items-center border border-border bg-surface px-2 hover:text-fg"
              >
                Rest
              </button>
            ) : null}
            <button
              onClick={() => setOptionsFor({ si, gi, ii })}
              className="hill-btn flex min-h-11 items-center border border-border bg-surface px-2 hover:text-fg"
              aria-label="Movement options"
            >
              ⋯
            </button>
            </div>
          </>
          )}
        </div>
        {isCollapsed ? null : (
        <>
        {item.notes ? (
          // Tap-to-expand, one-line clamp — `line-clamp-1` is a Tailwind v4
          // core utility, not hand-rolled CSS (see docs/LESSONS.md § "Hand-
          // written CSS loses its unprefixed property" for why a hand-rolled
          // -webkit-line-clamp rule is the wrong call here). -my-2 pulls the
          // min-h-11 tap target back so a one-line note doesn't push the set
          // list down — same technique as the +Movement/+Subroutine row.
          <button
            type="button"
            onClick={() => toggleNotesOpen(item.id)}
            aria-expanded={notesOpen.has(item.id)}
            className="-my-2 flex min-h-11 w-full items-center border-l-2 border-border pl-2 text-left"
          >
            <span
              className={`whitespace-pre-wrap t-control text-muted ${
                notesOpen.has(item.id) ? '' : 'line-clamp-1'
              }`}
            >
              {item.notes}
            </span>
          </button>
        ) : null}
        <div className="flex flex-col [&>*+*]:border-t [&>*+*]:border-border-soft">
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
              <div key={ki} className="flex flex-col gap-2 py-2">
                <SetRow
                  metric={item.primaryMetric}
                  set={set}
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
                  <div className="pl-3 t-control text-accent">
                    Rep drop {prev!.actual.reps! - set.actual.reps!} — extend rest or stop
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <button
          onClick={() => {
            activate(groupId);
            setDoc((d) => addSet(d, si, gi, ii));
          }}
          className="mt-3 flex min-h-11 w-full items-center justify-center border border-dashed border-border t-control text-muted transition-colors hover:border-fg hover:text-fg"
        >
          + Add set
        </button>
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
        <div
          key={group.id}
          className={`border border-border border-l-2 border-l-accent ${isCollapsed ? 'px-4 py-1' : 'p-4'}`}
        >
          <div className={`flex items-center justify-between gap-2 t-control ${isCollapsed ? '' : 'mb-3'}`}>
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
      <div
        key={group.id}
        className={`border border-border ${singleCollapsed ? 'px-4 py-1' : 'p-4'}`}
      >
        {renderItem(si, gi, 0, false)}
        {singleCollapsed ? null : (
        <div className="mt-3 flex justify-end gap-1 t-control">
          {gi < groups.length - 1 ? (
            <button
              onClick={() => setDoc((d) => mergeWithNext(d, si, gi, 'superset'))}
              className="flex min-h-11 items-center px-3 text-muted hover:text-fg"
            >
              Superset with next
            </button>
          ) : null}
          <button
            onClick={() => setDoc((d) => removeGroup(d, si, gi))}
            className="flex min-h-11 items-center px-3 text-muted hover:text-fg"
          >
            Remove
          </button>
        </div>
        )}
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
      <div className="mx-auto w-full max-w-2xl flex-1 px-3 sm:px-4 pb-8 pt-4">
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
      <header className="mb-6">
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
                <div className={`t-label ${unsaved ? 'text-accent' : 'text-muted'}`}>
                  {status}
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
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-border">
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
            <span className="t-label text-muted tabular-nums">
              {logDate}
              {tags.length ? ` · ${tags.length}` : ''}
            </span>
          </span>
        </div>

        {showDetails ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
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
          <details className="mt-3 border border-border">
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
            animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="sticky top-12 z-30 flex items-center justify-between gap-3 overflow-hidden border border-accent bg-bg px-4 pointer-fine:bg-bg/95 pointer-fine:backdrop-blur"
          >
            <span className="t-control text-accent">Rest</span>
            <span className="font-display text-2xl tabular-nums text-fg">{clock(rest.secondsLeft)}</span>
            <button
              onClick={rest.stop}
              className="flex min-h-11 items-center px-2 t-control text-muted hover:text-fg"
            >
              Skip
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {ordered.map((section) => {
        const si = doc.sections.findIndex((s) => s.key === section.key);
        const groups = doc.sections[si].groups;
        return (
          <section key={section.key} className="mb-6">
            {/* The two add-affordances go in SectionHeader's `action` slot
                rather than a second flex row around it — SectionHeader is
                itself a `flex justify-between` with its own mb-3, so wrapping
                it stacked two of them and left the label sitting in a nested
                row it did not own. */}
            <SectionHeader
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
            <div className="flex flex-col gap-4">
              {groups.map((group, gi) => (parked.has(group.id) ? null : renderGroup(si, gi)))}
              {groups.length === 0 ? (
                <p className="text-sm text-muted">No movements yet.</p>
              ) : null}
            </div>
          </section>
        );
      })}

      {doneGroups.length > 0 ? (
        <section className="mb-6 border-t border-border pt-4">
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
              {doneGroups.length} {doneGroups.length === 1 ? 'movement' : 'movements'}
            </span>
          </button>
          {doneOpen ? (
            <div className="mt-1 flex flex-col gap-2">
              {doneGroups.map(({ si, gi }) => renderGroup(si, gi))}
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
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-1">
          {editing ? (
            <Button onClick={finishEdit} className="w-full">
              Done
            </Button>
          ) : (
            <>
              {/* Finish owns the full width; discarding is a deliberate,
                  confirmed act rather than a button 12px from the one you
                  reach for with a shaking hand after a set. */}
              <Button onClick={() => finish('done')} className="w-full">
                Finish
                <span className="ml-2 text-bg/45 tabular-nums">
                  {sessionSets.done}/{sessionSets.total}
                </span>
              </Button>
              <button
                type="button"
                onClick={() => setConfirmDiscard(true)}
                className="flex min-h-11 items-center px-3 t-control text-muted transition-colors hover:text-fg"
              >
                Discard session
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
                finish('cancelled');
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
