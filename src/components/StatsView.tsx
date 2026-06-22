import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { supabase, supabasePublic } from '@/lib/supabase';
import { getLogsInRange } from '@/lib/queries';
import { useAuthedQuery } from '@/lib/useAuthedQuery';
import { showcaseRefDate } from '@/lib/showcase';
import type { WorkoutLog } from '@/lib/types';
import { e1rm } from '@/lib/e1rm';
import { flattenSets, familyOf, sessionVolume } from '@/lib/stats';
import { computeAspectSuggestions } from '@/lib/aspects';
import { formatDuration, formatRound } from '@/lib/format';
import { tagColor } from '@/lib/tags';
import { EmptyState, LoadingScreen, SectionHeader, StatCard } from '@/components/ui/primitives';
import { EchoText } from '@/components/EchoText';
import { FitnessProfile } from '@/components/FitnessProfile';
import { GarminHealthSection } from '@/components/GarminHealthSection';
import { EASE, Item, PageStagger } from '@/components/anim';

const WEEKS = 8;
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

export default function StatsView({ mode = 'app' }: { mode?: 'app' | 'showcase' }) {
  const client = mode === 'showcase' ? supabasePublic : supabase;
  const today = mode === 'showcase' ? showcaseRefDate() : new Date();
  const from = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (WEEKS * 7 - 1)),
  );
  const { data: logs, loading } = useAuthedQuery(
    () => getLogsInRange(ymd(from), ymd(today), client),
    { auth: mode === 'app', key: mode === 'app' ? 'stats:logs:8w' : undefined },
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

  if (loading) return <LoadingScreen />;
  const all: WorkoutLog[] = logs ?? [];

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
      volume: inWeek.reduce((a, l) => a + sessionVolume(l), 0),
    };
  });

  // Per-day activity map for the heatmap (key = ymd).
  type DayCell = { volume: number; activities: { color: string; label: string }[] };
  const dayMap = new Map<string, DayCell>();
  for (const log of all) {
    const key = log.log_date.slice(0, 10);
    const cur = dayMap.get(key) ?? { volume: 0, activities: [] };
    const label = log.tags[0] ?? log.activity_type ?? 'Session';
    cur.volume += sessionVolume(log);
    cur.activities.push({ color: tagColor(log.tags[0] ?? log.activity_type ?? ''), label });
    dayMap.set(key, cur);
  }
  const dayMax = Math.max(1, ...[...dayMap.values()].map((d) => d.volume));

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
  const aspectSuggestions = computeAspectSuggestions(all);

  if (all.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <EchoText
          text="STATS"
          as="h1"
          className="mb-6 font-display text-5xl font-bold uppercase leading-[0.9] tracking-[-0.04em] text-fg md:text-7xl"
        />
        <EmptyState>No sessions in the last {WEEKS} weeks.</EmptyState>
      </div>
    );
  }

  return (
    <>
      <PageStagger className="mx-auto max-w-3xl px-6 py-8">
        <Item>
          <EchoText
            text="STATS"
            as="h1"
            className="mb-6 font-display text-5xl font-bold uppercase leading-[0.9] tracking-[-0.04em] text-fg md:text-7xl"
          />
        </Item>

        <Item>
          <section className="mb-6 grid grid-cols-3 gap-px bg-border">
            <StatCard label="Sessions" value={all.length} />
            <StatCard label="Time" value={formatDuration(totalSeconds)} />
            <StatCard
              label="Adherence"
              value={adherence != null ? adherence : '—'}
              unit={adherence != null ? '%' : undefined}
            />
          </section>
        </Item>

        {mode === 'app' ? <GarminHealthSection /> : null}

        <Item>
          <FitnessProfile
            suggestions={aspectSuggestions}
            canEdit={mode === 'app'}
            client={client}
          />
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
                    const label = `${dateLabel} · ${cell.activities.map((a) => a.label).join(', ')} · ${formatRound(cell.volume)} kg`;
                    const multi = cell.activities.length > 1;
                    return (
                      <div
                        key={row}
                        className={`hill aspect-square cursor-pointer overflow-hidden ${multi ? 'flex flex-col' : ''}`}
                        style={
                          multi
                            ? undefined
                            : {
                                backgroundColor: cell.activities[0].color,
                                opacity: 0.3 + (cell.volume / dayMax) * 0.7,
                              }
                        }
                        onMouseMove={(e) => showTip(e, label)}
                      >
                        {multi
                          ? cell.activities.map((a, i) => (
                              <div key={i} className="flex-1" style={{ backgroundColor: a.color }} />
                            ))
                          : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="mt-2 text-[0.65rem] text-muted">
              Colored by activity · intensity by volume · striped days had multiple activities.
            </p>
          </section>
        </Item>

        <Item>
          <section className="mb-6">
            <SectionHeader>Weekly</SectionHeader>
            <table className="w-full border border-border bg-surface text-sm">
              <thead>
                <tr className="t-label text-muted">
                  <th className="border-b border-border px-3 py-2 text-left font-medium">Week</th>
                  <th className="border-b border-border px-3 py-2 text-right font-medium">Sessions</th>
                  <th className="border-b border-border px-3 py-2 text-right font-medium">Time</th>
                  <th className="border-b border-border px-3 py-2 text-right font-medium">Volume</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {weekRows.map((w) => (
                  <tr key={w.label} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-subtle">{w.label}</td>
                    <td className="px-3 py-2 text-right text-fg">{w.count}</td>
                    <td className="px-3 py-2 text-right text-fg">{formatDuration(w.seconds)}</td>
                    <td className="px-3 py-2 text-right text-fg">{formatRound(w.volume)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </Item>

        {rpeRows.length > 0 ? (
          <Item>
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
          </Item>
        ) : null}

        {topMoves.length > 0 ? (
          <Item>
            <section>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-fg">
                  Top {groupBy === 'family' ? 'families' : 'movements'} (e1RM)
                </h2>
                <div className="t-label flex gap-1">
                  {(['movement', 'family'] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGroupBy(g)}
                      aria-pressed={groupBy === g}
                      className={`hill-btn border bg-surface px-2 py-1 transition-colors ${
                        groupBy === g ? 'border-fg text-fg' : 'border-border text-muted hover:text-fg'
                      }`}
                    >
                      {g === 'movement' ? 'Movement' : 'Family'}
                    </button>
                  ))}
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
                      </span>
                    </div>
                    <div className="mt-3">
                      <Sparkline points={seriesFor.get(name) ?? []} onHover={showTip} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </Item>
        ) : null}
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
