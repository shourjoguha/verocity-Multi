// Owns the fitness radar's data: snapshots in, scores out.
//
// This exists so the radar's logic stops being smeared across three files. It
// used to live partly in StatsView (windows and legend labels), partly in
// aspects.ts (scores) and partly in FitnessProfile (the manual-axis merge),
// which is how a months-old manual check-in once presented itself as current.
// aspects.ts holds the pure maths; this holds the fetching and the write-back;
// FitnessProfile just draws what it is given.
//
// Manual check-ins (fitness_assessments) are no longer read. They used to
// override the derived score on the axes they rated; with the check-in button
// gone, an override would be a number the user could neither see the source of
// nor change. The table and its rows are untouched.
//
// It is called from StatsView's top level rather than from inside
// FitnessProfile so its reads start on mount, in parallel with the log fetch.
// FitnessProfile does not render until logs have landed, so fetching from there
// waterfalled a second round trip.

import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ASPECT_BACKFILL_WEEKS,
  ASPECT_BASELINE_WEEKS,
  ASPECT_MIN_BASELINE,
  ASPECT_READ_DAYS,
  TRAINING_PERIODS,
} from '@/app.config';
import {
  aspectWindows,
  baselinesFor,
  buildSnapshots,
  completedWeekEnds,
  computeAspectMetrics,
  logsInWindow,
  scoreAspects,
  windowEndingOn,
  type AspectScoring,
} from '@/lib/aspects';
import { formatDate } from '@/lib/format';
import {
  getAspectSnapshots,
  getLogsInRange,
  getUserStats,
  upsertAspectSnapshots,
} from '@/lib/queries';
import { hrMaxFromAge, unweightedRepKg } from '@/lib/userStats';
import { useAuthedQuery } from '@/lib/useAuthedQuery';
import type { AspectMetrics, AspectSnapshot, WorkoutLog } from '@/lib/types';

export interface AspectPeriod extends AspectScoring {
  /** Legend text, e.g. "Jun 1 – Jul 30". */
  label: string;
}

/** One stored sample, narrowed to what scoring needs. */
type StoredSnapshot = { period_end: string; window_days: number; metrics: AspectMetrics };

export interface AspectProfile {
  loading: boolean;
  /** A cold start is reconstructing history — say so rather than spinning. */
  building: boolean;
  current: AspectPeriod | null;
  /** The block immediately before `current`. */
  prior: AspectPeriod | null;
  /** The oldest stored snapshot, for a long-range comparison. */
  earliest: AspectPeriod | null;
  /** The measurement window — the page's training period, in days. */
  windowDays: number;
  /** Weekly samples held for the selected window, and how many are still needed. */
  baselineSamples: number;
  weeksUntilBaseline: number;
}

const periodLabel = (w: { start: string; end: string }) =>
  `${formatDate(w.start)} – ${formatDate(w.end)}`;

// The window is not chosen here: it is the page's training period
// (lib/periodPrefs.ts), passed in by StatsView, so the radar always measures
// the same span as the tiles and the grid beside it.
export function useAspectProfile({
  logs,
  today,
  mode,
  client,
  windowDays,
}: {
  logs: WorkoutLog[] | null;
  today: Date;
  mode: 'app' | 'showcase';
  client: SupabaseClient;
  windowDays: number;
}): AspectProfile {
  const authed = mode === 'app';
  const windows = aspectWindows(today, windowDays);
  // Read span is anchored to the longest window so switching never refetches.
  const readEnd = aspectWindows(today, ASPECT_READ_DAYS).current.end;
  const baselineFrom = windowEndingOn(readEnd, ASPECT_BASELINE_WEEKS * 7).start;

  const { data: fetchedSnapshots, loading: snapshotsLoading } = useAuthedQuery(
    () => getAspectSnapshots(baselineFrom, readEnd, client),
    { auth: authed, key: authed ? `aspects:snapshots:${ASPECT_BASELINE_WEEKS}w` : undefined },
  );
  // Owner stats feed two metric inputs: bodyweight prices unweighted work, and
  // birth year supplies the HR ceiling. Not fetched in showcase mode —
  // `user_stats` has no anon policy — so the public radar uses the constants.
  const { data: stats, loading: statsLoading } = useAuthedQuery(
    () => (authed ? getUserStats() : Promise.resolve(null)),
    { auth: authed, key: authed ? 'userStats' : undefined },
  );

  // `useAuthedQuery` returns null both while loading and for a user who has no
  // stats row, so the LOADING FLAG is the only way to tell them apart — and the
  // difference matters: metrics computed before stats land would be priced at
  // the flat constant, and the write-back below would persist that as a
  // snapshot under the current metrics version. It would then sit in the
  // baseline forever, mispriced, with nothing on screen to show for it.
  const metricOpts = {
    unweightedKg: unweightedRepKg(stats),
    hrMaxFallback: hrMaxFromAge(stats, today) ?? undefined,
  };

  // Snapshots written during this session, merged over what was fetched.
  const [written, setWritten] = useState<StoredSnapshot[]>([]);
  const [building, setBuilding] = useState(false);

  const stored: StoredSnapshot[] = [
    ...(fetchedSnapshots ?? []).map((s: AspectSnapshot) => ({
      period_end: s.period_end,
      window_days: s.window_days,
      metrics: s.metrics,
    })),
    ...written,
  ];

  // Keep the stored history complete: reconstruct a cold start in one pass, or
  // top up the weeks that have completed since the last visit. EVERY window
  // length is maintained regardless of which is selected, so toggling is
  // instant and never scores a reading against the wrong series. Showcase is
  // strictly read-only — it renders someone else's profile under the anon role.
  useEffect(() => {
    // statsLoading is part of the gate, not an afterthought — see the note on
    // metricOpts. A snapshot written at the wrong price is permanent.
    if (!authed || logs === null || fetchedSnapshots === null || statsLoading) return;

    const weekEnds = completedWeekEnds(today, ASPECT_BACKFILL_WEEKS);
    const work = TRAINING_PERIODS.map((w) => {
      const have = new Set(
        stored.filter((s) => s.window_days === w.days).map((s) => s.period_end),
      );
      return { days: w.days, missing: weekEnds.filter((e) => !have.has(e)) };
    }).filter((w) => w.missing.length > 0);
    if (work.length === 0) return;

    // The most recent completed weeks fall inside the logs Stats already
    // fetched; only a genuine cold start needs to reach further back.
    const coveredFrom = aspectWindows(today, ASPECT_READ_DAYS).prior.start;
    const needsFetch = work.some((w) =>
      w.missing.some((e) => windowEndingOn(e, w.days).start < coveredFrom),
    );

    let cancelled = false;
    (async () => {
      let source = logs;
      if (needsFetch) {
        setBuilding(true);
        const from = work
          .map((w) => windowEndingOn(w.missing[0], w.days).start)
          .sort()[0];
        source = await getLogsInRange(from, readEnd, client);
      }
      const rows = work.flatMap((w) =>
        buildSnapshots(source, w.missing, {
          windowDays: w.days,
          seed: stored.filter((s) => s.window_days === w.days).map((s) => s.metrics),
          ...metricOpts,
        }),
      );
      if (rows.length > 0) await upsertAspectSnapshots(rows);
      if (cancelled) return;
      setWritten((prev) => [
        ...prev,
        ...rows.map((r) => ({
          period_end: r.period_end,
          window_days: r.window_days,
          metrics: r.metrics,
        })),
      ]);
      setBuilding(false);
    })();

    return () => {
      cancelled = true;
    };
    // Runs once each time the inputs land; `stored` is derived from them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, logs, fetchedSnapshots, statsLoading]);

  const forWindow = stored.filter((s) => s.window_days === windowDays);
  const baselineSamples = forWindow.length;
  const weeksUntilBaseline = Math.max(0, ASPECT_MIN_BASELINE - baselineSamples);

  // The two measured periods, memoised. At 6M each is 182 days of LogDocument
  // JSONB (~150ms together on a desktop, several times that on a phone), and
  // StatsView re-renders on every tooltip move — recomputing them there is
  // the cost its own deriveStats memo exists to avoid. Scoring against the
  // baseline stays per render: it is cheap and the baseline grows mid-session.
  const { unweightedKg, hrMaxFallback } = metricOpts;
  const measured = useMemo(() => {
    if (logs === null || statsLoading) return null;
    const measure = (window: { start: string; end: string }) => ({
      window,
      metrics: computeAspectMetrics(logsInWindow(logs, window), {
        end: window.end,
        windowDays,
        unweightedKg,
        hrMaxFallback,
      }),
    });
    return { current: measure(windows.current), prior: measure(windows.prior) };
    // `windows` is rebuilt every render; its end date and length are what it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, statsLoading, windowDays, windows.current.end, unweightedKg, hrMaxFallback]);

  const loading = snapshotsLoading || statsLoading || logs === null;
  if (loading || measured === null) {
    return {
      loading: true,
      building,
      current: null,
      prior: null,
      earliest: null,
      windowDays,
      baselineSamples,
      weeksUntilBaseline,
    };
  }

  const baselines = baselinesFor(stored, windowDays);
  const scored = ({
    window,
    metrics,
  }: {
    window: { start: string; end: string };
    metrics: AspectMetrics;
  }): AspectPeriod | null => {
    if (Object.keys(metrics).length === 0) return null;
    return { label: periodLabel(window), ...scoreAspects(metrics, baselines) };
  };

  const current = scored(measured.current);
  const prior = scored(measured.prior);

  // Long-range comparison: the oldest sample we hold for THIS window length,
  // scored against the same baseline so the two polygons are on one scale.
  const oldest = [...forWindow].sort((a, b) => a.period_end.localeCompare(b.period_end))[0];
  const earliest =
    oldest && oldest.period_end < windows.prior.start
      ? {
          label: formatDate(oldest.period_end),
          ...scoreAspects(oldest.metrics, baselines),
        }
      : null;

  return {
    loading: false,
    building,
    current,
    prior,
    earliest,
    windowDays,
    baselineSamples,
    weeksUntilBaseline,
  };
}
