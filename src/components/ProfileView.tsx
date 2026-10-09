import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { supabase, supabasePublic } from '@/lib/supabase';
import {
  getActivePlan,
  getAllLogs,
  getCurrentProfile,
  getMealLogsInRange,
  getMealPresets,
  getRecentLogs,
  getRecommendations,
} from '@/lib/queries';
import { getCached, setCached } from '@/lib/queryCache';
import { invalidateLogs, loadAllLogs, newestLogs } from '@/lib/logStore';
import { todayLocal } from '@/lib/mealPhoto';
import { draftFor, type MealDraft, type MealOpener } from '@/lib/mealDraft';
import type { MealLog, MealPreset } from '@/lib/types';
import { MealChipRail } from '@/components/meals/MealChipRail';
import { TodaysMeals } from '@/components/meals/TodaysMeals';
import { MealDrawer } from '@/components/meals/MealDrawer';
import { SavedMealsSheet } from '@/components/meals/SavedMealsSheet';
import { activeSessionOf } from '@/lib/activeSession';
import { currentWeekStreak } from '@/lib/streak';
import type { Plan, PlanDay, Profile, WorkoutLog } from '@/lib/types';
import { bestE1rm } from '@/lib/e1rm';
import { currentProgramWeek, planWeekCount } from '@/lib/progression';
import { completedLogs } from '@/lib/stats';
import { formatDuration, formatRound } from '@/lib/format';
import { buildTimeline, DAY_NAMES, dayNameFromLabel, typeFromLabel, ymd } from '@/lib/timeline';
import { toWeeks, windowPoints } from '@/lib/activityWindow';
import {
  Card,
  EmptyState,
  LoadingScreen,
  SectionHeader,
  TickProgress,
} from '@/components/ui/primitives';
import { LogList } from '@/components/LogList';
import { SessionShapeLegend } from '@/components/SessionShape';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';
import { DayPreviewDialog } from '@/components/DayPreviewDialog';
import { AddSessionMenu } from '@/components/AddSessionMenu';
import { LogQuickView } from '@/components/LogQuickView';
import { MonthCalendar } from '@/components/MonthCalendar';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { displayNameFor, hrefFor, isReadOnly, type Surface } from '@/lib/surface';
import { READ_ONLY_NOTICE, readOnlyProps } from '@/components/ui/ReadOnly';
import { toast } from '@/lib/toast';
import { CoachRunner } from '@/components/CoachRunner';
import { coachSignal, getCoachSeenAt } from '@/lib/coachSignal';

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

// Activity: a chosen window of history, the hours trained in it, and a strip
// of bars drawn to fit the width — one headline, one visual.
//
// The window is picked from a hidden native <select> laid over the range label
// ("Last 4 weeks"): no chevron, no underline, and on iOS the platform's own
// scroll-wheel picker. The headline and the session count are summed from the
// SAME window the bars show, so the number always describes the chart under it.
// (The strip used to scroll through the whole history beside all-time totals,
// and the totals read as a caption for whatever happened to be on screen.)
// All-time totals and the top e1RM are one muted line under the strip.
//
// Up to DAILY_MAX_DAYS the strip is one column per day; past that a day column
// would be under ~2px, so it switches to one column per 7-day bucket, coloured
// by that week's dominant tag. Columns share the width equally, so the strip
// never scrolls, and heights are relative to the tallest column IN THE WINDOW
// (linear, no upstream ceiling — see docs/LESSONS.md § "A chart normalised to
// what is on screen still renders flat").
//
// Within a day column: rest is a hairline, a session's height is its duration,
// and a day with MORE than one session splits the column into adjacent bars,
// each at its own height, marked as one day by a PEDESTAL — a solid
// `--color-fg` foot in a reserved lane below the baseline. A frame around the
// cluster was tried first and did not read (the today column is already a
// framed box), and the gap between days is wider than the seam inside a day so
// proximity carries most of the grouping.
const ACTIVITY_WINDOWS = [
  { key: '2w', label: 'Last 2 weeks', days: 14 },
  { key: '4w', label: 'Last 4 weeks', days: 28 },
  { key: '8w', label: 'Last 8 weeks', days: 56 },
  { key: '12w', label: 'Last 12 weeks', days: 84 },
  { key: '6m', label: 'Last 6 months', days: 182 },
  { key: 'all', label: 'All time', days: null },
] as const;
type ActivityWindowKey = (typeof ACTIVITY_WINDOWS)[number]['key'];
const DEFAULT_WINDOW: ActivityWindowKey = '4w';
const WINDOW_STORAGE_KEY = 'verocity:activity-window';
// Widest window drawn a column per day: 84 columns are ~3px at 375px.
const DAILY_MAX_DAYS = 84;
const STRIP_HEIGHT = 44;
// Undated logs (total_seconds null → 0) still deserve a mark.
const BAR_MIN = 8;
// Inside a multi-session day. This is a seam, not a gap: it keeps two bars of
// the same tone from merging, and must stay under the gap between days.
const SUB_GAP = 1;
// The pedestal lane, reserved below the baseline on EVERY column so a group
// never shifts its neighbours' bars. Only multi-session days paint into it.
const FOOT_H = 2.5;
const FOOT_LANE = 4;

// Gap between columns: 3px while columns are wide, tightening as the window
// grows so the bars, not the gaps, keep the width.
function columnGap(n: number): number {
  return n <= 28 ? 3 : n <= 56 ? 2 : 1;
}

// Reading localStorage throws where site data is blocked — see
// getStoredBackground in lib/background.ts for the island that went blank.
function readStoredWindow(): ActivityWindowKey {
  try {
    const raw = window.localStorage.getItem(WINDOW_STORAGE_KEY);
    return ACTIVITY_WINDOWS.some((w) => w.key === raw) ? (raw as ActivityWindowKey) : DEFAULT_WINDOW;
  } catch {
    return DEFAULT_WINDOW;
  }
}

function ActivityStrip({
  plan,
  logs,
  done,
  top,
}: {
  plan: Plan | null;
  logs: WorkoutLog[];
  done: WorkoutLog[];
  top: number | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [windowKey, setWindowKey] = useState<ActivityWindowKey>(DEFAULT_WINDOW);
  const [width, setWidth] = useState(0);
  const [peekIndex, setPeekIndex] = useState<number | null>(null);

  // Restored after mount, not in the initialiser: the island's first render
  // must match the server's.
  useEffect(() => setWindowKey(readStoredWindow()), []);

  // Columns divide the measured width, so the strip needs it before it can
  // draw. A ResizeObserver fires on mount and on resize only — never on scroll.
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const win = ACTIVITY_WINDOWS.find((w) => w.key === windowKey) ?? ACTIVITY_WINDOWS[1];

  // buildTimeline runs from the first logged day through today + 14 days of
  // runway; the strip ends on today. "All time" over a short history is padded
  // to the narrowest window, so three days of logs are not three huge bars.
  const points = useMemo(() => {
    const all = buildTimeline(plan, logs);
    const todayIndex = all.findIndex((p) => p.isToday);
    const history = todayIndex >= 0 ? all.slice(0, todayIndex + 1) : all;
    return windowPoints(history, win.days ?? Math.max(ACTIVITY_WINDOWS[0].days, history.length));
  }, [plan, logs, win.days]);
  // By what is actually drawn, not by the window's name: "All time" over two
  // months of history is still a column per day.
  const daily = points.length <= DAILY_MAX_DAYS;
  const weeks = useMemo(() => (daily ? [] : toWeeks(points)), [daily, points]);

  // Summed from the completed logs, not from the bars, so "All time" here and
  // the all-time line below are the same numbers by construction.
  const sum = useMemo(() => {
    let inWindow = done;
    if (win.days != null) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - (win.days - 1));
      const from = ymd(cutoff);
      inWindow = done.filter((l) => l.log_date >= from);
    }
    return {
      count: inWindow.length,
      seconds: inWindow.reduce((acc, l) => acc + (l.total_seconds ?? 0), 0),
    };
  }, [done, win.days]);
  const allTime = useMemo(
    () => ({ count: done.length, seconds: done.reduce((acc, l) => acc + (l.total_seconds ?? 0), 0) }),
    [done],
  );

  const n = daily ? points.length : weeks.length;
  const gap = columnGap(n);
  const colW = n > 0 ? Math.max(1, (width - gap * (n - 1)) / n) : 0;
  const tallest = daily
    ? Math.max(0, ...points.flatMap((p) => p.sessionSeconds))
    : Math.max(0, ...weeks.map((w) => w.seconds));
  const heightOf = (seconds: number) =>
    tallest > 0 ? Math.max(BAR_MIN, Math.round((seconds / tallest) * STRIP_HEIGHT)) : BAR_MIN;
  // The today frame is a 1.5px inset; on a ~3px column that would paint the
  // whole column, so narrow columns get a hairline instead.
  const frameClass =
    colW >= 8 ? 'shadow-[inset_0_0_0_1.5px_var(--color-fg)]' : 'shadow-[inset_0_0_0_1px_var(--color-fg)]';

  // Outside-tap dismiss for the peeked column.
  useEffect(() => {
    if (peekIndex === null) return;
    function onPointerDown(e: PointerEvent) {
      const root = containerRef.current;
      if (root && !root.contains(e.target as Node)) setPeekIndex(null);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [peekIndex]);

  const peekLabel =
    peekIndex === null
      ? null
      : daily
        ? points[peekIndex] && `${points[peekIndex].fullLabel} · ${points[peekIndex].date}`
        : weeks[peekIndex] &&
          `Week of ${weeks[peekIndex].start} · ${weeks[peekIndex].sessions} session${weeks[peekIndex].sessions === 1 ? '' : 's'}`;

  const peekProps = (i: number) => ({
    onClick: (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      setPeekIndex((cur) => (cur === i ? null : i));
    },
    onMouseEnter: () => setPeekIndex(i),
    onMouseLeave: () => setPeekIndex((cur) => (cur === i ? null : cur)),
  });

  const todayFrame = (
    // On the COLUMN, not the bar, and stopping at the baseline: wrapping the
    // pedestal lane merged its bottom stroke with the pedestal on a day that is
    // both today and multi-session.
    <span
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 top-0 ${frameClass}`}
      style={{ bottom: FOOT_LANE }}
    />
  );

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center justify-between gap-3">
        {/* The range IS the section label, and tapping it opens the picker. The
            select is transparent and laid over the text, so the affordance stays
            hidden; 16px keeps iOS from zooming on focus, and -my-3 gives the 44px
            target back to the layout. Keyboard focus still shows a ring. */}
        <label className="relative -my-3 inline-flex min-h-11 shrink-0 cursor-pointer items-center">
          <select
            value={windowKey}
            aria-label="Activity window"
            onChange={(e) => {
              const key = e.target.value as ActivityWindowKey;
              setWindowKey(key);
              setPeekIndex(null);
              try {
                window.localStorage.setItem(WINDOW_STORAGE_KEY, key);
              } catch {
                /* blocked — the choice still applies for this visit. */
              }
            }}
            className="peer absolute inset-0 cursor-pointer appearance-none text-base opacity-0"
          >
            {ACTIVITY_WINDOWS.map((w) => (
              <option key={w.key} value={w.key}>
                {w.label}
              </option>
            ))}
          </select>
          <span className="t-label text-muted peer-focus-visible:rounded-sm peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-fg">
            {win.label}
          </span>
        </label>
        {peekLabel ? <span className="t-label truncate text-fg">{peekLabel}</span> : null}
      </div>

      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-display text-[28px] leading-none text-fg tabular-nums">
          {formatDuration(sum.seconds)}
        </span>
        <span className="text-xs leading-none text-muted tabular-nums">
          <span className="font-semibold text-fg">{sum.count}</span> session{sum.count === 1 ? '' : 's'}
        </span>
      </div>

      <div
        ref={stripRef}
        className="mt-2.5 flex items-end"
        style={{ height: STRIP_HEIGHT + FOOT_LANE, gap }}
        aria-label={daily ? 'One bar per day' : 'One bar per week'}
      >
        {width > 0 && daily
          ? points.map((p, i) => {
              const multi = p.state === 'done' && p.sessions.length > 1;
              const subW = multi ? (colW - SUB_GAP * (p.sessions.length - 1)) / p.sessions.length : colW;
              return (
                <button
                  key={p.date}
                  type="button"
                  {...peekProps(i)}
                  className="relative flex h-full shrink-0 cursor-pointer flex-col justify-end"
                  // paddingBottom is the pedestal lane: every column reserves it
                  // so the baseline stays one straight line.
                  style={{ width: colW, paddingBottom: FOOT_LANE }}
                  aria-label={`${p.date} ${p.fullLabel}`}
                  title={`${p.fullLabel} · ${p.date}`}
                >
                  {p.state !== 'done' ? (
                    <span className="h-0.5 w-full bg-border" aria-hidden />
                  ) : (
                    <span className="flex items-end" style={{ gap: SUB_GAP }} aria-hidden>
                      {p.sessions.map((colors, si) => (
                        // A session's tags stack inside its own bar.
                        <span
                          key={si}
                          className="flex flex-col"
                          style={{ width: subW, height: heightOf(p.sessionSeconds[si]) }}
                        >
                          {colors.map((c, ci) => (
                            <span key={ci} style={{ flex: 1, backgroundColor: c }} />
                          ))}
                        </span>
                      ))}
                    </span>
                  )}
                  {p.isToday ? todayFrame : null}
                  {multi ? (
                    // The pedestal: `--color-fg` at 2.5px against the rest
                    // hairline's `--color-border` at 2px — they share a band and
                    // are told apart by weight and tone, so keep the contrast.
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 bottom-0 bg-fg"
                      style={{ height: FOOT_H }}
                    />
                  ) : null}
                </button>
              );
            })
          : null}
        {width > 0 && !daily
          ? weeks.map((w, i) => (
              <button
                key={w.start}
                type="button"
                {...peekProps(i)}
                className="relative flex h-full shrink-0 cursor-pointer flex-col justify-end"
                style={{ width: colW, paddingBottom: FOOT_LANE }}
                aria-label={`${w.start} to ${w.end}: ${w.sessions} sessions`}
                title={`Week of ${w.start}`}
              >
                {w.color ? (
                  <span aria-hidden style={{ height: heightOf(w.seconds), backgroundColor: w.color }} />
                ) : (
                  <span className="h-0.5 w-full bg-border" aria-hidden />
                )}
                {w.isCurrent ? todayFrame : null}
              </button>
            ))
          : null}
      </div>

      {win.days != null ? (
        <p className="mt-2 text-[11px] leading-none text-muted tabular-nums">
          All time · {allTime.count} session{allTime.count === 1 ? '' : 's'} · {formatDuration(allTime.seconds)}
          {top != null ? ` · e1RM ${formatRound(top)} kg` : ''}
        </p>
      ) : top != null ? (
        <p className="mt-2 text-[11px] leading-none text-muted tabular-nums">Top e1RM {formatRound(top)} kg</p>
      ) : null}
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
    <div className="flex gap-px bg-border-soft">
      {days.map((d, i) => {
        const isToday = dayNameFromLabel(d.label).toLowerCase() === todayDayName.toLowerCase();
        const isActive = d.dayKey === activeKey;
        return (
          <button
            key={d.dayKey}
            type="button"
            aria-label={`${d.label}${isToday ? ' (today)' : ''}, ${d.exercises.length} ${
              d.exercises.length === 1 ? 'movement' : 'movements'
            }`}
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
            {/* No eyebrow: the collapsed letters beside it already say which
                day this is. The today dot moved in front of the title, and the
                movement count shrank to a trailing subscript. */}
            <span className="day-card-face day-card-detail flex items-center gap-1.5 whitespace-nowrap px-3.5">
              {isToday ? <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 bg-teal" /> : null}
              <span
                aria-hidden
                className="min-w-0 truncate font-display text-[0.8125rem] font-semibold tracking-[-0.02em]"
              >
                {typeFromLabel(d.label)}
              </span>
              <span aria-hidden className="shrink-0 self-end pb-[1.4rem] text-[10px] leading-none tabular-nums opacity-55">
                {d.exercises.length} mv
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function ProfileView({ mode }: { mode: Surface }) {
  const client = mode === 'showcase' ? supabasePublic : supabase;
  // The showcase renders this page in full — same plan card, same activity
  // strip, same calendar, same tabbed session list — and turns the write
  // controls inert instead of deleting them. RLS refuses those writes anyway;
  // this only decides what a visitor is offered.
  const readOnly = isReadOnly(mode);

  // Seed from the SWR cache (app mode only) so revisiting Home paints instantly
  // while the effect below revalidates in the background. Seeded in a layout
  // effect, not in `useState`: the server renders the empty/loading state, and
  // a first client render that differs from it is React #418 (see
  // useAuthedQuery). The layout effect runs before the first paint, so the
  // cached data is still what a revisit shows first.
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [allLogs, setAllLogs] = useState<WorkoutLog[]>([]);
  const [mealsToday, setMealsToday] = useState<MealLog[]>([]);
  // Hoisted so the chip rail and Today's meals share ONE drawer instance —
  // one dialog, one focus trap, one scroll lock (docs/MEAL_LOGGING.md §11.3).
  const [mealDraft, setMealDraft] = useState<MealDraft | null>(null);
  const [mealPresets, setMealPresets] = useState<MealPreset[]>([]);
  useLayoutEffect(() => {
    if (mode !== 'app') return;
    const seeded = getCached<Profile>('profile');
    if (seeded === undefined) return;
    setProfile(seeded);
    setPlan(getCached<Plan>('plan:active') ?? null);
    setLogs(getCached<WorkoutLog[]>('logs:recent30') ?? []);
    setAllLogs(getCached<WorkoutLog[]>('logs:all') ?? []);
    setMealsToday(getCached<MealLog[]>('meals:today') ?? []);
    setMealPresets(getCached<MealPreset[]>('meals:presets') ?? []);
    setLoading(false);
  }, [mode]);
  const [savedMealsOpen, setSavedMealsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // Pre-filled date when Add is opened from a specific calendar cell.
  const [addDate, setAddDate] = useState<string | null>(null);
  const [previewDay, setPreviewDay] = useState<PlanDay | null>(null);
  // Which day in the rail is expanded. null = "not chosen yet", which resolves
  // to today (or the first day) below — deliberately derived rather than set in
  // an effect, because the plan arrives async and an effect-set default would
  // paint the wrong card expanded for one frame.
  const [activeDayKey, setActiveDayKey] = useState<string | null>(null);
  // Bumped on every day switch; it keys the Start bar's one-shot sheen so the
  // CSS animation restarts by remount. 0 = nothing switched yet, no sheen.
  const [sheenKey, setSheenKey] = useState(0);
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
        const today = todayLocal();
        // App mode reads the shared history once and slices the recent list
        // out of it; the showcase reads through the anon client and keeps its
        // own two reads (logStore is owner-only).
        const logReads =
          mode === 'app'
            ? loadAllLogs().then((all) => [newestLogs(all, 30), all] as const)
            : Promise.all([getRecentLogs(30, client), getAllLogs(client)]);
        const [p, pl, [lg, all], meals, presets] = await Promise.all([
          getCurrentProfile(client),
          getActivePlan(client),
          logReads,
          // Showcase renders through the anon client, which has no read
          // access to meal_logs by RLS design (no anon policy exists — see
          // 0032_meal_logs.sql). Skip the read there rather than surface a
          // permanently-empty widget.
          mode === 'app' ? getMealLogsInRange(today, today, client) : Promise.resolve([]),
          // Same reason: meal_presets is owner-only with no anon policy (0047).
          mode === 'app' ? getMealPresets(client) : Promise.resolve([]),
        ]);
        if (!active) return;
        if (mode === 'app') {
          setCached('profile', p);
          setCached('plan:active', pl);
          setCached('logs:recent30', lg);
          setCached('logs:all', all);
          setCached('meals:today', meals);
          setCached('meals:presets', presets);
        }
        setProfile(p);
        setPlan(pl);
        setLogs(lg);
        setAllLogs(all);
        setMealsToday(meals);
        setMealPresets(presets);
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
          // Another device (or tab) changed a log: one fetch, both lists.
          invalidateLogs();
          loadAllLogs().then((all) => {
            const recent = newestLogs(all, 30);
            setCached('logs:recent30', recent);
            setLogs(recent);
            setAllLogs(all);
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [mode, profile]);

  // The Coach tab's count and runner. Its own fetch, outside the loader above:
  // it is chrome rather than content, so a slow or failed read leaves the tab
  // quiet instead of holding up — or failing — the whole Home. App only; the
  // coach is private and the tab never renders on the showcase.
  const [coach, setCoach] = useState({ live: 0, unseen: 0 });
  useEffect(() => {
    if (mode !== 'app') return;
    let active = true;
    getRecommendations().then((recs) => {
      if (active) setCoach(coachSignal(recs, getCoachSeenAt(), Date.now()));
    });
    return () => {
      active = false;
    };
  }, [mode]);

  // The headline tiles read the FULL history, not the recent-30 window that
  // feeds "Recent sessions" below. Off that window "Sessions" was pinned at 30
  // once you had 30 logs, total time was a sliding sum that could fall after a
  // workout, and a PR dropped out of Top e1RM as soon as 30 newer sessions
  // existed. Memoised because topE1rm walks every set in every log, and this
  // component re-renders whenever a sheet opens. Must sit above the early
  // returns below — hooks cannot run conditionally.
  const done = useMemo(() => completedLogs(allLogs), [allLogs]);

  // Recent sessions starts at five. Declared HERE, above the early returns
  // below, because hooks cannot run conditionally — putting a hook after
  // `if (loading)` is what crashed this component with React #310 once
  // already, and the audits were green on the blank page it produced.
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [showAllMonth, setShowAllMonth] = useState(false);
  // "This month" and "Recent sessions" used to be two stacked lists; they're
  // now one tabbed list, so only one is ever on screen. Defaults to 'month'
  // — it sits directly under the calendar grid it summarises.
  const [sessionsTab, setSessionsTab] = useState<'month' | 'recent'>('month');
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  });

  const thisMonthLogs = useMemo(() => {
    const yyyy = calendarMonth.getUTCFullYear();
    const mm = String(calendarMonth.getUTCMonth() + 1).padStart(2, '0');
    const prefix = `${yyyy}-${mm}`;
    return allLogs
      .filter((log) => log.log_date.slice(0, 7) === prefix)
      .sort((a, b) => b.log_date.localeCompare(a.log_date));
  }, [allLogs, calendarMonth]);

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

  const openMeal = (opener: MealOpener) => setMealDraft(draftFor(opener));
  // Newest first, matching getMealPresets: a created preset goes to the front,
  // an edited one keeps its place.
  const onPresetSaved = (preset: MealPreset) => {
    const exists = mealPresets.some((x) => x.id === preset.id);
    const next = exists ? mealPresets.map((x) => (x.id === preset.id ? preset : x)) : [preset, ...mealPresets];
    setMealPresets(next);
    setCached('meals:presets', next);
  };
  const onPresetDeleted = (id: string) => {
    const next = mealPresets.filter((x) => x.id !== id);
    setMealPresets(next);
    setCached('meals:presets', next);
  };
  const onMealSaved = (meal: MealLog | null) => {
    if (!meal) return;
    const next = [meal, ...mealsToday];
    setMealsToday(next);
    setCached('meals:today', next);
  };

  const top = topE1rm(done);
  const streak = currentWeekStreak(allLogs);
  const totalWeeks = plan ? planWeekCount(plan.parsed) : 0;
  const week = plan ? currentProgramWeek(plan.id, allLogs, totalWeeks) : null;
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
  const running = readOnly ? null : activeSessionOf(allLogs);
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
          {/* The date, the week and the streak read the same live data on both
              surfaces now, so they render on both. Only the leading word
              differs: the showcase says what it is. */}
          <div className="t-eyebrow flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
            <span>{readOnly ? 'Showcase' : new Date().toDateString()}</span>
            {week ? (
              <>
                <span aria-hidden>·</span>
                <span>Week {week}</span>
              </>
            ) : null}
            {streak >= 2 ? (
              <>
                <span aria-hidden>·</span>
                <span className="flex items-center gap-1.5 text-teal">
                  <span aria-hidden className="inline-block h-1.5 w-1.5 bg-teal" />
                  {streak}-week streak
                </span>
              </>
            ) : null}
          </div>
          <div className="mt-2">
            {/* displayNameFor, not the raw column: the showcase is served to
                anyone with the URL, and the redaction lives in one place now
                that every surface renders there. */}
            <EchoText
              text={displayNameFor(profile?.display_name, mode)}
              as="h1"
              className={ECHO_APP_TITLE}
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
          belongs to the unit, not its parts.

          Renders on the SHOWCASE too — it reads live plan data and is most of
          what the app's Home actually is. Its write controls go inert rather
          than disappearing (ui/ReadOnly); RLS refuses them regardless. */}
      <Item>
          {/* mb-6, like the sections below it. This was mb-3 while a "Coach →"
              link sat under the card supplying ~44px of its own whitespace;
              that link is now the runner standing on the card's top edge. */}
          <section className="mb-6">
            {/* 28px, not SectionHeader's baseline row: the runner stands on the
                card's edge to the right of this label and needs the room above
                the hairline. Its 44px hit box reaches 16px further up, into the
                header's mb-6 gap, which holds nothing tappable. */}
            {plan ? (
              <h2 className="t-label flex h-7 items-center text-muted">Active plan</h2>
            ) : (
              <SectionHeader>Active plan</SectionHeader>
            )}
            {plan ? (
              <>
                {/* The gutters are `--color-border-soft`, not `--color-border`:
                    the outer line outlines the card, the inner lines divide
                    rows INSIDE it. Full weight on both made every row read as
                    its own card, which is the same thing the stat tiles below
                    were doing. */}
                {/* The wrapper exists for the runner: the card clips with
                    overflow-hidden, so anything standing ON its edge has to be
                    positioned from outside it. */}
                <div className="relative">
                {!readOnly ? <CoachRunner live={coach.live} unseen={coach.unseen} /> : null}
                <div className="lift flex flex-col gap-px overflow-hidden border border-border bg-border-soft">
                  {/* Row one: which block, how far into it, and the way out to
                      the full plan. The week now says "of N" and carries the
                      TickProgress dashes under it — a bare "Week 3" told you
                      where you were but not how much was left. */}
                  <div className="bg-surface p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        {/* Wraps rather than truncates: "Endurance & Cut Block"
                            lost half its name to an ellipsis once the View link
                            claimed its 44px target. */}
                        <div className="font-display text-xl font-semibold leading-tight tracking-tight text-fg">
                          {plan.name}
                        </div>
                      </div>
                      {/* The glyph stays small; the TARGET may not — inline-flex
                          + min-h-11 gives it the 44px box without changing how it
                          reads. A bare text link measured 12px tall here. */}
                      <a
                        href={mode === 'app' ? '/app/plan/view' : hrefFor('/app/plan', mode)}
                        className="t-eyebrow -my-2 inline-flex min-h-11 shrink-0 items-center text-muted transition-colors hover:text-fg"
                      >
                        View →
                      </a>
                    </div>
                    {/* The "Week N of M" line went; the dashes carry it, and the
                        fraction restates the count for plans too long to count
                        by eye. TickProgress keeps the full sentence for AT. */}
                    {week ? (
                      <div className="mt-3 flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <TickProgress
                            value={week}
                            total={totalWeeks}
                            label={`Week ${week} of ${totalWeeks}`}
                          />
                        </div>
                        <span aria-hidden className="shrink-0 text-[10px] leading-none tabular-nums text-muted">
                          {week}/{totalWeeks}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {days.length > 0 ? (
                    <DayAccordion
                      days={days}
                      activeKey={activeKey}
                      todayDayName={todayDayName}
                      onSelect={(key) => {
                        setActiveDayKey(key);
                        setSheenKey((n) => n + 1);
                      }}
                      onPreview={setPreviewDay}
                    />
                  ) : null}

                  {/* Flat, not pillowed. `.hill-btn-flush` carries a 4px radius
                      and an inset dark edge, which inside a hairline-divider
                      container reads as a rounded pill floating ON the card
                      rather than a segment OF it — the same reason rows in a
                      gap-px grid never take .lift. The unit owns the depth. */}
                  <div className="flex gap-px bg-border-soft">
                    <a
                      // '#' on the showcase, not just a prevented click: the
                      // href is what a public page LEAKS. Without this the
                      // read-only CTA still advertises a private /app/log URL,
                      // and a visitor with JS off follows it.
                      href={
                        readOnly
                          ? '#'
                          : (resumeHref ??
                            (activeDay
                              ? `/app/log?day=${encodeURIComponent(activeDay.dayKey)}`
                              : '/app/log'))
                      }
                      {...readOnlyProps(readOnly)}
                      // The visible label no longer names the day (the panel above
                      // does), so the accessible name has to.
                      aria-label={
                        resumeHref
                          ? undefined
                          : activeDay
                            ? `Start ${typeFromLabel(activeDay.label)}`
                            : 'Start workout'
                      }
                      className={`relative flex min-h-11 flex-1 items-center justify-center gap-2 overflow-hidden px-4 transition-colors ${
                        resumeHref ? resumeClass : 'bg-fg text-bg hover:bg-fg/85'
                      }`}
                    >
                      {!resumeHref && sheenKey > 0 ? (
                        <span key={sheenKey} aria-hidden className="cta-sheen" />
                      ) : null}
                      {/* Above the sheen, which is an ::after on the anchor. */}
                      {resumeHref ? (
                        <span className="t-control relative truncate">{resumeLabel}</span>
                      ) : (
                        <>
                          <span className="relative font-cta text-[15px] font-semibold uppercase leading-none tracking-[0.14em]">
                            ..send it
                          </span>
                          <span aria-hidden className="relative text-base leading-none">→</span>
                        </>
                      )}
                    </a>
                    {/* The chooser is the only route to minis, saved sessions,
                        past-plan days, a blank workout and Log activity — it
                        cannot disappear just because the day cards took over
                        the common case. */}
                    <button
                      type="button"
                      aria-label="Other ways to start a session"
                      {...(readOnly ? readOnlyProps(true) : { onClick: () => setAddOpen(true) })}
                      className="flex min-h-11 w-8 items-center justify-center bg-surface text-muted transition-colors hover:bg-elevated hover:text-fg"
                    >
                      <span aria-hidden className="text-base leading-none">⋮</span>
                    </button>
                  </div>
                  {/* Meals and Coach stay app-only, and that is a DATA fact
                      rather than a design one: meal_logs has no anon policy
                      (0032) and the coach is deliberately private, so both
                      would render permanently empty on the showcase. (Coach's
                      way in is the runner on the card's top edge.) */}
                  {!readOnly ? <MealChipRail presets={mealPresets} onOpen={openMeal} onManage={() => setSavedMealsOpen(true)} /> : null}
                </div>
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
                    {...(readOnly ? readOnlyProps(true) : { onClick: () => setAddOpen(true) })}
                    className="hill-btn inline-flex min-h-12 flex-1 items-center justify-center bg-fg px-4 text-sm uppercase tracking-wider text-bg transition-colors hover:bg-fg/85"
                  >
                    Start workout
                  </button>
                  {!readOnly ? (
                    <a
                      href="/app/coach"
                      className="hill-btn inline-flex min-h-12 flex-1 items-center justify-center border border-border bg-surface px-4 text-sm uppercase tracking-wider text-fg transition-colors hover:border-fg"
                    >
                      Coach
                    </a>
                  ) : null}
                </div>
                {!readOnly ? (
                  <div className="mt-3 overflow-hidden rounded-card border border-border">
                    <MealChipRail presets={mealPresets} onOpen={openMeal} onManage={() => setSavedMealsOpen(true)} />
                  </div>
                ) : null}
              </>
            )}
          </section>
      </Item>

      {/* Activity: the hours in a chosen window, the strip for that window, and
          the all-time totals in one muted line under it. These used to be the
          strip plus a separate three-tile StatStrip. */}
      <Item>
        <section className="mb-6">
          <ActivityStrip plan={plan} logs={allLogs} done={done} top={top} />
        </section>
      </Item>

      {/* The Fuel card sits UNDER the activity block. mode === 'app' is mandatory,
          not cosmetic: this component also renders /showcase through the anon
          client, which has no read access to meal_logs by RLS design (no anon
          policy — see 0032_meal_logs.sql). Rendering this there would show a
          permanently-empty widget to the public. */}
      {mode === 'app' ? (
        <Item>
          <section className="mb-6">
            <TodaysMeals meals={mealsToday} presets={mealPresets} />
          </section>
        </Item>
      ) : null}

      <Item>
        <section className="mb-8">
          <MonthCalendar
            logs={allLogs}
            onMonthChange={setCalendarMonth}
            onDayClick={(date, sessions) => {
              if (sessions.length > 0) setQuickLog(sessions[0]);
              else if (readOnly) toast(READ_ONLY_NOTICE, 'error');
              else {
                setAddDate(date);
                setAddOpen(true);
              }
            }}
          />
        </section>
      </Item>

      <Item>
        <section>
          {/* This month and Recent sessions used to be two stacked lists — now
              one list with a tab switcher on top. Both filters are reads over
              `allLogs`, so the showcase gets the same control rather than the
              flat "Recent sessions" header it used to fall back to. */}
          <div className="mb-3">
            <SegmentedTabs
              tabs={[
                { key: 'month', label: 'Selected month' },
                { key: 'recent', label: 'Recent' },
              ]}
              active={sessionsTab}
              onChange={(k) => setSessionsTab(k as 'month' | 'recent')}
              ariaLabel="Sessions"
              size="sm"
            />
          </div>
          <SessionShapeLegend />
          {sessionsTab === 'month' ? (
            thisMonthLogs.length === 0 ? (
              <EmptyState>No sessions logged in this month.</EmptyState>
            ) : (
              <>
                <LogList
                  logs={showAllMonth ? thisMonthLogs : thisMonthLogs.slice(0, 5)}
                  history={allLogs}
                  onSelect={setQuickLog}
                />
                {thisMonthLogs.length > 5 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllMonth((v) => !v)}
                    aria-expanded={showAllMonth}
                    className="t-control flex min-h-11 w-full items-center justify-center text-muted transition-colors hover:text-fg"
                  >
                    {showAllMonth ? 'Show less' : `Show more (${thisMonthLogs.length - 5})`}
                  </button>
                ) : null}
              </>
            )
          ) : logs.length === 0 ? (
            <EmptyState>No sessions logged yet.</EmptyState>
          ) : (
            <>
              <LogList
                logs={logs.slice(0, showAllRecent ? 12 : 5)}
                history={allLogs}
                onSelect={setQuickLog}
              />
              {/* A plain text button, deliberately not a card and not a
                  Disclosure: this is one list that grows, not a second
                  container stacked under the first. min-h-11 keeps it a legal
                  tap target even though it reads as a link. */}
              {logs.length > 5 ? (
                <button
                  type="button"
                  onClick={() => setShowAllRecent((v) => !v)}
                  aria-expanded={showAllRecent}
                  className="t-control flex min-h-11 w-full items-center justify-center text-muted transition-colors hover:text-fg"
                >
                  {showAllRecent ? 'Show less' : `Show more (${Math.min(logs.length, 12) - 5})`}
                </button>
              ) : null}
            </>
          )}
        </section>
      </Item>

    </PageStagger>

      {/* Read surfaces render on both: DayPreviewDialog is how a plan day is
          inspected and LogQuickView is how a session is read. Their own edit
          and delete controls take the read-only treatment inside LogQuickView.
          The two genuinely write-only sheets stay app-only. */}
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
        readOnly={readOnly}
        onUpdated={(updated) => {
          applyLogChange((ls) => ls.map((l) => (l.id === updated.id ? updated : l)));
          setQuickLog(updated);
        }}
        onDeleted={(id) => applyLogChange((ls) => ls.filter((l) => l.id !== id))}
      />
      {!readOnly ? (
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
          <MealDrawer
            draft={mealDraft}
            onDraftChange={(patch) => setMealDraft((d) => (d ? { ...d, ...patch } : d))}
            onClose={() => setMealDraft(null)}
            onSaved={onMealSaved}
            presets={mealPresets}
            onPresetSaved={onPresetSaved}
          />
          <SavedMealsSheet
            open={savedMealsOpen}
            presets={mealPresets}
            onClose={() => setSavedMealsOpen(false)}
            onSaved={onPresetSaved}
            onDeleted={onPresetDeleted}
          />
        </>
      ) : null}
    </>
  );
}
