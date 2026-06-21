import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { supabase, supabasePublic } from '@/lib/supabase';
import {
  getActivePlan,
  getAllLogs,
  getCurrentProfile,
  getRecentLogs,
} from '@/lib/queries';
import { signOut } from '@/lib/auth';
import { currentStreak } from '@/lib/streak';
import type { Plan, PlanDay, Profile, WorkoutLog } from '@/lib/types';
import { bestE1rm } from '@/lib/e1rm';
import { weekFromDate } from '@/lib/week';
import { formatDate, formatDuration, formatRound } from '@/lib/format';
import { tagColor } from '@/lib/tags';
import { buildTimeline, DAY_NAMES, dayNameFromLabel, typeFromLabel } from '@/lib/timeline';
import { Card, EmptyState, LoadingScreen, SectionHeader, StatCard, Tag } from '@/components/ui/primitives';
import { SetShapeStrip } from '@/components/SetShapeStrip';
import { EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';
import { DayPreviewDialog } from '@/components/DayPreviewDialog';
import { AddSessionMenu } from '@/components/AddSessionMenu';
import { LogQuickView } from '@/components/LogQuickView';

function topE1rm(logs: WorkoutLog[]): number | null {
  let best: number | null = null;
  for (const log of logs) {
    const sets = (log.data?.sections ?? []).flatMap((s) =>
      s.groups.flatMap((g) => g.items.flatMap((i) => i.sets)),
    );
    const est = bestE1rm(sets.map((s) => ({ weight: s.actual.weight, reps: s.actual.reps })));
    if (est != null && (best == null || est > best)) best = est;
  }
  return best;
}

// Edge-fade mask for the horizontal scrollers (ribbon + day rail).
const edgeFade: CSSProperties = {
  WebkitMaskImage:
    'linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%)',
  maskImage:
    'linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%)',
};

// Ribbon sizing: thin day-bars, ~36 visible at once; the rest scroll.
const VISIBLE_BARS = 36;
const BAR_GAP = 2;
const BAR_HEIGHT = 40;

function ProgressTimeline({ plan, logs }: { plan: Plan | null; logs: WorkoutLog[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const points = useMemo(() => buildTimeline(plan, logs), [plan, logs]);
  const todayIndex = points.findIndex((p) => p.isToday);
  const anchorIndex = useMemo(() => {
    for (let i = points.length - 1; i >= 0; i--) if (points[i].state === 'done') return i;
    return todayIndex;
  }, [points, todayIndex]);
  const [peekIndex, setPeekIndex] = useState<number | null>(null);
  const [barW, setBarW] = useState(16);

  // Size each bar so ~VISIBLE_BARS fit the visible width, recomputing on resize.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setBarW(Math.max(6, Math.round(el.clientWidth / VISIBLE_BARS) - BAR_GAP));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Right-align the scroll on the most recent logged day (or today) so upcoming peeks in.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || anchorIndex < 0) return;
    const pitch = barW + BAR_GAP;
    el.scrollTo({ left: Math.max(0, anchorIndex * pitch - el.clientWidth * 0.8), behavior: 'auto' });
  }, [anchorIndex, barW]);

  // Outside-tap dismiss for the peek popover.
  useEffect(() => {
    if (peekIndex === null) return;
    function onPointerDown(e: PointerEvent) {
      const root = containerRef.current;
      if (root && !root.contains(e.target as Node)) setPeekIndex(null);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [peekIndex]);

  return (
    <div ref={containerRef} className="relative border-b border-border pb-3">
      <div className="mb-2 text-[0.6rem] uppercase tracking-[0.16em] text-muted">Plan progress</div>
      <div ref={scrollRef} className="-mx-6 overflow-x-auto px-6" style={edgeFade}>
        <div className="relative flex items-end" style={{ gap: `${BAR_GAP}px`, minHeight: BAR_HEIGHT }}>
          {points.map((p, i) => {
            const barStyle: CSSProperties = { width: barW, height: BAR_HEIGHT };
            if (p.state === 'done') {
              barStyle.backgroundColor = p.color;
            } else if (p.state === 'planned') {
              barStyle.border = `1px solid color-mix(in srgb, ${p.color} 55%, transparent)`;
              barStyle.backgroundColor = `color-mix(in srgb, ${p.color} 12%, transparent)`;
            } else {
              barStyle.backgroundImage =
                'repeating-linear-gradient(45deg, color-mix(in srgb, var(--color-muted) 40%, transparent) 0, color-mix(in srgb, var(--color-muted) 40%, transparent) 1.5px, transparent 1.5px, transparent 4px)';
              barStyle.backgroundColor = 'color-mix(in srgb, var(--color-muted) 22%, transparent)';
            }
            if (p.isToday) {
              barStyle.boxShadow = 'inset 0 0 0 2px var(--color-fg)';
            }
            return (
              <button
                key={p.date + i}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPeekIndex((cur) => (cur === i ? null : i));
                }}
                onMouseEnter={() => setPeekIndex(i)}
                onMouseLeave={() => setPeekIndex((cur) => (cur === i ? null : cur))}
                className="relative flex shrink-0 cursor-pointer items-end justify-center"
                aria-label={`${p.date} ${p.fullLabel}`}
                title={`${p.fullLabel} · ${p.date}`}
              >
                <span className="block" style={barStyle} aria-hidden />
                {peekIndex === i && (
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 flex -translate-x-1/2 flex-col items-center gap-0.5 whitespace-nowrap bg-fg px-2 py-1 text-[0.6rem] uppercase tracking-[0.12em] text-bg">
                    <span>{p.fullLabel}</span>
                    <span className="text-[0.55rem] normal-case tracking-normal text-bg/60">{p.date}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function ProfileView({ mode }: { mode: 'app' | 'showcase' }) {
  const client = mode === 'showcase' ? supabasePublic : supabase;
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [allLogs, setAllLogs] = useState<WorkoutLog[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [previewDay, setPreviewDay] = useState<PlanDay | null>(null);
  const [quickLog, setQuickLog] = useState<WorkoutLog | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (mode === 'app') {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          window.location.href = '/login';
          return;
        }
      }
      const [p, pl, lg, all] = await Promise.all([
        getCurrentProfile(client),
        getActivePlan(client),
        getRecentLogs(30, client),
        getAllLogs(client),
      ]);
      if (!active) return;
      setProfile(p);
      setPlan(pl);
      setLogs(lg);
      setAllLogs(all);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [mode]);

  // Live-refresh recents when this user's logs change (e.g. finishing a session
  // on another device/tab). App mode only; the showcase is read-only.
  useEffect(() => {
    if (mode !== 'app' || !profile) return;
    const channel = supabase
      .channel(`home-logs-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workout_logs',
          filter: `owner_user_id=eq.${profile.id}`,
        },
        () => {
          getRecentLogs(30).then(setLogs);
          getAllLogs().then(setAllLogs);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [mode, profile]);

  if (loading) {
    return <LoadingScreen />;
  }

  if (mode === 'showcase' && !profile) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <EmptyState>No showcase profile is configured yet.</EmptyState>
      </div>
    );
  }

  const sessionCount = logs.length;
  const totalSeconds = logs.reduce((acc, l) => acc + (l.total_seconds ?? 0), 0);
  const top = topE1rm(logs);
  const streak = currentStreak(allLogs);
  const week = plan ? weekFromDate(plan.start_date, new Date()) : null;
  const todayDayName = DAY_NAMES[new Date().getDay()];

  return (
    <>
    <PageStagger className="mx-auto max-w-3xl px-6 py-10">
      <Item>
        <header className="mb-10">
          <p className="text-[0.7rem] uppercase tracking-[0.35em] text-muted">
            {mode === 'showcase' ? 'Showcase' : 'Dashboard'}
          </p>
          <div className="mt-2 flex items-end justify-between gap-4">
            <EchoText
              text={profile?.display_name ?? 'Athlete'}
              as="h1"
              className="font-display text-5xl font-bold uppercase leading-[0.9] tracking-[-0.04em] text-fg md:text-7xl"
            />
            {mode === 'app' ? (
              <button
                onClick={() => signOut().then(() => (window.location.href = '/login'))}
                className="shrink-0 pb-1 text-[0.7rem] uppercase tracking-wider text-muted transition-colors hover:text-fg"
              >
                Sign out
              </button>
            ) : null}
          </div>
        </header>
      </Item>

      <Item>
        <section className="mb-10 grid grid-cols-3 gap-px bg-border">
          <StatCard label="Sessions" value={sessionCount} />
          <StatCard label="Total time" value={formatDuration(totalSeconds)} />
          <StatCard
            label="Top e1RM"
            value={top != null ? formatRound(top) : '—'}
            unit={top != null ? 'kg' : undefined}
          />
        </section>
      </Item>

      {mode === 'app' && streak >= 2 ? (
        <Item>
          <div className="mb-10 -mt-6 flex items-center gap-2 text-[0.65rem] uppercase tracking-[0.2em] text-teal">
            <span aria-hidden className="inline-block h-1.5 w-1.5 bg-teal" />
            {streak}-day streak
          </div>
        </Item>
      ) : null}

      {mode === 'app' ? (
        <Item>
          <section className="mb-10 flex gap-3">
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="hill-btn inline-flex min-h-12 flex-1 items-center justify-center bg-fg px-4 text-sm uppercase tracking-wider text-bg transition-colors hover:bg-fg/85"
            >
              Start workout
            </button>
            <a
              href="/app/activity"
              className="hill-btn inline-flex min-h-12 flex-1 items-center justify-center border border-border bg-surface px-4 text-sm uppercase tracking-wider text-fg transition-colors hover:border-fg"
            >
              Log activity
            </a>
          </section>
        </Item>
      ) : null}

      {mode === 'app' ? (
        <Item>
          <section className="mb-10">
            <div className="mb-4 text-[0.7rem] uppercase tracking-[0.18em] text-muted">
              {new Date().toDateString()}
              {week ? ` · Week ${week}` : ''}
            </div>
            <ProgressTimeline plan={plan} logs={allLogs} />
          </section>
        </Item>
      ) : null}

      {mode === 'app' && plan && plan.parsed.days.length > 0 ? (
        <Item>
          <section className="mb-10">
            <div className="mb-3 flex items-baseline justify-between">
              <div className="text-[0.65rem] uppercase tracking-[0.16em] text-muted">Pick a day</div>
              <a
                href="/app/plan"
                className="text-[0.65rem] uppercase tracking-[0.14em] text-muted transition-colors hover:text-fg"
              >
                Plan overview →
              </a>
            </div>
            <div className="-mx-6 overflow-x-auto px-6" style={edgeFade}>
              <div className="flex gap-2 pb-2">
                {plan.parsed.days.map((d) => {
                  const isToday = dayNameFromLabel(d.label).toLowerCase() === todayDayName.toLowerCase();
                  return (
                    <button
                      key={d.dayKey}
                      type="button"
                      onClick={() => setPreviewDay(d)}
                      className={`min-w-[140px] shrink-0 border p-3 text-left transition-colors ${
                        isToday ? 'border-fg bg-fg text-bg' : 'border-border hover:bg-elevated'
                      }`}
                    >
                      <div className="truncate font-display text-base tracking-[-0.04em]">
                        {typeFromLabel(d.label)}
                      </div>
                      <div
                        className={`mt-1 text-[0.6rem] uppercase tracking-[0.14em] ${
                          isToday ? 'text-bg/70' : 'text-muted'
                        }`}
                        aria-hidden
                      >
                        {isToday ? 'today' : ' '}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        </Item>
      ) : null}

      <Item>
        <section className="mb-10">
          <SectionHeader>Active plan</SectionHeader>
          {plan ? (
            <Card>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-display text-xl font-semibold tracking-tight text-fg">{plan.name}</div>
                  {week ? <div className="mt-0.5 text-sm text-muted">Week {week}</div> : null}
                </div>
                {mode === 'app' ? (
                  <a
                    href="/app/plan"
                    className="text-[0.7rem] uppercase tracking-wider text-muted transition-colors hover:text-fg"
                  >
                    View →
                  </a>
                ) : null}
              </div>
            </Card>
          ) : (
            <EmptyState>No active plan.</EmptyState>
          )}
        </section>
      </Item>

      <Item>
        <section>
          <SectionHeader>Recent sessions</SectionHeader>
          {logs.length === 0 ? (
            <EmptyState>No sessions logged yet.</EmptyState>
          ) : (
            <ul className="lift border border-border bg-surface">
              {logs.slice(0, 12).map((log) => {
                const accent = log.tags[0] ? tagColor(log.tags[0]) : 'transparent';
                const inner = (
                  <>
                    <div className="w-16 shrink-0">
                      <div className="text-sm tabular-nums text-subtle">{formatDate(log.log_date)}</div>
                      {log.total_seconds ? (
                        <div className="text-[0.7rem] tabular-nums text-muted">
                          {formatDuration(log.total_seconds)}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-1 flex-wrap gap-1">
                      {log.tags.length > 0 ? (
                        log.tags.map((t) => <Tag key={t} label={t} color={tagColor(t)} />)
                      ) : (
                        <span className="text-sm text-muted">{log.activity_type ?? 'Session'}</span>
                      )}
                    </div>
                    <SetShapeStrip data={log.data} className="shrink-0" />
                  </>
                );
                return (
                  <li key={log.id} className="border-b border-border last:border-b-0">
                    {mode === 'app' ? (
                      <button
                        type="button"
                        onClick={() => setQuickLog(log)}
                        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-elevated"
                        style={{ boxShadow: `inset 3px 0 0 ${accent}` }}
                      >
                        {inner}
                      </button>
                    ) : (
                      <div
                        className="flex items-center gap-4 px-4 py-3"
                        style={{ boxShadow: `inset 3px 0 0 ${accent}` }}
                      >
                        {inner}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </Item>

    </PageStagger>

      {mode === 'app' ? (
        <>
          <AddSessionMenu plan={plan} open={addOpen} onClose={() => setAddOpen(false)} />
          <DayPreviewDialog
            day={previewDay}
            week={week ?? 1}
            open={previewDay !== null}
            onClose={() => setPreviewDay(null)}
          />
          <LogQuickView
            log={quickLog}
            open={quickLog !== null}
            onClose={() => setQuickLog(null)}
            onUpdated={(updated) => {
              setLogs((ls) => ls.map((l) => (l.id === updated.id ? updated : l)));
              setQuickLog(updated);
            }}
            onDeleted={(id) => setLogs((ls) => ls.filter((l) => l.id !== id))}
          />
        </>
      ) : null}
    </>
  );
}
