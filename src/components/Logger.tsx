import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { supabase } from '@/lib/supabase';
import {
  bumpMovementSub,
  createLog,
  dismissMovementSub,
  getActivePlan,
  getLogById,
  getMovementSubs,
  getMovements,
  getRecentLogs,
  updateLog,
} from '@/lib/queries';
import { buildBlankLog, buildLogFromPlanDay } from '@/lib/logBuilder';
import {
  addItem,
  addSet,
  groupWith,
  mergeWithNext,
  moveGroup,
  patchSetActual,
  removeGroup,
  removeItem,
  removeSet,
  setGroupKind,
  setItemMetric,
  setItemRest,
  swapItemMovement,
  toggleItemNotation,
  ungroup,
} from '@/lib/logEdits';
import { lastPerformance } from '@/lib/lastPerformance';
import { useCountdown, useStopwatch } from '@/lib/useTimer';
import { parseVoiceSet, useVoiceInput } from '@/lib/voice';
import { weekFromDate } from '@/lib/week';
import { ACTIVITY_TAGS, NOTATIONS, SECTIONS, TIMERS, type MetricKey, type SectionKey } from '@/app.config';
import type {
  GroupKind,
  LogDocument,
  LogStatus,
  Movement,
  MovementSub,
  SetActual,
  VibeCheck,
} from '@/lib/types';
import { Button, SectionHeader } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/Modal';
import { EASE } from '@/components/anim';
import { SetRow } from '@/components/logger/SetRow';
import { MovementPicker } from '@/components/logger/MovementPicker';
import { VibeCheckCard } from '@/components/logger/VibeCheckCard';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { toast } from '@/lib/toast';

const METRIC_CYCLE: MetricKey[] = ['weight', 'reps', 'time', 'distance', 'rpe'];

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

export default function Logger() {
  const [ready, setReady] = useState(false);
  const [logId, setLogId] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [doc, setDoc] = useState<LogDocument>({ sections: [] });
  const [status, setStatus] = useState<LogStatus>('in_progress');
  const [saving, setSaving] = useState(false);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [subs, setSubs] = useState<MovementSub[]>([]);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [optionsFor, setOptionsFor] = useState<{ si: number; gi: number; ii: number } | null>(null);
  const [showVibe, setShowVibe] = useState(false);
  const [voiceTarget, setVoiceTarget] = useState<string | null>(null);
  const [logDate, setLogDate] = useState<string>(today());
  const [tags, setTags] = useState<string[]>([]);

  const stopwatch = useStopwatch(0, false);
  const rest = useCountdown();
  const voice = useVoiceInput();

  const docRef = useRef(doc);
  const secondsRef = useRef(stopwatch.seconds);
  const statusRef = useRef(status);
  const idRef = useRef(logId);
  const logDateRef = useRef(logDate);
  const tagsRef = useRef(tags);
  docRef.current = doc;
  secondsRef.current = stopwatch.seconds;
  statusRef.current = status;
  idRef.current = logId;
  logDateRef.current = logDate;
  tagsRef.current = tags;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        window.location.href = '/login';
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const resumeId = params.get('logId');
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
          if (log.total_seconds) stopwatch.start();
        }
        setReady(true);
        return;
      }

      const dk = params.get('day');
      const dateParam = params.get('date');
      const logDate = dateParam ?? today();
      const [plan, recent] = await Promise.all([getActivePlan(), getRecentLogs(50)]);
      let built: LogDocument;
      let weekNumber: number | null = null;
      const planLinked = plan && dk;
      if (planLinked) {
        const planDay = plan.parsed.days.find((d) => d.dayKey === dk);
        weekNumber = weekFromDate(plan.start_date, new Date(logDate));
        built = planDay ? buildLogFromPlanDay(planDay, weekNumber) : buildBlankLog();
      } else {
        built = buildBlankLog();
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

      const linkedPlanId = planLinked ? plan.id : null;
      const created = await createLog({
        log_date: logDate,
        plan_id: linkedPlanId,
        day_key: dk,
        week_number: weekNumber,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        data: built,
        tags: [],
      });
      setDoc(built);
      setLogDate(logDate);
      setPlanId(linkedPlanId);
      setDayKey(dk);
      if (created) setLogId(created.id);
      if (linkedPlanId) setSubs(await getMovementSubs(linkedPlanId));
      setShowVibe(true);
      stopwatch.start();
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(async () => {
      if (!idRef.current || statusRef.current === 'done' || statusRef.current === 'cancelled') return;
      setSaving(true);
      await updateLog(idRef.current, {
        data: docRef.current,
        total_seconds: secondsRef.current,
        status: statusRef.current,
        log_date: logDateRef.current,
        tags: tagsRef.current,
      });
      setSaving(false);
    }, TIMERS.autosaveSeconds * 1000);
    return () => clearInterval(id);
  }, []);

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
      setDoc((d) => addItem(d, picker.sectionKey, name, metric));
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
    window.location.href =
      next === 'done' && idRef.current ? `/app/session?id=${idRef.current}` : '/app';
  }

  if (!ready) return <div className="px-6 py-16 text-sm text-muted">Loading…</div>;

  const ordered = doc.sections
    .slice()
    .sort((a, b) => SECTIONS.indexOf(a.key) - SECTIONS.indexOf(b.key));
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
    rest.start(item.restSeconds ?? TIMERS.defaultRestSeconds);
  }

  function renderItem(si: number, gi: number, ii: number, grouped: boolean) {
    const item = doc.sections[si].groups[gi].items[ii];
    const allDone = item.sets.length > 0 && item.sets.every((s) => s.actual.completed);
    return (
      <div key={item.id} className={grouped ? 'border-t border-border pt-3 first:border-0 first:pt-0' : ''}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => toggleItemComplete(si, gi, ii)}
              className={`flex h-5 w-5 items-center justify-center border text-[0.6rem] ${
                allDone ? 'border-accent bg-accent text-accent-fg' : 'border-border text-muted hover:text-fg'
              }`}
              aria-label="Complete movement"
              aria-pressed={allDone}
            >
              ✓
            </button>
            <span className="capitalize text-fg">{item.movement}</span>
          </div>
          <div className="flex items-center gap-2 text-[0.7rem] uppercase tracking-wider text-muted">
            <button
              onClick={() => {
                const nextMetric = METRIC_CYCLE[(METRIC_CYCLE.indexOf(item.primaryMetric) + 1) % METRIC_CYCLE.length];
                setDoc((d) => setItemMetric(d, si, gi, ii, nextMetric));
              }}
              className="border border-border px-2 py-1 hover:text-fg"
              aria-label="Change metric"
            >
              {item.primaryMetric}
            </button>
            {voice.supported ? (
              <button
                onClick={() => listen(item.id, si, gi, ii)}
                className={`border px-2 py-1 hover:text-fg ${
                  voiceTarget === item.id ? 'border-accent text-accent' : 'border-border'
                }`}
              >
                {voiceTarget === item.id ? 'Listening…' : 'Voice'}
              </button>
            ) : null}
            <button
              onClick={() => rest.start(item.restSeconds ?? TIMERS.defaultRestSeconds)}
              className="hover:text-fg"
            >
              Rest
            </button>
            <button
              onClick={() => setOptionsFor({ si, gi, ii })}
              className="border border-border px-2 py-1 hover:text-fg"
              aria-label="Movement options"
            >
              ⋯
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-3">
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
              <div key={ki} className="flex flex-col gap-2">
                <SetRow
                  metric={item.primaryMetric}
                  set={set}
                  onPatch={(patch) => setDoc((d) => patchSetActual(d, si, gi, ii, ki, patch))}
                  onToggle={() =>
                    setDoc((d) => patchSetActual(d, si, gi, ii, ki, { completed: !set.actual.completed }))
                  }
                  onRemove={() => setDoc((d) => removeSet(d, si, gi, ii, ki))}
                  onCloneForward={() => cloneForward(si, gi, ii, ki)}
                />
                {cliff ? (
                  <div className="pl-3 text-[0.65rem] uppercase tracking-wider text-accent">
                    Rep drop {prev!.actual.reps! - set.actual.reps!} — extend rest or stop
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <button
          onClick={() => setDoc((d) => addSet(d, si, gi, ii))}
          className="mt-3 text-[0.7rem] uppercase tracking-wider text-muted hover:text-fg"
        >
          + Add set
        </button>
      </div>
    );
  }

  return (
    <ErrorBoundary>
    <MotionConfig reducedMotion="user">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="mx-auto max-w-2xl px-6 py-8 pb-32"
      >
      <header className="mb-8 flex items-center justify-between">
        <div>
          <div className="font-display text-5xl tabular-nums text-fg">{clock(stopwatch.seconds)}</div>
          <div className="text-[0.7rem] uppercase tracking-wider text-muted">
            {status}
            {saving ? ' · saving…' : ''}
          </div>
        </div>
        <Button variant="ghost" onClick={() => (stopwatch.running ? stopwatch.pause() : stopwatch.resume())}>
          {stopwatch.running ? 'Pause' : 'Resume'}
        </Button>
      </header>

      <div className="mb-8 flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={logDate}
          onChange={(e) => changeDate(e.target.value)}
          className="min-h-9 border border-border bg-surface px-2 text-sm tabular-nums text-fg outline-none focus:border-subtle"
          aria-label="Session date"
        />
        {Object.entries(ACTIVITY_TAGS).map(([key, v]) => {
          const on = tags.includes(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggleTag(key)}
              className={`border px-2 py-1 text-[0.65rem] uppercase tracking-wider transition-colors ${
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

      {showVibe ? <VibeCheckCard onSave={saveVibe} onSkip={() => setShowVibe(false)} /> : null}

      <AnimatePresence>
        {rest.running ? (
          <motion.div
            key="rest"
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="flex items-center justify-between overflow-hidden border border-accent px-4 py-2"
          >
            <span className="text-[0.7rem] uppercase tracking-wider text-accent">Rest</span>
            <span className="font-display text-2xl tabular-nums text-fg">{clock(rest.secondsLeft)}</span>
            <button onClick={rest.stop} className="text-[0.7rem] uppercase tracking-wider text-muted">
              Skip
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {ordered.map((section) => {
        const si = doc.sections.findIndex((s) => s.key === section.key);
        const groups = doc.sections[si].groups;
        return (
          <section key={section.key} className="mb-8">
            <div className="mb-3 flex items-center justify-between">
              <SectionHeader>{sectionLabel(section.key)}</SectionHeader>
              <button
                onClick={() => setPicker({ mode: 'add', sectionKey: section.key })}
                className="text-[0.7rem] uppercase tracking-wider text-muted hover:text-fg"
              >
                + Movement
              </button>
            </div>
            <div className="flex flex-col gap-4">
              {groups.map((group, gi) => {
                if (group.items.length > 1) {
                  return (
                    <div key={group.id} className="border border-accent p-4">
                      <div className="mb-3 flex items-center justify-between text-[0.7rem] uppercase tracking-wider">
                        <div className="flex gap-2">
                          {(['superset', 'circuit'] as GroupKind[]).map((k) => (
                            <button
                              key={k}
                              onClick={() => setDoc((d) => setGroupKind(d, si, gi, k))}
                              className={group.kind === k ? 'text-accent' : 'text-muted hover:text-fg'}
                            >
                              {k}
                            </button>
                          ))}
                        </div>
                        <button
                          onClick={() => setDoc((d) => ungroup(d, si, gi))}
                          className="text-muted hover:text-fg"
                        >
                          Ungroup
                        </button>
                      </div>
                      {group.items.map((_, ii) => renderItem(si, gi, ii, true))}
                    </div>
                  );
                }
                return (
                  <div key={group.id} className="border border-border p-4">
                    {renderItem(si, gi, 0, false)}
                    <div className="mt-3 flex justify-end gap-3 text-[0.7rem] uppercase tracking-wider">
                      {gi < groups.length - 1 ? (
                        <button
                          onClick={() => setDoc((d) => mergeWithNext(d, si, gi, 'superset'))}
                          className="text-muted hover:text-fg"
                        >
                          Superset with next
                        </button>
                      ) : null}
                      <button
                        onClick={() => setDoc((d) => removeGroup(d, si, gi))}
                        className="text-muted hover:text-fg"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
              {groups.length === 0 ? (
                <p className="text-sm text-muted">No movements yet.</p>
              ) : null}
            </div>
          </section>
        );
      })}

      <AnimatePresence>
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
      </AnimatePresence>

      <Modal open={optionsFor !== null} onClose={() => setOptionsFor(null)} title="Movement">
        {optionsFor
          ? (() => {
              const { si, gi, ii } = optionsFor;
              const item = doc.sections[si]?.groups[gi]?.items[ii];
              if (!item) return null;
              const groups = doc.sections[si].groups;
              const close = () => setOptionsFor(null);
              const rowClass =
                'inline-flex min-h-11 items-center justify-center border border-border px-4 text-sm uppercase tracking-wider text-fg transition-colors hover:border-fg disabled:opacity-40';
              return (
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <div className="mb-4 text-sm capitalize text-fg">{item.movement}</div>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPicker({ mode: 'swap', si, gi, ii });
                        close();
                      }}
                      className={rowClass}
                    >
                      Swap movement
                    </button>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={gi === 0}
                        onClick={() => {
                          setDoc((d) => moveGroup(d, si, gi, -1));
                          close();
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
                          close();
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
                      Remove movement
                    </button>
                  </div>

                  {groups.length > 1 ? (
                    <div className="mt-5">
                      <div className="mb-2 text-[0.65rem] uppercase tracking-[0.2em] text-muted">
                        Superset with
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {groups.map((g, idx) =>
                          idx === gi ? null : (
                            <button
                              key={g.id}
                              type="button"
                              onClick={() => {
                                setDoc((d) => groupWith(d, si, gi, idx, 'superset'));
                                close();
                              }}
                              className="border border-border px-2 py-1 text-xs capitalize text-fg transition-colors hover:border-fg"
                            >
                              {g.items.map((it) => it.movement).join(' + ')}
                            </button>
                          ),
                        )}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-5">
                    <div className="mb-2 text-[0.65rem] uppercase tracking-[0.2em] text-muted">
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
                            className={`border px-2 py-1 text-xs transition-colors ${
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
                    <div className="mb-2 text-[0.65rem] uppercase tracking-[0.2em] text-muted">
                      Rest between sets
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {TIMERS.restPresets.map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => setDoc((d) => setItemRest(d, si, gi, ii, sec))}
                          className={`border px-2 py-1 text-xs tabular-nums transition-colors ${
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
                </div>
              );
            })()
          : null}
      </Modal>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-bg/95 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-2xl gap-3">
          <Button onClick={() => finish('done')} className="flex-1">
            Finish
          </Button>
          <Button variant="ghost" onClick={() => finish('cancelled')}>
            Cancel
          </Button>
        </div>
      </div>
    </motion.div>
    </MotionConfig>
    </ErrorBoundary>
  );
}
