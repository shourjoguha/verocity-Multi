import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase, supabasePublic } from '@/lib/supabase';
import { getAllLogs, getLogsInRange, getUserStats } from '@/lib/queries';
import { bodyweightMultiple } from '@/lib/userStats';
import { useAuthedQuery } from '@/lib/useAuthedQuery';
import { loadAllLogs, logsBetween } from '@/lib/logStore';
import { useAspectProfile } from '@/lib/useAspectProfile';
import { setPeriod, usePeriod } from '@/lib/periodPrefs';
import type { WorkoutLog } from '@/lib/types';
import { e1rm } from '@/lib/e1rm';
import { completedLogs, flattenWorkingSets, familyOf } from '@/lib/stats';
import { trackName } from '@/lib/notations';
import {
  addWork,
  formatWork,
  laneScore,
  mergeLane,
  sessionKind,
  sessionWork,
  workBodyWeight,
  workReferencesByKind,
  WORK_UNIT,
  ZERO_WORK,
  type LaneScore,
  type WorkTotals,
} from '@/lib/work';
import { sessionClockSeconds, sessionLens } from '@/lib/bodyLoad';
import { buildLoadIndex, formatLoadChanges, loadChanges, type LoadChange } from '@/lib/loadChange';
import { aspectWindows, logsInWindow } from '@/lib/aspects';
import { formatDuration, formatRound } from '@/lib/format';
import { sessionTagColors, stripeBackground } from '@/lib/tags';
import {
  ASPECT_READ_DAYS,
  BODY_LENSES,
  BODY_LENS_KEYS,
  CONSISTENCY,
  FITNESS_ASPECTS,
  TOOLTIP,
  TRAINING_PERIODS,
  type TrainingPeriodKey,
} from '@/app.config';
import {
  EmptyState,
  Delta,
  LoadingScreen,
  SectionHeader,
  StatStrip,
} from '@/components/ui/primitives';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { Disclosure } from '@/components/ui/Disclosure';
import { adherenceText, useActivePlanAdherence } from '@/components/PlanAdherence';
import { formatDateRange, HistoryScroller } from '@/components/ui/HistoryScroller';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
import { FitnessProfile } from '@/components/FitnessProfile';
import { GarminHealthSection } from '@/components/GarminHealthSection';
import { Item, PageStagger } from '@/components/anim';

// The consistency grid shows the last min(period, GRID_WEEKS) weeks, one
// column per week — the owner's call: at 12W and 6M it stays at 8 and says so,
// rather than folding weeks together or shrinking 26 columns to ~9px slivers
// at 375px. Fewer weeks never widen a column past its 8-week size either: at
// 4W, four full-width columns of square days made the grid ~600px tall.
// That is how many weeks are IN VIEW; the grid scrolls sideways back to the
// first logged session (deriveGrid, ui/HistoryScroller).
const GRID_WEEKS = 8;

// "the last 6 weeks", "the last 6 months" — the empty state's wording.
function periodPhrase(key: TrainingPeriodKey): string {
  const p = TRAINING_PERIODS.find((t) => t.key === key)!;
  return p.key.endsWith('m') ? `${parseInt(p.label, 10)} months` : `${p.days / 7} weeks`;
}

// The tap detail, one line per lane: its work and where that sits against
// your usual best — the two bars, read out. Both lanes named, never one summed
// figure (the number `workIntensity` exists to stop anyone reading as
// meaningful). The unit rides the first line only. A lane the day did not do
// is left out, like the half that is not drawn.
function laneLines(work: WorkTotals, lift: LaneScore, cardio: LaneScore): string {
  const vs = (s: LaneScore): string =>
    s.kind === 'score'
      ? s.over
        ? ' · above best'
        : ` · ${Math.round(s.value * 100)}% of best`
      : s.kind === 'baseline'
        ? ` · baseline ${s.n}/${CONSISTENCY.minSessions}`
        : '';
  const lines: string[] = [];
  if (work.resistance > 0) lines.push(`Lift ${formatWork(work.resistance)} ${WORK_UNIT}${vs(lift)}`);
  if (work.cardio > 0) {
    lines.push(`Cardio ${formatWork(work.cardio)}${lines.length ? '' : ` ${WORK_UNIT}`}${vs(cardio)}`);
  }
  return lines.length > 0 ? lines.join('\n') : 'No work logged';
}

// Lifting on top, cardio below, as two stacked bars on a small PLATE in the
// page colour. The plate is the point: bars drawn straight onto the activity
// colour (the capsule this replaced) had their contrast set by the hue, so on
// dark green, purple and blue fill and track read alike, and side-by-side
// halves looked like one bar. On the plate, ink fill and 20% ink track sit on
// the same background for every activity and flip with the theme. A lane the
// day did not do is not drawn; dotted = building baseline.
function WorkBars({ lift, cardio }: { lift: LaneScore; cardio: LaneScore }) {
  const bars = (
    [
      ['lift', lift],
      ['cardio', cardio],
    ] as const
  ).filter(([, s]) => s.kind !== 'none');
  if (bars.length === 0) return null;
  return (
    <span
      aria-hidden
      className="absolute inset-x-1 bottom-1 flex flex-col gap-0.5 rounded-[3px] bg-bg/90 p-0.5"
    >
      {bars.map(([key, s]) => (
        <span
          key={key}
          className={`block h-[3px] overflow-hidden rounded-full ${
            s.kind === 'baseline' ? 'capsule-baseline' : 'bg-fg/20'
          }`}
        >
          {s.kind === 'score' ? (
            <span
              className="block h-full rounded-full bg-fg"
              style={{ width: `${Math.round(s.value * 100)}%` }}
            />
          ) : null}
        </span>
      ))}
    </span>
  );
}

const RPE_BUCKETS = [6, 7, 8, 9, 10];

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

function mondayOf(d: Date): Date {
  const idx = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - idx));
}

type Point = { date: string; value: number };

// e1RM sparkline, inline in a Top lifts row. Static: it mounts inside a
// closed <details>, where a `whileInView` start state left it invisible.
// Decorative — the row already carries the number, and per-point hover targets
// a few pixels wide inside a 64px chart could never meet the 44px tap rule.
function Sparkline({ points }: { points: Point[] }) {
  if (points.length === 0) return <span aria-hidden className="w-16 shrink-0" />;
  const H = 20;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const n = points.length;
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => H - 2 - ((v - min) / span) * (H - 4);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ');
  const area = `${line} L100,${H} L0,${H} Z`;

  return (
    <svg
      viewBox={`0 0 100 ${H}`}
      preserveAspectRatio="none"
      className="block h-5 w-16 shrink-0"
      aria-hidden
    >
      <path d={area} fill="var(--color-fg)" fillOpacity={0.07} />
      <path
        d={line}
        fill="none"
        stroke="var(--color-fg)"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// A week's time in a ~40px grid column: "45m", or hours to one decimal.
function formatWeekTime(seconds: number): string {
  return seconds < 3600 ? `${Math.round(seconds / 60)}m` : `${formatRound(seconds / 3600, 1)}h`;
}

// Everything on this page reads the selected PERIOD (lib/periodPrefs.ts) — the
// tiles, grid, mix bar, top lifts and RPE fingerprint here, the radar in
// useAspectProfile. The fetch is wider (the longest period plus the block
// before it, for the radar's comparison) and must not leak into these: they
// filter to the period themselves.
//
// Extracted from the render body and memoised by the caller. It used to run
// inline on every render, so hovering a sparkline point re-derived every bucket,
// map and series over 120 days of LogDocument JSONB just to move a tooltip.
const UNCLASSIFIED = 'unclassified';

// One step per lens, plus a fourth for "Other" — which only renders when a
// session's movements did not classify. Three hardcoded ternaries used to do
// this and collapsed the third and fourth segments onto the same grey.
const MIX_SHADES = ['bg-fg/80', 'bg-fg/45', 'bg-fg/25', 'bg-fg/12'] as const;

// Where the window's TIME went, for the small proportion bar under the tiles.
//
// PER SESSION, WINNER-TAKE-ALL, WHOLE CLOCK. This used to read
// `modalityMinutes` off `summarizeBodyLoad`, which splits each session's clock
// proportionally across the modalities inside it. That is the right question
// for the body map and the wrong one here, and it made the rail disagree with
// the TIME tile directly above it in two ways: it dropped the rest between
// sets, and its denominator was CLASSIFIED minutes only, so any movement the
// taxonomy could not place silently left the total. Three percentages summing
// to 100 sat under a duration they were not a share of.
//
// An hour in the gym is an hour spent on what that session was for — rest,
// setup and the warm-up included. So each session lands wholly in one lens and
// contributes its whole clock, and the rail now sums to the TIME tile.
// `sessionLens` carries the winner-take-all consequence: a Hyrox session is one
// lens, not a split one.
function sessionTimeMix(
  logs: WorkoutLog[],
): { key: string; label: string; pct: number }[] | null {
  const seconds = new Map<string, number>();
  for (const log of logs) {
    if (log.status !== 'done') continue;
    const lens = sessionLens(log);
    const key = lens ?? UNCLASSIFIED;
    seconds.set(key, (seconds.get(key) ?? 0) + sessionClockSeconds(log));
  }
  const total = [...seconds.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  // Unclassified last, and only when it has time in it — a session whose
  // movements the taxonomy could not place is still time you spent, and
  // dropping it would put the rail back out of step with the TIME tile.
  return [...BODY_LENS_KEYS.map((k) => ({ key: k as string, label: BODY_LENSES[k].label })),
    { key: UNCLASSIFIED, label: 'Other' }]
    .map(({ key, label }) => ({ key, label, pct: ((seconds.get(key) ?? 0) / total) * 100 }))
    .filter((p) => p.key !== UNCLASSIFIED || p.pct > 0);
}

// The consistency grid's columns: one per week from the week of the first
// logged session through this one, at least GRID_WEEKS of them, oldest first.
// Over ALL history, not the period — the grid scrolls back through it
// (ui/HistoryScroller), and only how many weeks are IN VIEW follows the period.
// Memoised on history and bodyweight alone, so neither a period change nor a
// scroll re-derives it.
function deriveGrid(history: WorkoutLog[], today: Date, bodyWeightKg: number) {
  // Nothing after today, as when the grid read the period's window.
  const todayKey = ymd(today);
  const past = history.filter((l) => l.log_date.slice(0, 10) <= todayKey);
  const thisMonday = mondayOf(today);
  let firstMonday = thisMonday;
  for (const l of past) {
    const m = mondayOf(new Date(`${l.log_date.slice(0, 10)}T00:00:00Z`));
    if (m < firstMonday) firstMonday = m;
  }
  const span = Math.round((thisMonday.getTime() - firstMonday.getTime()) / (7 * 86_400_000)) + 1;
  const total = Math.max(GRID_WEEKS, span);
  const weekStarts = Array.from({ length: total }, (_, i) => {
    const d = new Date(thisMonday);
    d.setUTCDate(thisMonday.getUTCDate() - (total - 1 - i) * 7);
    return d;
  });

  // The footer under each grid column: that week's time and its highest
  // logged max HR. Finished sessions on the same clock as the TIME tile. The
  // session count is not repeated here — the column above already shows it.
  // Bucketed in one pass: a column per week of history is too many to filter
  // the whole log list once each.
  const byWeek = new Map<string, WorkoutLog[]>();
  for (const l of completedLogs(past)) {
    const key = ymd(mondayOf(new Date(`${l.log_date.slice(0, 10)}T00:00:00Z`)));
    const arr = byWeek.get(key) ?? [];
    arr.push(l);
    byWeek.set(key, arr);
  }
  const weekFoot = weekStarts.map((start) => {
    const inWeek = byWeek.get(ymd(start)) ?? [];
    const hrs = inWeek.map((l) => l.hr_max).filter((v): v is number => v != null);
    return {
      seconds: inWeek.reduce((a, l) => a + sessionClockSeconds(l), 0),
      hrMax: hrs.length > 0 ? Math.max(...hrs) : null,
    };
  });

  // Per-day activity map for the heatmap (key = ymd). `colors` is the day's
  // DISTINCT activity colors — a day is striped when it genuinely mixed
  // activities, so two strength sessions read as one solid strength cell while a
  // single session tagged strength + mobility reads as two stripes. Using
  // sessionTagColors (not tags[0]) is what makes the second case work.
  // `sessions` keeps each log separate — its own tag colours and its own
  // duration — so a day with more than one log splits into time-proportional
  // horizontal bands rather than merging every tag into one striped square
  // (which read as a single mixed session). A single-tag session is a solid
  // band; a session tagged with several activities is still striped within its
  // own band.
  //
  // The bars along the bottom score lifting and cardio SEPARATELY, each
  // against your 90th-percentile session of that lane with the same tag
  // (`sessionKind`), over ALL your history (`history`, not the 120-day fetch).
  // It replaced one bar taking the higher of the two ratios against the tag's
  // maximum, which read every recent day as full: a plan repeating the same
  // sled every week ties at the maximum every week, and 2 crossfit sessions
  // make both of them "big". A lane the session did not do is not drawn; one
  // with too few sessions to compare draws dotted (lib/work.ts `laneScore`).
  // A day with two sessions merges them per lane (`mergeLane`).
  //
  // `loads` is the per-movement load change for the tap detail (lib/loadChange).
  type DaySession = { colors: string[]; seconds: number };
  type DayCell = {
    work: WorkTotals;
    labels: string[];
    sessions: DaySession[];
    loads: LoadChange[];
    lift: LaneScore;
    cardio: LaneScore;
  };
  const refs = workReferencesByKind(history, bodyWeightKg);
  const loadIndex = buildLoadIndex(history);
  const dayMap = new Map<string, DayCell>();
  for (const log of past) {
    const key = log.log_date.slice(0, 10);
    const cur: DayCell = dayMap.get(key) ?? {
      work: ZERO_WORK,
      labels: [],
      sessions: [],
      loads: [],
      lift: { kind: 'none' },
      cardio: { kind: 'none' },
    };
    const work = sessionWork(log, bodyWeightKg);
    const ref = refs.get(sessionKind(log));
    cur.work = addWork(cur.work, work);
    cur.labels.push(log.tags[0] ?? log.activity_type ?? 'Session');
    cur.sessions.push({
      colors: sessionTagColors(log.tags, log.activity_type),
      seconds: log.total_seconds ?? 0,
    });
    cur.lift = mergeLane(cur.lift, laneScore(work.resistance, ref?.resistance));
    cur.cardio = mergeLane(cur.cardio, laneScore(work.cardio, ref?.cardio));
    cur.loads.push(...loadChanges(log, loadIndex));
    dayMap.set(key, cur);
  }

  return { weekStarts, weekFoot, dayMap, span };
}

function deriveStats(
  fetched: WorkoutLog[],
  today: Date,
  groupBy: 'movement' | 'family',
  periodDays: number,
) {
  const periodStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (periodDays - 1)),
  );
  const all: WorkoutLog[] = logsInWindow(fetched, {
    start: ymd(periodStart),
    end: ymd(today),
  });

  // RPE fingerprint: distribution across RPE buckets, per movement family.
  const fam = new Map<string, { dist: number[]; sum: number; n: number }>();
  for (const log of all) {
    for (const s of flattenWorkingSets(log)) {
      if (s.rpe == null) continue;
      const f = familyOf(s.movement);
      if (!f) continue;
      const cur = fam.get(f) ?? { dist: [0, 0, 0, 0, 0], sum: 0, n: 0 };
      const idx = Math.min(4, Math.max(0, Math.round(s.rpe) - 6));
      cur.dist[idx] += 1;
      cur.sum += s.rpe;
      cur.n += 1;
      fam.set(f, cur);
    }
  }
  const rpeRows = [...fam.entries()]
    .map(([family, v]) => ({ family, dist: v.dist, total: v.n, avg: v.sum / v.n }))
    .sort((a, b) => b.total - a.total);

  // Top movements by best e1RM + their session-by-session e1RM series.
  const best = new Map<string, number>();
  const series = new Map<string, Point[]>();
  const sorted = [...all].sort((a, b) => a.log_date.localeCompare(b.log_date));
  for (const log of sorted) {
    const bestThis = new Map<string, number>();
    for (const s of flattenWorkingSets(log)) {
      if (s.weight == null || s.reps == null) continue;
      const est = e1rm(s.weight, s.reps);
      if (est == null) continue;
      // A variation is its own line, never a point on the plain lift's.
      const track = trackName(s.movement, s.notations);
      bestThis.set(track, Math.max(bestThis.get(track) ?? 0, est));
    }
    for (const [m, v] of bestThis) {
      best.set(m, Math.max(best.get(m) ?? 0, v));
      const arr = series.get(m) ?? [];
      arr.push({ date: log.log_date.slice(0, 10), value: v });
      series.set(m, arr);
    }
  }
  const topMoves = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

  // Family-grouped e1RM series (max across the family's movements per date).
  const famDateMax = new Map<string, Map<string, number>>();
  const famBest = new Map<string, number>();
  for (const [movement, pts] of series) {
    const f = familyOf(movement) ?? movement;
    const dm = famDateMax.get(f) ?? new Map<string, number>();
    for (const p of pts) dm.set(p.date, Math.max(dm.get(p.date) ?? 0, p.value));
    famDateMax.set(f, dm);
    famBest.set(f, Math.max(famBest.get(f) ?? 0, best.get(movement) ?? 0));
  }
  const famSeries = new Map<string, Point[]>(
    [...famDateMax].map(([f, dm]) => [
      f,
      [...dm.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, value]) => ({ date, value })),
    ]),
  );
  const topFams = [...famBest.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const cards = groupBy === 'family' ? topFams : topMoves;
  const seriesFor = groupBy === 'family' ? famSeries : series;

  // THE TILES READ FINISHED SESSIONS ONLY, and all three read the same ones.
  // They used to disagree with each other and with the rail beneath them:
  // Sessions and Time counted every log in the window including the
  // `in_progress` row that /app/log creates the moment you open it, while the
  // proportion bar counted `status === 'done'`. Same strip, three populations.
  const finished = completedLogs(all);

  // Completed sets in the window. This tile used to read "Adherence" —
  // completed sets over sets PRESENT IN THE LOG, which could only ever be near
  // 100 because a set enters the denominator by being added to a session and
  // you tick it when you do it. Adherence against the PLAN is a question about
  // the plan's whole life, needs `plans.parsed`, and lives on /app/plan where
  // both are loaded. See lib/planAdherence.ts.
  const doneSets = finished.reduce(
    (a, l) => a + flattenWorkingSets(l).filter((s) => s.completed).length,
    0,
  );

  // Same clock the rail splits, so the two cannot disagree about how long a
  // session was — `sessionClockSeconds` falls back to working minutes when the
  // timer was not running, which `total_seconds ?? 0` scored as zero.
  const totalSeconds = finished.reduce((a, l) => a + sessionClockSeconds(l), 0);

  return {
    all,
    rpeRows,
    topMoves,
    cards,
    seriesFor,
    finished,
    doneSets,
    totalSeconds,
  };
}

type GridData = ReturnType<typeof deriveGrid>;

// The consistency grid, memoised: the tooltip moves on every pointer move and
// re-renders the page, and with a column per week of history there are too
// many cells (and too many label strings) to rebuild for that. `onTip` must be
// stable. `visible` weeks fill the width; the rest are reached by scrolling.
const ConsistencyGrid = memo(function ConsistencyGrid({
  weekStarts,
  weekFoot,
  dayMap,
  visible,
  todayKey,
  onTip,
}: {
  weekStarts: GridData['weekStarts'];
  weekFoot: GridData['weekFoot'];
  dayMap: GridData['dayMap'];
  visible: number;
  todayKey: string;
  onTip: (e: { clientX: number; clientY: number }, label: string) => void;
}) {
  // Grid columns are never wider than at GRID_WEEKS: fewer weeks in view take
  // that fraction of the row instead of stretching. gap-1 = 0.25rem.
  const gridWidth =
    visible < GRID_WEEKS
      ? `calc(${visible} * (100% - ${GRID_WEEKS - 1} * 0.25rem) / ${GRID_WEEKS} + ${visible - 1} * 0.25rem)`
      : undefined;
  // A percentage of the scroller, so `visible` columns fill it exactly.
  const colWidth = `calc((100% - ${visible - 1} * 0.25rem) / ${visible})`;
  return (
    <HistoryScroller
      count={weekStarts.length}
      visible={visible}
      ariaLabel="Consistency by week"
      labelFor={({ start, end }) => {
        const last = new Date(weekStarts[end]);
        last.setUTCDate(last.getUTCDate() + 6);
        const to = ymd(last) < todayKey ? ymd(last) : todayKey;
        return formatDateRange(ymd(weekStarts[start]), to);
      }}
      className="gap-1"
      style={{ width: gridWidth }}
    >
      {weekStarts.map((ws, col) => (
        <div key={ymd(ws)} className="flex flex-col gap-1" style={{ width: colWidth }}>
          {Array.from({ length: 7 }).map((_, row) => {
            const d = new Date(ws);
            d.setUTCDate(ws.getUTCDate() + row);
            const key = ymd(d);
            const cell = dayMap.get(key);
            const dateLabel = d.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              timeZone: 'UTC',
            });
            if (!cell) {
              return (
                <div key={row} className="hill aspect-square bg-fg/[0.05]" />
              );
            }
            // Biggest moves first, two named; unchanged ones sort last and
            // fold into "+N more" rather than spending the box on "=".
            const loads = formatLoadChanges(
              [...cell.loads].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
              2,
            );
            const label = `${dateLabel} · ${cell.labels.join(', ')}\n${laneLines(
              cell.work,
              cell.lift,
              cell.cardio,
            )}${loads ? `\nLoad: ${loads}` : ''}`;
            // One horizontal band PER LOG, stacked and split by a hairline
            // (the container bg shows through a 1px gap), each band's share
            // proportional to that log's duration. A single-log day is one
            // full-box band — unchanged from the old solid/striped square.
            // Within a band: stripes for a mixed-tag session, a solid fill
            // for one tag. The old code merged every tag of the day into
            // one striped square, so two separate logs read as a single
            // mixed session.
            const totalSecs = cell.sessions.reduce((a, s) => a + s.seconds, 0);
            // Colour is IDENTITY, at full strength, so a strength day and
            // a mobility day never converge on the same washed-out grey.
            // The old `opacity: 0.3 + volume/dayMax * 0.7` folded amount
            // into the hue's lightness, which is exactly what made two
            // different activities hard to tell apart at low volume.
            // Volume moves to its own channel: the bars along the
            // bottom edge, monochrome LENGTHS that cannot distort the
            // colour above them. (Border-glow was the other candidate, but
            // an inset box-shadow is a CLAUDE.md "never" in a component.)
            return (
              <div
                key={row}
                className="hill relative aspect-square cursor-pointer overflow-hidden"
                data-tip-target
                onMouseMove={(e) => onTip(e, label)}
              >
                <span aria-hidden className="absolute inset-0 flex flex-col gap-px bg-bg/60">
                  {cell.sessions.map((s, si) => {
                    const stripes = stripeBackground(s.colors);
                    return (
                      <span
                        key={si}
                        className="block w-full"
                        style={{
                          // Time share drives the band height; equal split
                          // when a day carries no durations at all.
                          flex: `${totalSecs > 0 ? s.seconds || 0.0001 : 1} 1 0`,
                          ...(stripes
                            ? { backgroundImage: stripes }
                            : { backgroundColor: s.colors[0] }),
                        }}
                      />
                    );
                  })}
                </span>
                <WorkBars lift={cell.lift} cardio={cell.cardio} />
              </div>
            );
          })}
          {/* Under each week, in its own column so it scrolls with it. */}
          <div className="mt-0.5 text-center text-[0.6rem] leading-tight tabular-nums">
            <div className="text-fg">
              {weekFoot[col].seconds > 0 ? formatWeekTime(weekFoot[col].seconds) : '—'}
            </div>
            <div className="text-muted">{weekFoot[col].hrMax ?? ' '}</div>
          </div>
        </div>
      ))}
    </HistoryScroller>
  );
});

export default function StatsView({ mode = 'app' }: { mode?: 'app' | 'showcase' }) {
  const client = mode === 'showcase' ? supabasePublic : supabase;
  // Real "now" on both surfaces — the showcase is live (migration 0034).
  const today = new Date();
  // The page's period, shared with Body and saved on this device.
  const periodKey = usePeriod();
  const periodDays = TRAINING_PERIODS.find((p) => p.key === periodKey)!.days;
  // The radar compares the period against the block before it, so the fetch
  // spans both, at the LONGEST period — wide enough that switching never
  // refetches. In app mode this is a slice of the shared all-logs cache
  // (loadAllLogs), so widening it moves no extra bytes; only the showcase's
  // anon read is bounded by it.
  const windows = aspectWindows(today, ASPECT_READ_DAYS);
  // Cache key names the window: with the old 8-week key a revisit would paint a
  // cached 56-day array on the first frame (useAuthedQuery seeds synchronously)
  // and the radar would compute over the wrong span until revalidation landed.
  const { data: logs, loading } = useAuthedQuery(
    () =>
      mode === 'app'
        ? loadAllLogs().then((all) => logsBetween(all, windows.prior.start, windows.current.end))
        : getLogsInRange(windows.prior.start, windows.current.end, client),
    {
      auth: mode === 'app',
      key: mode === 'app' ? `stats:logs:${ASPECT_READ_DAYS * 2}d` : undefined,
    },
  );

  // The radar's own reads start here, alongside the log fetch rather than behind
  // it — FitnessProfile does not mount until logs land, so fetching from inside
  // it waterfalled a second round trip.
  const profile = useAspectProfile({ logs, today, mode, client, windowDays: periodDays });

  // Bodyweight, for the ×BW multiples on the e1RM cards. Null in showcase mode
  // (no anon policy on user_stats) and null for anyone who has not filled it in,
  // in which case the multiple simply is not rendered.
  // Every finished session, for the bars' per-tag reference and the load
  // change "vs last time". All time on purpose: the 120-day fetch above held 27
  // of 42 strength sessions, and a reference should not drift as old ones age out.
  const { data: history, loading: historyLoading } = useAuthedQuery(() => (mode === 'app' ? loadAllLogs() : getAllLogs(client)), {
    auth: mode === 'app',
    key: mode === 'app' ? 'stats:logs:all' : undefined,
  });

  const adherence = useActivePlanAdherence(mode === 'app');
  const { data: stats, loading: statsLoading } = useAuthedQuery(
    () => (mode === 'app' ? getUserStats() : Promise.resolve(null)),
    { auth: mode === 'app', key: mode === 'app' ? 'userStats' : undefined },
  );

  // `shown` rather than null: the tooltip box stays mounted (see the render
  // below), so hiding keeps the last position and label instead of unmounting.
  const [tip, setTip] = useState<{ x: number; y: number; label: string; shown: boolean } | null>(null);
  // The portal target only exists in the browser; the island also renders on
  // the server, where `document` does not.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => setPortalReady(true), []);
  const [groupBy, setGroupBy] = useState<'movement' | 'family'>('movement');
  const tipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Stable, so the memoised grid is not re-rendered by the tooltip it moves.
  const showTip = useCallback((e: { clientX: number; clientY: number }, label: string) => {
    setTip({ x: e.clientX, y: e.clientY, label, shown: true });
    clearTimeout(tipTimer.current);
    tipTimer.current = setTimeout(() => setTip((t) => (t ? { ...t, shown: false } : t)), TOOLTIP.holdMs);
  }, []);
  useEffect(() => () => clearTimeout(tipTimer.current), []);

  // The tooltip is `fixed` at the finger, so once the page moves it points at
  // nothing: hide it on any scroll — the app's scroller or the grid's own
  // sideways one (a capturing listener on the document hears both, since
  // scroll does not bubble) — and on a tap anywhere
  // that is not another tooltip target (a tap on one moves it instead — that
  // target's own handler fires after this). Listeners exist only while shown.
  const tipShown = tip?.shown ?? false;
  useEffect(() => {
    if (!tipShown) return;
    const hide = () => {
      clearTimeout(tipTimer.current);
      setTip((t) => (t ? { ...t, shown: false } : t));
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('[data-tip-target]')) hide();
    };
    document.addEventListener('scroll', hide, { capture: true, passive: true });
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [tipShown]);

  // `today` is intentionally out of the dep list: in app mode it is a fresh Date
  // on every render, and re-deriving a period of buckets because the clock moved a
  // millisecond is the cost this memo exists to avoid. The period IS a dep:
  // picking one is the only thing besides data that should re-derive.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bodyWeightKg = workBodyWeight(stats ?? null);
  const derived = useMemo(
    () => deriveStats(logs ?? [], today, groupBy, periodDays),
    [logs, groupBy, periodDays],
  );
  // The grid reads all history and ignores the period; only how many weeks
  // are in view follows it. Back to the week of the first logged session, and
  // never fewer columns than fit in view.
  const grid = useMemo(
    () => deriveGrid(history ?? logs ?? [], today, bodyWeightKg),
    [history, logs, bodyWeightKg],
  );
  const visibleWeeks = Math.min(Math.ceil(periodDays / 7), GRID_WEEKS);
  const gridCapped = Math.ceil(periodDays / 7) > GRID_WEEKS;
  const gridCols = useMemo(() => {
    const k = Math.max(visibleWeeks, grid.span);
    return { weekStarts: grid.weekStarts.slice(-k), weekFoot: grid.weekFoot.slice(-k) };
  }, [grid, visibleWeeks]);

  // Kept before the loading guard: hooks must not sit behind an early return.
  const mix = useMemo(() => sessionTimeMix(derived.finished), [derived]);

  // The biggest riser and the biggest faller between the current period and the
  // one before it, plus whichever axis is now lowest. Scores are on
  // ASPECT_SCALE (1..10), so a delta is already a plain integer and needs no
  // normalising. Only axes present in BOTH periods can move — an axis that just
  // acquired a baseline has not "gone up", it has started being measured.
  const movers = useMemo(() => {
    const cur = profile.current?.scores;
    const prev = profile.prior?.scores;
    if (!cur || !prev) return null;
    const deltas = FITNESS_ASPECTS.map((a) => ({
      label: a.label,
      delta: (cur[a.key] ?? NaN) - (prev[a.key] ?? NaN),
      now: cur[a.key] ?? NaN,
    })).filter((d) => Number.isFinite(d.delta) && Number.isFinite(d.now));
    if (deltas.length === 0) return null;

    const up = [...deltas].sort((a, b) => b.delta - a.delta)[0];
    const down = [...deltas].sort((a, b) => a.delta - b.delta)[0];
    const lowest = [...deltas].sort((a, b) => a.now - b.now)[0];
    // Nothing actually moved — say nothing rather than reporting "up 0". Scores
    // are floats, so the threshold is the smallest value that survives rounding
    // to one decimal; a +0.04 rise would otherwise render as "up 0".
    if (up.delta < 0.05) return null;
    return {
      up,
      down: down.delta < 0 && down.label !== up.label ? down : null,
      lowest: lowest.label !== up.label ? lowest.label : null,
    };
  }, [profile.current, profile.prior]);

  // Wait on stats too, or every work figure paints at the fallback bodyweight
  // and then jumps once the real one lands (docs/LESSONS.md, and the same trap
  // BodyView's Volume currency hit).
  if (loading || statsLoading || historyLoading) return <LoadingScreen />;

  const {
    all,
    rpeRows,
    topMoves,
    cards,
    seriesFor,
    finished,
    doneSets,
    totalSeconds,
  } = derived;

  // The closed rows' headlines. Top lift: the first row of the list it opens,
  // with its change across the window (first logged e1RM to latest).
  const topLift = (() => {
    const first = cards[0];
    if (!first) return null;
    const pts = seriesFor.get(first[0]) ?? [];
    const delta = pts.length > 1 ? Math.round(pts[pts.length - 1].value - pts[0].value) : null;
    return { name: first[0], value: first[1], delta };
  })();
  // Effort: every RPE-tagged working set pooled. "8+" is buckets 8–10, the
  // same rounding the bars use.
  const rpeSummary = (() => {
    const n = rpeRows.reduce((a, r) => a + r.total, 0);
    if (n === 0) return null;
    const sum = rpeRows.reduce((a, r) => a + r.avg * r.total, 0);
    const hard = rpeRows.reduce((a, r) => a + r.dist[2] + r.dist[3] + r.dist[4], 0);
    return { avg: sum / n, hardPct: Math.round((hard / n) * 100) };
  })();


  // The one period control for the page. Rendered in the empty state too: an
  // empty 4W is exactly when you want to reach for 6M.
  const periodPicker = (
    <div className="mb-4">
      <SegmentedTabs
        tabs={TRAINING_PERIODS.map((p) => ({ key: p.key, label: p.label }))}
        active={periodKey}
        onChange={(k) => setPeriod(k as TrainingPeriodKey)}
        ariaLabel="Period"
        size="sm"
      />
    </div>
  );

  if (all.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 pb-8 pt-5 sm:px-6">
        <EchoText
          text="STATS"
          as="h1"
          className={`mb-6 ${ECHO_APP_TITLE}`}
        />
        {periodPicker}
        <EmptyState>No sessions in the last {periodPhrase(periodKey)}.</EmptyState>
      </div>
    );
  }

  return (
    <>
      {/* No page title here: the Stats / Body / Coach tabs above already say
          where you are, and the title plus a two-line display headline cost
          ~200px before the first chart. The headline's content now leads the
          radar card, under the window toggle that changes it. */}
      <PageStagger className="mx-auto max-w-3xl px-4 pb-8 pt-5 sm:px-6">
        <Item>{periodPicker}</Item>
        <Item>
          <FitnessProfile profile={profile} movers={movers} />
        </Item>

        <Item>
          <section className="mb-6">
            <StatStrip
              stats={[
                { label: 'Sessions', value: finished.length },
                { label: 'Time', value: formatDuration(totalSeconds) },
                { label: 'Sets', value: doneSets },
              ]}
            />
            {mix ? (
              <div className="mt-2">
                {/* Where the window's time actually went. Monochrome by design:
                    greys plus the labels carry it, and a hue set would have to
                    be defended against every activity colour already on the
                    page. Segments below 4% keep their sliver so the rail always
                    sums to the whole. */}
                <div className="flex h-1.5 overflow-hidden rounded-full bg-fg/10">
                  {mix.map((m, i) => (
                    <span
                      key={m.key}
                      className={MIX_SHADES[i] ?? MIX_SHADES[MIX_SHADES.length - 1]}
                      style={{ width: `${Math.max(m.pct, m.pct > 0 ? 1.5 : 0)}%` }}
                    />
                  ))}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.65rem] text-muted">
                  {mix.map((m, i) => (
                    <span key={m.key} className="inline-flex items-center gap-1">
                      <span
                        aria-hidden
                        className={`inline-block h-2 w-2 rounded-[1px] ${
                          MIX_SHADES[i] ?? MIX_SHADES[MIX_SHADES.length - 1]
                        }`}
                      />
                      {m.label} {Math.round(m.pct)}%
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {mode === 'app' ? (
              // The Adherence tile that used to sit in this strip measured
              // against the log document, not the plan, so it could only ever
              // read ~100. The real one needs the plan and its whole history,
              // which `history` already is. The number is the answer; the link
              // is only for the per-movement table on /app/plan.
              <a
                href="/app/plan"
                className="-my-3 mt-0 inline-flex min-h-11 items-center text-[0.7rem] tabular-nums text-muted underline"
              >
                {adherence ? `${adherenceText(adherence)} →` : 'Plan adherence →'}
              </a>
            ) : null}
          </section>
        </Item>

        <Item>
          <section className="mb-6">
            <SectionHeader>
              Consistency{gridCapped ? ` · Last ${GRID_WEEKS} weeks` : ''}
            </SectionHeader>
            <ConsistencyGrid
              weekStarts={gridCols.weekStarts}
              weekFoot={gridCols.weekFoot}
              dayMap={grid.dayMap}
              visible={visibleWeeks}
              todayKey={ymd(today)}
              onTip={showTip}
            />
            <p className="mt-2 text-[0.65rem] text-muted">
              Under each week: time, then the highest max HR logged (bpm).
              Colored by activity · striped = several activities. Bars: lifting blocks on top,
              conditioning blocks below, vs your usual best for that kind of session, your{' '}
              {Math.round(CONSISTENCY.referencePercentile * 100)}th percentile all time; dotted
              until there are {CONSISTENCY.minSessions} to compare. Tap a day for detail.
            </p>
          </section>
        </Item>

        {/* Real analysis most visits do not need on arrival, as one card of
            rows that each state their answer while closed — the single "More
            detail" fold said nothing until tapped. The weekly table it held is
            gone: the grid's columns are the same weeks, and their time
            and max HR now sit under them. Native <details>, so no JS state. */}
        <Item>
            {/* `empty:hidden`: with no lifts, no RPE and no Garmin rows every
                child renders null, and the card would be a bare 2px outline. */}
            <div className="lift overflow-hidden border border-border bg-surface empty:hidden [&>details:first-child]:border-t-0">
              {topLift ? (
                <Disclosure
                  variant="row"
                  title="Top lifts"
                  headerRight={
                    <span>
                      <span className="capitalize">{topLift.name}</span> {formatRound(topLift.value)} kg{' '}
                      {topLift.delta ? <Delta value={topLift.delta} /> : null}
                    </span>
                  }
                >
                  <div className="mb-2 flex justify-end">
                    <div className="w-48">
                      <SegmentedTabs
                        tabs={[
                          { key: 'movement', label: 'Movement' },
                          { key: 'family', label: 'Family' },
                        ]}
                        active={groupBy}
                        onChange={(k) => setGroupBy(k as 'movement' | 'family')}
                        ariaLabel="Group top lifts by"
                        size="sm"
                      />
                    </div>
                  </div>
                  <ul className="-mx-3 -mb-3 flex flex-col gap-px bg-border-soft">
                    {cards.map(([name, value]) => {
                      const bw = bodyweightMultiple(value, stats);
                      return (
                        <li key={name} className="flex min-h-11 items-center gap-3 bg-surface px-3 py-2">
                          <span className="min-w-0 flex-1 truncate text-sm capitalize text-fg">{name}</span>
                          <Sparkline points={seriesFor.get(name) ?? []} />
                          <span className="w-12 shrink-0 text-right font-display text-sm tabular-nums text-fg">
                            {formatRound(value)}
                          </span>
                          {/* Only once bodyweight is on file — an absent stat
                              shows nothing rather than a placeholder. */}
                          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted">
                            {bw == null ? '' : `${formatRound(bw, 2)}×`}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </Disclosure>
              ) : null}

              {rpeSummary ? (
                <Disclosure
                  variant="row"
                  title="Effort"
                  headerRight={`avg RPE ${formatRound(rpeSummary.avg, 1)} · ${rpeSummary.hardPct}% at 8+`}
                >
                  <div className="flex flex-col gap-3 pt-1">
                    {rpeRows.map((r) => (
                      <div key={r.family} className="flex items-center gap-3 text-sm">
                        <div className="w-20 shrink-0 capitalize text-subtle">{r.family}</div>
                        <div className="flex h-3 flex-1 overflow-hidden bg-elevated">
                          {r.dist.map((count, i) =>
                            count > 0 ? (
                              <div
                                key={i}
                                className="h-full cursor-pointer"
                                data-tip-target
                                style={{
                                  width: `${(count / r.total) * 100}%`,
                                  backgroundColor: 'var(--color-fg)',
                                  opacity: 0.25 + (i / 4) * 0.75,
                                }}
                                onMouseMove={(e) =>
                                  showTip(
                                    e,
                                    `RPE ${RPE_BUCKETS[i]} · ${count} ${count === 1 ? 'set' : 'sets'} (${Math.round((count / r.total) * 100)}%)`,
                                  )
                                }
                              />
                            ) : null,
                          )}
                        </div>
                        <div className="w-8 shrink-0 text-right tabular-nums text-muted">
                          {formatRound(r.avg, 1)}
                        </div>
                      </div>
                    ))}
                  </div>
                </Disclosure>
              ) : null}

              {mode === 'app' ? <GarminHealthSection /> : null}
            </div>
        </Item>
      </PageStagger>

      {portalReady
        ? createPortal(
            <div
              aria-hidden={!tip?.shown}
              // Portaled to <body> and mounted ONCE, with the page, not on the
              // tap. It used to be created by the first tap as a `fixed` box
              // inside the [data-scroll-root] scroller, and on iPhone the first
              // tap after every visit to Progress flickered while later taps,
              // which only moved the existing box, did not. Sheets portal to
              // <body> for the same reason (docs/LESSONS.md). Opacity is the
              // only thing a tap changes; hiding is instant.
              //
              // Wraps, and the centre is clamped so the whole box stays on
              // screen. A nowrap line centred on the finger ran off the right
              // edge on the grid's last column. `pre-line` honours the label's
              // line break.
              className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full whitespace-pre-line bg-fg px-2 py-1 text-[0.7rem] leading-snug tabular-nums text-bg"
              style={{
                left: tip
                  ? Math.min(
                      Math.max(tip.x, TOOLTIP.maxWidthPx / 2 + TOOLTIP.edgePx),
                      window.innerWidth - TOOLTIP.maxWidthPx / 2 - TOOLTIP.edgePx,
                    )
                  : 0,
                top: tip ? tip.y - 8 : 0,
                width: 'max-content',
                maxWidth: TOOLTIP.maxWidthPx,
                opacity: tip?.shown ? 1 : 0,
                transition: tip?.shown ? 'opacity 0.15s var(--ease-editorial)' : 'none',
              }}
            >
              {tip?.label}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
