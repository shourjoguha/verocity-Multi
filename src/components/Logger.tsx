import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  createLog,
  getActivePlan,
  getLogById,
  getRecentLogs,
  updateLog,
} from '@/lib/queries';
import { buildBlankLog, buildLogFromPlanDay } from '@/lib/logBuilder';
import { lastPerformance } from '@/lib/lastPerformance';
import { useCountdown, useStopwatch } from '@/lib/useTimer';
import { weekFromDate } from '@/lib/week';
import { RPE, SECTIONS, TIMERS, type SectionKey } from '@/app.config';
import type { LogDocument, LogStatus } from '@/lib/types';
import { Button, SectionHeader } from '@/components/ui/primitives';
import { WeightWheel } from '@/components/logger/WeightWheel';
import { RepsStepper } from '@/components/logger/RepsStepper';

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

export default function Logger() {
  const [ready, setReady] = useState(false);
  const [logId, setLogId] = useState<string | null>(null);
  const [doc, setDoc] = useState<LogDocument>({ sections: [] });
  const [status, setStatus] = useState<LogStatus>('in_progress');
  const [saving, setSaving] = useState(false);

  const stopwatch = useStopwatch(0, false);
  const rest = useCountdown();

  // Refs hold the latest values for the autosave interval (avoids stale closure).
  const docRef = useRef(doc);
  const secondsRef = useRef(stopwatch.seconds);
  const statusRef = useRef(status);
  const idRef = useRef(logId);
  docRef.current = doc;
  secondsRef.current = stopwatch.seconds;
  statusRef.current = status;
  idRef.current = logId;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        window.location.href = '/login';
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const resumeId = params.get('logId');

      if (resumeId) {
        const log = await getLogById(resumeId);
        if (log) {
          setLogId(log.id);
          setDoc(log.data ?? { sections: [] });
          setStatus(log.status);
          if (log.total_seconds) stopwatch.start();
        }
        setReady(true);
        return;
      }

      // New session: build from plan day, else blank custom.
      const dayKey = params.get('day');
      const [plan, recent] = await Promise.all([getActivePlan(), getRecentLogs(50)]);
      let built: LogDocument;
      let weekNumber: number | null = null;
      if (plan && dayKey) {
        const planDay = plan.parsed.days.find((d) => d.dayKey === dayKey);
        weekNumber = weekFromDate(plan.start_date, new Date());
        built = planDay ? buildLogFromPlanDay(planDay, weekNumber) : buildBlankLog();
      } else {
        built = buildBlankLog();
      }

      // Prefill each item's sets from last performance.
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

      const created = await createLog({
        log_date: today(),
        plan_id: plan && dayKey ? plan.id : null,
        day_key: dayKey,
        week_number: weekNumber,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        data: built,
        tags: [],
      });
      setDoc(built);
      if (created) setLogId(created.id);
      stopwatch.start();
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave every 15s while active.
  useEffect(() => {
    const id = setInterval(async () => {
      if (!idRef.current || statusRef.current === 'done' || statusRef.current === 'cancelled') return;
      setSaving(true);
      await updateLog(idRef.current, {
        data: docRef.current,
        total_seconds: secondsRef.current,
        status: statusRef.current,
      });
      setSaving(false);
    }, TIMERS.autosaveSeconds * 1000);
    return () => clearInterval(id);
  }, []);

  function patchSet(
    si: number,
    gi: number,
    ii: number,
    ki: number,
    patch: Partial<LogDocument['sections'][0]['groups'][0]['items'][0]['sets'][0]['actual']>,
  ) {
    setDoc((d) => ({
      ...d,
      sections: d.sections.map((s, sIdx) =>
        sIdx !== si
          ? s
          : {
              ...s,
              groups: s.groups.map((g, gIdx) =>
                gIdx !== gi
                  ? g
                  : {
                      ...g,
                      items: g.items.map((it, iIdx) =>
                        iIdx !== ii
                          ? it
                          : {
                              ...it,
                              sets: it.sets.map((set, kIdx) =>
                                kIdx !== ki ? set : { ...set, actual: { ...set.actual, ...patch } },
                              ),
                            },
                      ),
                    },
              ),
            },
      ),
    }));
  }

  function addSet(si: number, gi: number, ii: number) {
    setDoc((d) => ({
      ...d,
      sections: d.sections.map((s, sIdx) =>
        sIdx !== si
          ? s
          : {
              ...s,
              groups: s.groups.map((g, gIdx) =>
                gIdx !== gi
                  ? g
                  : {
                      ...g,
                      items: g.items.map((it, iIdx) => {
                        if (iIdx !== ii) return it;
                        const prev = it.sets[it.sets.length - 1];
                        return {
                          ...it,
                          sets: [
                            ...it.sets,
                            {
                              planned: prev?.planned ?? null,
                              actual: {
                                weight: prev?.actual.weight,
                                reps: prev?.actual.reps,
                                completed: false,
                                prefilled: true,
                              },
                              notations: [],
                            },
                          ],
                        };
                      }),
                    },
              ),
            },
      ),
    }));
  }

  async function finish(next: 'done' | 'cancelled') {
    setStatus(next);
    stopwatch.pause();
    if (idRef.current) {
      await updateLog(idRef.current, {
        data: docRef.current,
        total_seconds: secondsRef.current,
        status: next,
        ended_at: new Date().toISOString(),
      });
    }
    window.location.href =
      next === 'done' && idRef.current ? `/app/session?id=${idRef.current}` : '/app';
  }

  if (!ready) return <div className="px-6 py-16 text-sm text-muted">Loading…</div>;

  const ordered = doc.sections
    .slice()
    .sort((a, b) => SECTIONS.indexOf(a.key) - SECTIONS.indexOf(b.key));

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 pb-32">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <div className="font-display text-5xl tabular-nums text-fg">{clock(stopwatch.seconds)}</div>
          <div className="text-[0.7rem] uppercase tracking-wider text-muted">
            {status}
            {saving ? ' · saving…' : ''}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => (stopwatch.running ? stopwatch.pause() : stopwatch.resume())}>
            {stopwatch.running ? 'Pause' : 'Resume'}
          </Button>
        </div>
      </header>

      {rest.running ? (
        <div className="mb-6 flex items-center justify-between border border-accent px-4 py-2">
          <span className="text-[0.7rem] uppercase tracking-wider text-accent">Rest</span>
          <span className="font-display text-2xl tabular-nums text-fg">{clock(rest.secondsLeft)}</span>
          <button onClick={rest.stop} className="text-[0.7rem] uppercase tracking-wider text-muted">
            Skip
          </button>
        </div>
      ) : null}

      {ordered.length === 0 ? (
        <p className="text-sm text-muted">Empty session.</p>
      ) : (
        ordered.map((section) => {
          const si = doc.sections.findIndex((s) => s.key === section.key);
          return (
            <section key={section.key} className="mb-8">
              <SectionHeader>{sectionLabel(section.key)}</SectionHeader>
              <div className="flex flex-col gap-4">
                {section.groups.map((group, gi) =>
                  group.items.map((item, ii) => (
                    <div key={item.id} className="border border-border p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="capitalize text-fg">{item.movement}</span>
                        <button
                          onClick={() => rest.start(item.restSeconds ?? TIMERS.defaultRestSeconds)}
                          className="text-[0.7rem] uppercase tracking-wider text-muted hover:text-fg"
                        >
                          Rest
                        </button>
                      </div>
                      <div className="flex flex-col gap-3">
                        {item.sets.map((set, ki) => (
                          <div
                            key={ki}
                            className={`flex flex-wrap items-center gap-3 border-l-2 pl-3 ${
                              set.actual.completed ? 'border-accent' : 'border-border'
                            }`}
                          >
                            {set.planned ? (
                              <span className="w-12 shrink-0 text-[0.7rem] uppercase tracking-wider text-muted">
                                {set.planned}
                              </span>
                            ) : null}
                            <WeightWheel
                              value={set.actual.weight ?? 0}
                              onChange={(v) => patchSet(si, gi, ii, ki, { weight: v })}
                            />
                            <RepsStepper
                              value={set.actual.reps ?? 0}
                              onChange={(v) => patchSet(si, gi, ii, ki, { reps: v })}
                            />
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() =>
                                  patchSet(si, gi, ii, ki, {
                                    rpe: Math.max(RPE.min, (set.actual.rpe ?? RPE.min) - RPE.step),
                                  })
                                }
                                className="flex h-9 w-9 items-center justify-center border border-border text-fg"
                                aria-label="Lower RPE"
                              >
                                −
                              </button>
                              <span className="w-12 text-center text-sm tabular-nums text-subtle">
                                @{set.actual.rpe ?? '—'}
                              </span>
                              <button
                                onClick={() =>
                                  patchSet(si, gi, ii, ki, {
                                    rpe: Math.min(RPE.max, (set.actual.rpe ?? RPE.min) + RPE.step),
                                  })
                                }
                                className="flex h-9 w-9 items-center justify-center border border-border text-fg"
                                aria-label="Raise RPE"
                              >
                                +
                              </button>
                            </div>
                            <button
                              onClick={() =>
                                patchSet(si, gi, ii, ki, { completed: !set.actual.completed })
                              }
                              className={`ml-auto flex h-11 w-11 items-center justify-center border ${
                                set.actual.completed
                                  ? 'border-accent bg-accent text-accent-fg'
                                  : 'border-border text-muted'
                              }`}
                              aria-label="Toggle completed"
                            >
                              ✓
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => addSet(si, gi, ii)}
                        className="mt-3 text-[0.7rem] uppercase tracking-wider text-muted hover:text-fg"
                      >
                        + Add set
                      </button>
                    </div>
                  )),
                )}
              </div>
            </section>
          );
        })
      )}

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
    </div>
  );
}
