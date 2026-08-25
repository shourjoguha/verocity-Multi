import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { supabase, supabasePublic } from '@/lib/supabase';
import { getLogsInRange, getUserStats } from '@/lib/queries';
import { bodyweightMultiple } from '@/lib/userStats';
import { useAuthedQuery } from '@/lib/useAuthedQuery';
import { useAspectProfile } from '@/lib/useAspectProfile';
import type { WorkoutLog } from '@/lib/types';
import { e1rm } from '@/lib/e1rm';
import { flattenSets, familyOf } from '@/lib/stats';
import {
  addWork,
  formatWork,
  sessionWork,
  workBodyWeight,
  workIntensity,
  workMaxima,
  WORK_UNIT,
  ZERO_WORK,
  type WorkTotals,
} from '@/lib/work';
import { summarizeBodyLoad } from '@/lib/bodyLoad';
import { aspectWindows, logsInWindow } from '@/lib/aspects';
import { formatDuration, formatRound } from '@/lib/format';
import { sessionTagColors, stripeBackground } from '@/lib/tags';
import { ASPECT_WINDOW_DAYS, BODY_LENSES, BODY_LENS_KEYS, FITNESS_ASPECTS } from '@/app.config';
import {
  EmptyState,
  LoadingScreen,
  SectionHeader,
  StatStrip,
  Takeaway,
} from '@/components/ui/primitives';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { Disclosure } from '@/components/ui/Disclosure';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
import { FitnessProfile } from '@/components/FitnessProfile';
import { GarminHealthSection } from '@/components/GarminHealthSection';
import { EASE, Item, PageStagger } from '@/components/anim';

const WEEKS = 8;

// Both lanes, named. The old label printed one summed figure, which is the
// number `workIntensity` exists to stop anyone reading as meaningful.
function workLabel(work: WorkTotals): string {
  const parts: string[] = [];
  if (work.resistance > 0) parts.push(`${formatWork(work.resistance)} lifting`);
  if (work.cardio > 0) parts.push(`${formatWork(work.cardio)} cardio`);
  return parts.length > 0 ? `${parts.join(' · ')} ${WORK_UNIT}` : 'no work logged';
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

// e1RM sparkline: area fill + line draw-in, with per-point hover hit-areas
// rendered as HTML overlay (so they don't distort with the stretched SVG).
function Sparkline({
  points,
  onHover,
}: {
  points: Point[];
  onHover: (e: { clientX: number; clientY: number }, label: string) => void;
}) {
  if (points.length === 0) return null;
  const H = 44;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const n = points.length;
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => H - 4 - ((v - min) / span) * (H - 8);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ');
  const area = `${line} L100,${H} L0,${H} Z`;

  return (
    <div className="relative">
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="block h-11 w-full">
        <motion.path
          d={area}
          fill="var(--color-fg)"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 0.07 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: EASE }}
        />
        <motion.path
          d={line}
          fill="none"
          stroke="var(--color-fg)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.9, ease: EASE }}
        />
      </svg>
      <div className="absolute inset-0 flex">
        {points.map((p, i) => (
          <button
            key={i}
            type="button"
            aria-label={`${p.date}: ${formatRound(p.value)} kg`}
            className="h-full flex-1 cursor-pointer"
            onMouseMove={(e) => onHover(e, `${p.date} · ${formatRound(p.value)} kg`)}
            onFocus={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onHover({ clientX: r.left + r.width / 2, clientY: r.top }, `${p.date} · ${formatRound(p.value)} kg`);
            }}
          />
        ))}
      </div>
    </div>
  );
}

// Everything on this page except the radar reads the 8-week window it always
// read — the wider fetch is for the radar's baseline alone, and must not quietly
// restate the tiles, bars, RPE fingerprint and heatmap over 120 days.
//
// Extracted from the render body and memoised by the caller. It used to run
// inline on every render, so hovering a sparkline point re-derived every bucket,
// map and series over 120 days of LogDocument JSONB just to move a tooltip.
// How the window's MINUTES split across strength / cardio / mobility, for the
// small proportion bar under the tiles. Reuses BODY_LENSES (the same split the
// body map uses) so "kind of work" means one thing across the app, and reads
// modalityMinutes off summarizeBodyLoad rather than re-deriving. Unmapped work
// has no modality and is simply absent — this is a share of CLASSIFIED time, not
// of the wall clock. Returns null when nothing classified, so the bar hides
// rather than rendering an empty rail.
function modalityMix(logs: WorkoutLog[]): { key: string; label: string; pct: number }[] | null {
  const body = summarizeBodyLoad(logs);
  const parts = BODY_LENS_KEYS.map((key) => ({
    key,
    label: BODY_LENSES[key].label,
    minutes: BODY_LENSES[key].modalities.reduce(
      (sum, m) => sum + (body.modalityMinutes[m as keyof typeof body.modalityMinutes] ?? 0),
      0,
    ),
  }));
  const total = parts.reduce((sum, p) => sum + p.minutes, 0);
  if (total <= 0) return null;
  return parts.map(({ key, label, minutes }) => ({ key, label, pct: (minutes / total) * 100 }));
}

function deriveStats(
  fetched: WorkoutLog[],
  today: Date,
  groupBy: 'movement' | 'family',
  bodyWeightKg: number,
) {
  const eightWeeksAgo = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (WEEKS * 7 - 1)),
  );
  const all: WorkoutLog[] = logsInWindow(fetched, {
    start: ymd(eightWeeksAgo),
    end: ymd(today),
  });

  // Week buckets (oldest → newest).
  const thisMonday = mondayOf(today);
  const weekStarts = Array.from({ length: WEEKS }, (_, i) => {
    const d = new Date(thisMonday);
    d.setUTCDate(thisMonday.getUTCDate() - (WEEKS - 1 - i) * 7);
    return d;
  });

  const weekRows = weekStarts.map((start) => {
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    const inWeek = all.filter((l) => {
      const d = l.log_date.slice(0, 10);
      return d >= ymd(start) && d <= ymd(end);
    });
    return {
      label: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      count: inWeek.length,
      seconds: inWeek.reduce((a, l) => a + (l.total_seconds ?? 0), 0),
      work: inWeek.reduce((a, l) => addWork(a, sessionWork(l, bodyWeightKg)), ZERO_WORK),
    };
  });

  // Per-day activity map for the heatmap (key = ymd). `colors` is the day's
  // DISTINCT activity colors — a day is striped when it genuinely mixed
  // activities, so two strength sessions read as one solid strength cell while a
  // single session tagged strength + mobility reads as two stripes. Using
  // sessionTagColors (not tags[0]) is what makes the second case work.
  type DayCell = { work: WorkTotals; labels: string[]; colors: string[] };
  const dayMap = new Map<string, DayCell>();
  for (const log of all) {
    const key = log.log_date.slice(0, 10);
    const cur = dayMap.get(key) ?? { work: ZERO_WORK, labels: [], colors: [] };
    cur.work = addWork(cur.work, sessionWork(log, bodyWeightKg));
    cur.labels.push(log.tags[0] ?? log.activity_type ?? 'Session');
    for (const c of sessionTagColors(log.tags, log.activity_type)) {
      if (!cur.colors.includes(c)) cur.colors.push(c);
    }
    dayMap.set(key, cur);
  }
  // Each lane is normalised against ITS OWN maximum, so the rail answers "how
  // big was this day for its kind" rather than "how big against a bike ride".
  // See `workIntensity` for why summing the two was wrong.
  const dayMax = workMaxima([...dayMap.values()].map((d) => d.work));

  // RPE fingerprint: distribution across RPE buckets, per movement family.
  const fam = new Map<string, { dist: number[]; sum: number; n: number }>();
  for (const log of all) {
    for (const s of flattenSets(log)) {
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
    for (const s of flattenSets(log)) {
      if (s.weight == null || s.reps == null) continue;
      const est = e1rm(s.weight, s.reps);
      if (est == null) continue;
      bestThis.set(s.movement, Math.max(bestThis.get(s.movement) ?? 0, est));
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

  // Adherence: completed sets / total sets across the window.
  let totalSets = 0;
  let doneSets = 0;
  for (const log of all) {
    for (const s of flattenSets(log)) {
      totalSets += 1;
      if (s.completed) doneSets += 1;
    }
  }
  const adherence = totalSets ? Math.round((doneSets / totalSets) * 100) : null;

  const totalSeconds = all.reduce((a, l) => a + (l.total_seconds ?? 0), 0);

  return {
    all,
    weekStarts,
    weekRows,
    dayMap,
    dayMax,
    rpeRows,
    topMoves,
    cards,
    seriesFor,
    adherence,
    totalSeconds,
  };
}

export default function StatsView({ mode = 'app' }: { mode?: 'app' | 'showcase' }) {
  const client = mode === 'showcase' ? supabasePublic : supabase;
  // Real "now" on both surfaces — the showcase is live (migration 0034).
  const today = new Date();
  // The radar compares the rolling aspect window against the block before it, so
  // the fetch spans both — wider than the 8 weeks the rest of this page reads.
  const windows = aspectWindows(today);
  // Cache key names the window: with the old 8-week key a revisit would paint a
  // cached 56-day array on the first frame (useAuthedQuery seeds synchronously)
  // and the radar would compute over the wrong span until revalidation landed.
  const { data: logs, loading } = useAuthedQuery(
    () => getLogsInRange(windows.prior.start, windows.current.end, client),
    {
      auth: mode === 'app',
      key: mode === 'app' ? `stats:logs:${ASPECT_WINDOW_DAYS * 2}d` : undefined,
    },
  );

  // The radar's own reads start here, alongside the log fetch rather than behind
  // it — FitnessProfile does not mount until logs land, so fetching from inside
  // it waterfalled a second round trip.
  const profile = useAspectProfile({ logs, today, mode, client });

  // Bodyweight, for the ×BW multiples on the e1RM cards. Null in showcase mode
  // (no anon policy on user_stats) and null for anyone who has not filled it in,
  // in which case the multiple simply is not rendered.
  const { data: stats, loading: statsLoading } = useAuthedQuery(
    () => (mode === 'app' ? getUserStats() : Promise.resolve(null)),
    { auth: mode === 'app', key: mode === 'app' ? 'userStats' : undefined },
  );

  const [tip, setTip] = useState<{ x: number; y: number; label: string } | null>(null);
  const [groupBy, setGroupBy] = useState<'movement' | 'family'>('movement');
  const tipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function showTip(e: { clientX: number; clientY: number }, label: string) {
    setTip({ x: e.clientX, y: e.clientY, label });
    clearTimeout(tipTimer.current);
    tipTimer.current = setTimeout(() => setTip(null), 2000);
  }
  useEffect(() => () => clearTimeout(tipTimer.current), []);

  // `today` is intentionally out of the dep list: in app mode it is a fresh Date
  // on every render, and re-deriving 8 weeks of buckets because the clock moved a
  // millisecond is the cost this memo exists to avoid.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bodyWeightKg = workBodyWeight(stats ?? null);
  const derived = useMemo(
    () => deriveStats(logs ?? [], today, groupBy, bodyWeightKg),
    [logs, groupBy, bodyWeightKg],
  );

  // Kept before the loading guard: hooks must not sit behind an early return.
  const mix = useMemo(() => modalityMix(derived.all), [derived]);

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
  if (loading || statsLoading) return <LoadingScreen />;

  const {
    all,
    weekStarts,
    weekRows,
    dayMap,
    dayMax,
    rpeRows,
    topMoves,
    cards,
    seriesFor,
    adherence,
    totalSeconds,
  } = derived;


  if (all.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 pb-8 pt-5 sm:px-6">
        <EchoText
          text="STATS"
          as="h1"
          className={`mb-6 ${ECHO_APP_TITLE}`}
        />
        <EmptyState>No sessions in the last {WEEKS} weeks.</EmptyState>
      </div>
    );
  }

  return (
    <>
      <PageStagger className="mx-auto max-w-3xl px-4 pb-8 pt-5 sm:px-6">
        <Item>
          <EchoText
            text="STATS"
            as="h1"
            className={`mb-6 ${ECHO_APP_TITLE}`}
          />
        </Item>

        {/* The headline the radar used to make you decode. Both movers are
            named in plain language before any chart appears; the radar below
            then shows the shape they belong to. Renders nothing until there is
            a prior period to compare against — an invented takeaway is worse
            than none. */}
        {movers ? (
          <Item>
            <section className="mb-6">
              <Takeaway
                lead={`${movers.up.label} up ${formatRound(movers.up.delta, 1)}.`}
                trail={
                  movers.down
                    ? `${movers.down.label} down ${formatRound(Math.abs(movers.down.delta), 1)}.`
                    : undefined
                }
                detail={`Against the previous ${profile.windowDays} days.${
                  movers.lowest ? ` ${movers.lowest} is now your lowest axis.` : ''
                }`}
              />
            </section>
          </Item>
        ) : null}

        <Item>
          <FitnessProfile profile={profile} canEdit={mode === 'app'} />
        </Item>

        <Item>
          <section className="mb-6">
            <StatStrip
              stats={[
                { label: 'Sessions', value: all.length },
                { label: 'Time', value: formatDuration(totalSeconds) },
                {
                  label: 'Adherence',
                  value: adherence != null ? adherence : '—',
                  unit: adherence != null ? '%' : undefined,
                },
              ]}
            />
            {mix ? (
              <div className="mt-2">
                {/* Where the window's time actually went. Monochrome by design:
                    three greys plus the labels carry it, and a hue set would
                    have to be defended against every activity colour already on
                    the page. Segments below 4% keep their sliver so the rail
                    always sums to the whole. */}
                <div className="flex h-1.5 overflow-hidden rounded-full bg-fg/10">
                  {mix.map((m, i) => (
                    <span
                      key={m.key}
                      className={i === 0 ? 'bg-fg/80' : i === 1 ? 'bg-fg/45' : 'bg-fg/25'}
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
                          i === 0 ? 'bg-fg/80' : i === 1 ? 'bg-fg/45' : 'bg-fg/25'
                        }`}
                      />
                      {m.label} {Math.round(m.pct)}%
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </Item>

        <Item>
          <section className="mb-6">
            <SectionHeader>Consistency</SectionHeader>
            <div className="flex gap-1">
              {weekStarts.map((ws, col) => (
                <div key={col} className="flex flex-1 flex-col gap-1">
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
                      return <div key={row} className="hill aspect-square bg-fg/[0.05]" />;
                    }
                    const label = `${dateLabel} · ${cell.labels.join(', ')} · ${workLabel(cell.work)}`;
                    // Stripes for a mixed day, a solid fill for one activity —
                    // and the volume intensity applies either way. The old
                    // multi-activity branch passed no style at all, so those
                    // days lost their shading and read as maximum volume.
                    const stripes = stripeBackground(cell.colors);
                    // Colour is IDENTITY, at full strength, so a strength day and
                    // a mobility day never converge on the same washed-out grey.
                    // The old `opacity: 0.3 + volume/dayMax * 0.7` folded amount
                    // into the hue's lightness, which is exactly what made two
                    // different activities hard to tell apart at low volume.
                    // Volume moves to its own channel: a hairline meter along the
                    // bottom edge, a monochrome LENGTH that cannot distort the
                    // colour above it. (Border-glow was the other candidate, but
                    // an inset box-shadow is a CLAUDE.md "never" in a component.)
                    const volPct = Math.round(workIntensity(cell.work, dayMax) * 100);
                    return (
                      <div
                        key={row}
                        className="hill relative aspect-square cursor-pointer overflow-hidden"
                        style={
                          stripes
                            ? { backgroundImage: stripes }
                            : { backgroundColor: cell.colors[0] }
                        }
                        onMouseMove={(e) => showTip(e, label)}
                      >
                        <span
                          aria-hidden
                          className="absolute inset-x-0 bottom-0 h-[3px] bg-bg/40"
                        >
                          <span
                            className="block h-full bg-fg/70"
                            style={{ width: `${volPct}%` }}
                          />
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="mt-2 text-[0.65rem] text-muted">
              Colored by activity · bottom bar is work done, against your biggest day of that
              kind · striped days had multiple activities.
            </p>
          </section>
        </Item>

        {/* Everything below is real analysis that most visits do not need on
            arrival. It is COLLAPSED, not removed: the weekly table, the RPE
            fingerprint, the per-movement e1RM sparklines with their
            Movement/Family toggle, and the Garmin recovery block all keep their
            current implementations and open in one tap. Native <details>, so
            no JS state and nothing to animate. */}
        <Item>
          <Disclosure title="More detail">
        <section className="mb-6">
            <SectionHeader>Weekly</SectionHeader>
            <table className="w-full border border-border bg-surface text-sm">
              <thead>
                <tr className="t-label text-muted">
                  <th className="border-b border-border px-3 py-2 text-left font-medium">Week</th>
                  <th className="border-b border-border px-3 py-2 text-right font-medium">Sessions</th>
                  <th className="border-b border-border px-3 py-2 text-right font-medium">Time</th>
                  <th className="border-b border-border px-3 py-2 text-right font-medium">Lifting</th>
                  <th className="border-b border-border px-3 py-2 text-right font-medium">Cardio</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {weekRows.map((w) => (
                  <tr key={w.label} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-subtle">{w.label}</td>
                    <td className="px-3 py-2 text-right text-fg">{w.count}</td>
                    <td className="px-3 py-2 text-right text-fg">{formatDuration(w.seconds)}</td>
                    <td className="px-3 py-2 text-right text-fg">{formatWork(w.work.resistance)}</td>
                    <td className="px-3 py-2 text-right text-fg">{formatWork(w.work.cardio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[0.65rem] text-muted">
              Work in {WORK_UNIT} — weight moved × how far. Lifting and cardio are not summed:
              they are the same unit, but a long run would swamp a lifting week.
            </p>
          </section>

        {rpeRows.length > 0 ? (
            <section className="mb-6">
              <SectionHeader>RPE fingerprint</SectionHeader>
              <div className="flex flex-col gap-3">
                {rpeRows.map((r) => (
                  <div key={r.family} className="flex items-center gap-3 text-sm">
                    <div className="w-20 shrink-0 capitalize text-subtle">{r.family}</div>
                    <motion.div
                      className="flex h-3 flex-1 overflow-hidden bg-elevated"
                      initial={{ scaleX: 0 }}
                      whileInView={{ scaleX: 1 }}
                      viewport={{ once: true, margin: '-5% 0px' }}
                      transition={{ duration: 0.7, ease: EASE }}
                      style={{ transformOrigin: 'left' }}
                    >
                      {r.dist.map((count, i) =>
                        count > 0 ? (
                          <div
                            key={i}
                            className="h-full cursor-pointer"
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
                    </motion.div>
                    <div className="w-8 shrink-0 text-right tabular-nums text-muted">
                      {formatRound(r.avg, 1)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
        ) : null}

        {topMoves.length > 0 ? (
            <section>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="t-label text-muted">
                  Top {groupBy === 'family' ? 'families' : 'movements'} (e1RM)
                </h2>
                <div className="w-48 shrink-0">
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
              <div className="grid gap-3 sm:grid-cols-2">
                {cards.map(([name, value]) => (
                  <div key={name} className="lift border border-border bg-surface p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate capitalize text-fg">{name}</span>
                      <span className="shrink-0 font-display text-lg tabular-nums tracking-tight text-fg">
                        {formatRound(value)}
                        <span className="ml-1 text-xs font-medium text-muted">kg</span>
                        {(() => {
                          // Only rendered once bodyweight is on file — an absent
                          // stat shows nothing rather than a placeholder.
                          const bw = bodyweightMultiple(value, stats);
                          return bw == null ? null : (
                            <span className="ml-2 text-xs font-medium text-muted">
                              {formatRound(bw, 2)}×BW
                            </span>
                          );
                        })()}
                      </span>
                    </div>
                    <div className="mt-3">
                      <Sparkline points={seriesFor.get(name) ?? []} onHover={showTip} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
        ) : null}

            {mode === 'app' ? <GarminHealthSection /> : null}
          </Disclosure>
        </Item>
      </PageStagger>

      <AnimatePresence>
        {tip ? (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full whitespace-nowrap bg-fg px-2 py-1 text-[0.7rem] tabular-nums text-bg"
            style={{ left: tip.x, top: tip.y - 8 }}
          >
            {tip.label}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
