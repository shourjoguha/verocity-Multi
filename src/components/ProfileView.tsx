import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { supabase, supabasePublic } from '@/lib/supabase';
import {
  getActivePlan,
  getAllLogs,
  getCurrentProfile,
  getRecentLogs,
} from '@/lib/queries';
import { getCached, setCached } from '@/lib/queryCache';
import { activeSessionOf } from '@/lib/activeSession';
import { currentStreak } from '@/lib/streak';
import type { Plan, PlanDay, Profile, WorkoutLog } from '@/lib/types';
import type { TimelinePoint } from '@/lib/timeline';
import { bestE1rm } from '@/lib/e1rm';
import { currentProgramWeek, planWeekCount } from '@/lib/progression';
import { completedLogs } from '@/lib/stats';
import { formatDuration, formatRound } from '@/lib/format';
import { buildTimeline, DAY_NAMES, dayNameFromLabel, typeFromLabel } from '@/lib/timeline';
import { Card, EmptyState, LoadingScreen, SectionHeader, StatCard } from '@/components/ui/primitives';
import { LogList } from '@/components/LogList';
import { EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';
import { DayPreviewDialog } from '@/components/DayPreviewDialog';
import { AddSessionMenu } from '@/components/AddSessionMenu';
import { LogQuickView } from '@/components/LogQuickView';
import { MonthCalendar } from '@/components/MonthCalendar';

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

// A collapsed day card shows its position, not its name: A, B, C… Past Z (no
// real plan gets there) it falls back to the 1-based index.
function dayBadge(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : String(i + 1);
}

// Edge-fade mask for the horizontal scroller, so the strip dissolves into the
// page instead of ending on a hard cut mid-history.
const edgeFade: CSSProperties = {
  WebkitMaskImage:
    'linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%)',
  maskImage:
    'linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%)',
};

// Activity strip: the whole logged history, scrollable, opening on today.
//
// Rest is a hairline baseline, a trained day's height is its duration, and
// multiple sessions stack within the day's single column so a day never changes
// the strip's pitch.
//
// Heights are relative to WHAT IS IN VIEW, not to an absolute ceiling. Against a
// fixed 2h maximum a stretch of 40-minute sessions renders as a row of identical
// stubs; re-normalising so the tallest bar on screen fills the strip means each
// screenful of history uses the full height and stays readable.
const STRIP_HEIGHT = 44;
const BAR_MIN = 8;
// Nominal reference only — a 2h session is full height at scale 1. Heights are
// deliberately NOT clamped to it: the view scale is what keeps bars inside the
// strip, so clamping here as well would flatten every session above two hours to
// an identical bar and hide exactly the differences this strip exists to show.
const BAR_NOMINAL_SECONDS = 7200;
const BAR_W = 8;
const BAR_GAP = 1;
// Quiet time before the strip re-normalises. Nothing runs during the gesture.
const SETTLE_MS = 120;
// Growth cap, so a screenful of 5-minute sessions doesn't read as a set of PRs.
// There is no floor: when a long session is on screen the scale goes below 1 and
// everything shrinks to fit, which is the honest reading.
const MAX_SCALE = 4;

function barHeight(p: TimelinePoint): number {
  if (p.state !== 'done') return 2;
  // Undated logs (total_seconds null) still deserve a mark, so a done day with
  // no duration falls back to the minimum bar.
  return Math.max(
    BAR_MIN,
    Math.round(BAR_MIN + (p.seconds / BAR_NOMINAL_SECONDS) * (STRIP_HEIGHT - BAR_MIN)),
  );
}

function ActivityStrip({ plan, logs }: { plan: Plan | null; logs: WorkoutLog[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [peekIndex, setPeekIndex] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  // Date at the left edge of what is on screen. Static "first logged day" text
  // read as if it labelled the view, and stopped being true the moment you
  // scrolled. Set from the same settle pass, so it costs no extra work.
  const [fromDate, setFromDate] = useState<string | null>(null);

  // buildTimeline always runs through today + 14 days of runway. Those future
  // days are blank by definition and add nothing here, so the strip ends on
  // today rather than changing what buildTimeline promises its other caller.
  const points = useMemo(() => {
    const all = buildTimeline(plan, logs);
    const todayIndex = all.findIndex((p) => p.isToday);
    return todayIndex >= 0 ? all.slice(0, todayIndex + 1) : all;
  }, [plan, logs]);

  // Open pinned to today. Layout effect so it is never painted at the left edge
  // — a visible jump from the oldest day to the newest on every mount.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [points.length]);

  // Re-normalise AFTER the scroll settles, never during it.
  //
  // docs/LESSONS.md § "Something repaints constantly while scrolling": a
  // per-frame scroll comparison produced 18 class flips in a one-second scroll.
  // So the listener is passive and does exactly one thing — reset a timer. The
  // visible range is arithmetic off scrollLeft (the pitch is uniform, so an
  // IntersectionObserver over hundreds of bars would be strictly more work), and
  // the 3% gate is the hysteresis that stops a one-bar nudge re-rendering.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let timer: number | undefined;

    const settle = () => {
      const pitch = BAR_W + BAR_GAP;
      const first = Math.max(0, Math.floor(el.scrollLeft / pitch));
      const last = Math.min(points.length - 1, Math.ceil((el.scrollLeft + el.clientWidth) / pitch));
      let tallest = 0;
      for (let i = first; i <= last; i++) {
        const p = points[i];
        if (p?.state === 'done') tallest = Math.max(tallest, barHeight(p));
      }
      const next = tallest > 0 ? Math.min(MAX_SCALE, STRIP_HEIGHT / tallest) : 1;
      setScale((cur) => (Math.abs(next - cur) / cur > 0.03 ? next : cur));
      setFromDate(points[first]?.date ?? null);
    };

    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, SETTLE_MS);
    };

    settle();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener('scroll', onScroll);
    };
  }, [points]);

  // Outside-tap dismiss for the peeked day.
  useEffect(() => {
    if (peekIndex === null) return;
    function onPointerDown(e: PointerEvent) {
      const root = containerRef.current;
      if (root && !root.contains(e.target as Node)) setPeekIndex(null);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [peekIndex]);

  const peeked = peekIndex === null ? null : points[peekIndex];

  return (
    <div ref={containerRef} className="relative">
      {/* The caption lives OUTSIDE the scroller. `overflow-x: auto` computes
          overflow-y to auto as well, so a popover anchored above a bar would be
          clipped by its own scroll container. */}
      <div className="t-label mb-2 flex justify-between gap-3 text-muted">
        <span>Activity</span>
        {peeked ? (
          <span className="truncate text-fg">
            {peeked.fullLabel} · {peeked.date}
          </span>
        ) : (
          <span>Scroll back</span>
        )}
      </div>
      <div
        ref={scrollRef}
        className="-mx-4 overflow-x-auto overscroll-x-contain px-4 sm:-mx-6 sm:px-6"
        style={edgeFade}
      >
        <div
          className="strip-row flex items-end"
          style={
            {
              height: STRIP_HEIGHT,
              gap: BAR_GAP,
              '--strip-scale': scale,
            } as CSSProperties
          }
        >
          {points.map((p, i) => {
            const totalSeconds = p.sessionSeconds.reduce((a, b) => a + b, 0);
            return (
              <button
                key={p.date}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPeekIndex((cur) => (cur === i ? null : i));
                }}
                onMouseEnter={() => setPeekIndex(i)}
                onMouseLeave={() => setPeekIndex((cur) => (cur === i ? null : cur))}
                // Today reads as a framed column whether or not it was trained.
                // The outline lives on the COLUMN, not the bar, so scaling the
                // bar never thickens the stroke.
                className={`relative flex h-full shrink-0 cursor-pointer flex-col justify-end ${
                  p.isToday ? 'shadow-[inset_0_0_0_1.5px_var(--color-fg)]' : ''
                }`}
                style={{ width: BAR_W }}
                aria-label={`${p.date} ${p.fullLabel}`}
                title={`${p.fullLabel} · ${p.date}`}
              >
                {p.state === 'done' ? (
                  <span className="strip-bar flex w-full flex-col" style={{ height: barHeight(p) }} aria-hidden>
                    {/* Sessions stack inside the ONE column, split by their share
                        of the day's minutes. */}
                    {p.sessions.map((colors, si) => (
                      <span
                        key={si}
                        className="flex w-full flex-col"
                        style={{
                          flex: totalSeconds > 0 ? `${p.sessionSeconds[si] || 0.0001} 1 0` : '1 1 0',
                        }}
                      >
                        {colors.map((c, ci) => (
                          <span key={ci} style={{ flex: 1, backgroundColor: c }} />
                        ))}
                      </span>
                    ))}
                  </span>
                ) : (
                  // Rest days are a hairline rule, NOT a bar — deliberately
                  // outside the scaled element so they never grow into blocks.
                  <span className="h-0.5 w-full bg-border" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="t-label mt-2 flex justify-between text-muted">
        <span>{fromDate ?? points[0]?.date ?? ''}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

// The plan's days as a fit-width accordion — the active day carries its full
// name, every other collapses to a letter, and the row is always exactly as
// wide as the plan card above it.
//
// The animation lives in .day-card (global.css): the cards share one flex
// free-space pool, so tweening flex-grow makes the collapsing card hand its
// width straight to the expanding one. Do not reach for max-width — see the
// comment on .day-card for what that looked like.
function DayAccordion({
  days,
  activeKey,
  todayDayName,
  onSelect,
  onPreview,
}: {
  days: PlanDay[];
  activeKey: string | null;
  todayDayName: string;
  onSelect: (dayKey: string) => void;
  onPreview: (day: PlanDay) => void;
}) {
  return (
    <div className="flex gap-px bg-border">
      {days.map((d, i) => {
        const isToday = dayNameFromLabel(d.label).toLowerCase() === todayDayName.toLowerCase();
        const isActive = d.dayKey === activeKey;
        return (
          <button
            key={d.dayKey}
            type="button"
            aria-label={`${d.label}${isToday ? ' (today)' : ''}`}
            aria-pressed={isActive}
            data-active={isActive}
            onClick={() => (isActive ? onPreview(d) : onSelect(d.dayKey))}
            className={`day-card relative h-16 overflow-hidden text-left ${
              isActive ? 'bg-fg text-bg' : 'bg-surface text-fg hover:bg-elevated'
            }`}
          >
            {/* Both faces are absolute, so only the BOX width animates — the
                label never reflows or ellipsises mid-tween. */}
            <span className="day-card-face day-card-badge grid place-items-center">
              {isToday ? (
                <span
                  aria-hidden
                  className="absolute left-1/2 top-2 inline-block h-1.5 w-1.5 -translate-x-1/2 bg-teal"
                />
              ) : null}
              <span aria-hidden className="font-display text-xs font-semibold tracking-[-0.02em]">
                {dayBadge(i)}
              </span>
            </span>
            <span className="day-card-face day-card-detail flex flex-col justify-center gap-0.5 whitespace-nowrap px-3.5">
              <span aria-hidden className="t-label flex items-center gap-1.5 opacity-60">
                {isToday ? <span className="inline-block h-1.5 w-1.5 shrink-0 bg-teal" /> : null}
                {dayNameFromLabel(d.label).slice(0, 3) || `Day ${i + 1}`}
              </span>
              <span
                aria-hidden
                className="font-display text-[0.8125rem] font-semibold tracking-[-0.02em]"
              >
                {typeFromLabel(d.label)}
              </span>
              <span aria-hidden className="t-label opacity-60">
                {d.exercises.length} {d.exercises.length === 1 ? 'movement' : 'movements'}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function ProfileView({ mode }: { mode: 'app' | 'showcase' }) {
  const client = mode === 'showcase' ? supabasePublic : supabase;

  // Seed from the SWR cache (app mode only) so revisiting Home paints instantly
  // while the effect below revalidates in the background.
  const seeded = mode === 'app' ? getCached<Profile>('profile') : undefined;
  const [loading, setLoading] = useState(seeded === undefined);
  const [profile, setProfile] = useState<Profile | null>(seeded ?? null);
  const [plan, setPlan] = useState<Plan | null>(
    mode === 'app' ? (getCached<Plan>('plan:active') ?? null) : null,
  );
  const [logs, setLogs] = useState<WorkoutLog[]>(
    mode === 'app' ? (getCached<WorkoutLog[]>('logs:recent30') ?? []) : [],
  );
  const [allLogs, setAllLogs] = useState<WorkoutLog[]>(
    mode === 'app' ? (getCached<WorkoutLog[]>('logs:all') ?? []) : [],
  );
  const [addOpen, setAddOpen] = useState(false);
  // Pre-filled date when Add is opened from a specific calendar cell.
  const [addDate, setAddDate] = useState<string | null>(null);
  const [previewDay, setPreviewDay] = useState<PlanDay | null>(null);
  // Which day in the rail is expanded. null = "not chosen yet", which resolves
  // to today (or the first day) below — deliberately derived rather than set in
  // an effect, because the plan arrives async and an effect-set default would
  // paint the wrong card expanded for one frame.
  const [activeDayKey, setActiveDayKey] = useState<string | null>(null);
  const [quickLog, setQuickLog] = useState<WorkoutLog | null>(null);
  const [failed, setFailed] = useState(false);
  // Bumped by the retry button to re-run the loader below.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
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
        if (mode === 'app') {
          setCached('profile', p);
          setCached('plan:active', pl);
          setCached('logs:recent30', lg);
          setCached('logs:all', all);
        }
        setProfile(p);
        setPlan(pl);
        setLogs(lg);
        setAllLogs(all);
        setFailed(false);
      } catch {
        // Without this the rejection escaped the async IIFE unhandled and none
        // of the setters ran — so a revisit seeded from the cache sat on stale
        // numbers forever, with no spinner and no error. Silent staleness is
        // exactly what "the stats are stuck" looked like.
        if (active) setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [mode, reloadKey]);

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
          getRecentLogs(30).then((l) => {
            setCached('logs:recent30', l);
            setLogs(l);
          });
          getAllLogs().then((l) => {
            setCached('logs:all', l);
            setAllLogs(l);
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [mode, profile]);

  // The headline tiles read the FULL history, not the recent-30 window that
  // feeds "Recent sessions" below. Off that window "Sessions" was pinned at 30
  // once you had 30 logs, total time was a sliding sum that could fall after a
  // workout, and a PR dropped out of Top e1RM as soon as 30 newer sessions
  // existed. Memoised because topE1rm walks every set in every log, and this
  // component re-renders whenever a sheet opens. Must sit above the early
  // returns below — hooks cannot run conditionally.
  const done = useMemo(() => completedLogs(allLogs), [allLogs]);

  if (loading) {
    return <LoadingScreen />;
  }

  if (mode === 'showcase' && !profile) {
    return (
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-16">
        <EmptyState>No showcase profile is configured yet.</EmptyState>
      </div>
    );
  }

  // An edit from LogQuickView has to land in BOTH arrays and BOTH cache entries.
  // The tiles read `allLogs`, so touching only `logs` left them showing the
  // pre-edit value; and a ClientRouter return to /app re-seeds from the module
  // cache, which would repaint the old row over a correct on-screen one.
  const applyLogChange = (fn: (ls: WorkoutLog[]) => WorkoutLog[]) => {
    const nextRecent = fn(logs);
    const nextAll = fn(allLogs);
    setLogs(nextRecent);
    setAllLogs(nextAll);
    setCached('logs:recent30', nextRecent);
    setCached('logs:all', nextAll);
  };

  const sessionCount = done.length;
  const totalSeconds = done.reduce((acc, l) => acc + (l.total_seconds ?? 0), 0);
  const top = topE1rm(done);
  const streak = currentStreak(allLogs);
  const week = plan ? currentProgramWeek(plan.id, allLogs, planWeekCount(plan.parsed)) : null;
  const todayDayName = DAY_NAMES[new Date().getDay()];

  const days = plan?.parsed.days ?? [];
  const activeKey =
    activeDayKey ??
    days.find((d) => dayNameFromLabel(d.label).toLowerCase() === todayDayName.toLowerCase())
      ?.dayKey ??
    days[0]?.dayKey ??
    null;
  // The primary CTA starts the day the accordion is showing, so it has to
  // resolve from the same derived key rather than from `activeDayKey` alone.
  const activeDay = days.find((d) => d.dayKey === activeKey) ?? null;

  // …unless a workout is still running, in which case the CTA belongs to THAT
  // session, not to whichever day card is expanded — you can leave the Logger
  // by its Home button and browse, and this is the way back in. The day cards
  // stay freely browsable; the button keeps naming what is actually live.
  // Free: `allLogs` is already loaded and includes in-progress rows.
  const running = mode === 'app' ? activeSessionOf(allLogs) : null;
  const runningDay = running?.day_key
    ? (days.find((d) => d.dayKey === running.day_key) ?? null)
    : null;
  const resumeLabel = runningDay ? `Resume ${typeFromLabel(runningDay.label)}` : 'Resume workout';
  const resumeHref = running ? `/app/log?logId=${running.id}` : null;
  // Dark teal + a sweeping sheen: the one filled, chromatic treatment in the
  // app, so a session left running is impossible to walk past. See
  // .shimmer-resume in global.css.
  const resumeClass = 'bg-teal-deep text-teal-fg shimmer-resume';

  return (
    <>
    <PageStagger className="mx-auto max-w-3xl px-4 sm:px-6 py-8">
      <Item>
        {/* The date, the program week and the streak are meta ABOUT the name —
            they used to be three separate bands (an eyebrow, a line under the
            stat tiles, and a line above the ribbon) saying so at three
            different points down the page. */}
        <header className="mb-6">
          <div className="t-eyebrow flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
            <span>{mode === 'showcase' ? 'Showcase' : new Date().toDateString()}</span>
            {mode === 'app' && week ? (
              <>
                <span aria-hidden>·</span>
                <span>Week {week}</span>
              </>
            ) : null}
            {mode === 'app' && streak >= 2 ? (
              <>
                <span aria-hidden>·</span>
                <span className="flex items-center gap-1.5 text-teal">
                  <span aria-hidden className="inline-block h-1.5 w-1.5 bg-teal" />
                  {streak}-day streak
                </span>
              </>
            ) : null}
          </div>
          <div className="mt-2">
            <EchoText
              text={profile?.display_name ?? 'Athlete'}
              as="h1"
              className="font-display text-2xl font-bold uppercase leading-[0.9] tracking-[-0.04em] text-fg sm:text-4xl md:text-6xl"
            />
          </div>
        </header>
      </Item>

      {failed ? (
        <Item>
          {/* Say so, rather than leaving last-known numbers on screen looking
              current. Everything below this is whatever the cache still holds. */}
          <div className="mb-6 flex items-center justify-between gap-3 border border-border bg-surface px-4 py-3">
            <span className="text-sm text-muted">Couldn't refresh — showing the last known numbers.</span>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="hill-btn shrink-0 border border-border bg-surface px-3 py-1.5 t-control text-fg transition-colors hover:border-fg"
            >
              Retry
            </button>
          </div>
        </Item>
      ) : null}

      {/* The hero: the plan, the day you are about to do, and the button that
          starts it — one bordered, lifted object, internally divided by the
          same gap-px hairlines the stat grid uses. It replaces three separate
          bands (the twin action buttons, the "Active plan" card, and a day rail
          that scrolled off the right edge with no visual tie to the card above
          it). Rows inside a hairline-divider container stay flat; the depth
          belongs to the unit, not its parts. */}
      {mode === 'app' ? (
        <Item>
          <section className="mb-8">
            <SectionHeader>Active plan</SectionHeader>
            {plan ? (
              <>
                <div className="lift flex flex-col gap-px border border-border bg-border">
                  <div className="flex items-center justify-between gap-3 bg-surface p-4">
                    <div className="min-w-0">
                      {/* Wraps rather than truncates: "Endurance & Cut Block"
                          lost half its name to an ellipsis once the View link
                          claimed its 44px target. */}
                      <div className="font-display text-xl font-semibold leading-tight tracking-tight text-fg">
                        {plan.name}
                      </div>
                      {week ? <div className="t-label mt-1 text-muted">Week {week}</div> : null}
                    </div>
                    {/* The glyph stays small; the TARGET may not — inline-flex
                        + min-h-11 gives it the 44px box without changing how it
                        reads. A bare text link measured 12px tall here. */}
                    <a
                      href="/app/plan"
                      className="t-eyebrow -my-2 inline-flex min-h-11 shrink-0 items-center text-muted transition-colors hover:text-fg"
                    >
                      View →
                    </a>
                  </div>

                  {days.length > 0 ? (
                    <DayAccordion
                      days={days}
                      activeKey={activeKey}
                      todayDayName={todayDayName}
                      onSelect={setActiveDayKey}
                      onPreview={setPreviewDay}
                    />
                  ) : null}

                  {/* Flat, not pillowed. `.hill-btn-flush` carries a 4px radius
                      and an inset dark edge, which inside a hairline-divider
                      container reads as a rounded pill floating ON the card
                      rather than a segment OF it — the same reason rows in a
                      gap-px grid never take .lift. The unit owns the depth. */}
                  <div className="flex gap-px bg-border">
                    <a
                      href={
                        resumeHref ??
                        (activeDay ? `/app/log?day=${encodeURIComponent(activeDay.dayKey)}` : '/app/log')
                      }
                      className={`flex min-h-13 flex-1 items-center justify-center overflow-hidden px-4 transition-colors ${
                        resumeHref ? resumeClass : 'bg-fg text-bg hover:bg-fg/85'
                      }`}
                    >
                      {/* Above the sheen, which is an ::after on the anchor. */}
                      <span className="t-control relative truncate">
                        {resumeHref
                          ? resumeLabel
                          : activeDay
                            ? `Start ${typeFromLabel(activeDay.label)}`
                            : 'Start workout'}
                      </span>
                    </a>
                    {/* The chooser is the only route to minis, saved sessions,
                        past-plan days, a blank workout and Log activity — it
                        cannot disappear just because the day cards took over
                        the common case. */}
                    <button
                      type="button"
                      onClick={() => setAddOpen(true)}
                      aria-label="Other ways to start a session"
                      className="flex min-h-13 w-14 items-center justify-center bg-surface text-muted transition-colors hover:bg-elevated hover:text-fg"
                    >
                      <span aria-hidden className="text-base leading-none">⋯</span>
                    </button>
                  </div>
                </div>
                <div className="flex justify-end">
                  <a
                    href="/app/coach"
                    className="t-control -mr-2 inline-flex min-h-11 items-center px-2 text-muted transition-colors hover:text-fg"
                  >
                    Coach →
                  </a>
                </div>
              </>
            ) : (
              <>
                <EmptyState>No active plan.</EmptyState>
                {/* Above the pair, not instead of one of them: with no plan
                    this row is the ONLY route to the chooser, so replacing
                    "Start workout" would leave a live session as the single
                    thing you could do. */}
                {resumeHref ? (
                  <a
                    href={resumeHref}
                    className={`hill-btn mt-3 flex min-h-12 items-center justify-center overflow-hidden px-4 text-sm uppercase tracking-wider transition-colors ${resumeClass}`}
                  >
                    <span className="relative">{resumeLabel}</span>
                  </a>
                ) : null}
                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setAddOpen(true)}
                    className="hill-btn inline-flex min-h-12 flex-1 items-center justify-center bg-fg px-4 text-sm uppercase tracking-wider text-bg transition-colors hover:bg-fg/85"
                  >
                    Start workout
                  </button>
                  <a
                    href="/app/coach"
                    className="hill-btn inline-flex min-h-12 flex-1 items-center justify-center border border-border bg-surface px-4 text-sm uppercase tracking-wider text-fg transition-colors hover:border-fg"
                  >
                    Coach
                  </a>
                </div>
              </>
            )}
          </section>
        </Item>
      ) : null}

      <Item>
        <section className="mb-6 grid grid-cols-3 gap-px bg-border">
          <StatCard label="Sessions" value={sessionCount} />
          <StatCard label="Total time" value={formatDuration(totalSeconds)} />
          <StatCard
            label="Top e1RM"
            value={top != null ? formatRound(top) : '—'}
            unit={top != null ? 'kg' : undefined}
          />
        </section>
      </Item>

      {mode === 'app' ? (
        <Item>
          <section className="mb-6">
            <ActivityStrip plan={plan} logs={allLogs} />
          </section>
        </Item>
      ) : null}

      {mode === 'showcase' ? (
        <Item>
          <section className="mb-6">
            <SectionHeader>Active plan</SectionHeader>
            {plan ? (
              <Card>
                <div className="font-display text-xl font-semibold tracking-tight text-fg">
                  {plan.name}
                </div>
                {week ? <div className="mt-0.5 text-sm text-muted">Week {week}</div> : null}
              </Card>
            ) : (
              <EmptyState>No active plan.</EmptyState>
            )}
          </section>
        </Item>
      ) : null}

      {mode === 'app' ? (
        <Item>
          <section className="mb-8">
            <MonthCalendar
              logs={allLogs}
              onDayClick={(date, sessions) => {
                if (sessions.length > 0) setQuickLog(sessions[0]);
                else {
                  setAddDate(date);
                  setAddOpen(true);
                }
              }}
              onSelectLog={setQuickLog}
            />
          </section>
        </Item>
      ) : null}

      <Item>
        <section>
          <SectionHeader>Recent sessions</SectionHeader>
          {logs.length === 0 ? (
            <EmptyState>No sessions logged yet.</EmptyState>
          ) : (
            <LogList logs={logs.slice(0, 12)} onSelect={mode === 'app' ? setQuickLog : undefined} />
          )}
        </section>
      </Item>

    </PageStagger>

      {mode === 'app' ? (
        <>
          <AddSessionMenu
            plan={plan}
            date={addDate ?? undefined}
            open={addOpen}
            onClose={() => {
              setAddOpen(false);
              setAddDate(null);
            }}
          />
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
              applyLogChange((ls) => ls.map((l) => (l.id === updated.id ? updated : l)));
              setQuickLog(updated);
            }}
            onDeleted={(id) => applyLogChange((ls) => ls.filter((l) => l.id !== id))}
          />
        </>
      ) : null}
    </>
  );
}
