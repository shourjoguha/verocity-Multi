// Owns the fitness radar's data: snapshots in, scores out.
//
// This exists so the radar's logic stops being smeared across three files. It
// used to live partly in StatsView (windows and legend labels), partly in
// aspects.ts (scores) and partly in FitnessProfile (the manual-axis merge),
// which is exactly how the override rule ended up letting a months-old check-in
// present itself as current. aspects.ts holds the pure maths; this holds the
// fetching and the write-back; FitnessProfile just draws what it is given.
//
// It is called from StatsView's top level rather than from inside
// FitnessProfile so its reads start on mount, in parallel with the log fetch.
// FitnessProfile does not render until logs have landed, so fetching from there
// waterfalled a second round trip behind the first.

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ASPECT_BACKFILL_MONTHS,
  ASPECT_BASELINE_MONTHS,
  ASPECT_WINDOW_DAYS,
  FITNESS_ASPECTS,
  type AspectKey,
} from '@/app.config';
import {
  applyAssessmentOverride,
  aspectWindows,
  buildBaselines,
  buildSnapshots,
  completedMonthEnds,
  computeAspectMetrics,
  logsInWindow,
  scoreAspects,
  windowEndingOn,
  type AspectScoring,
} from '@/lib/aspects';
import { formatDate } from '@/lib/format';
import { getAspectSnapshots, getAssessments, getLogsInRange, upsertAspectSnapshots } from '@/lib/queries';
import { useAuthedQuery } from '@/lib/useAuthedQuery';
import type {
  AspectMetrics,
  AspectScores,
  AspectSnapshot,
  FitnessAssessment,
  WorkoutLog,
} from '@/lib/types';

export interface AspectPeriod extends AspectScoring {
  /** Legend text, e.g. "Jun 1 – Jul 30". */
  label: string;
}

export interface AspectProfile {
  loading: boolean;
  /** A cold start is reconstructing history — say so rather than spinning. */
  building: boolean;
  current: AspectPeriod | null;
  /** The block immediately before `current`. */
  prior: AspectPeriod | null;
  /** The oldest stored snapshot, for a long-range comparison. */
  earliest: AspectPeriod | null;
  /** Seeds the check-in sliders; integers on ASPECT_SCALE. */
  suggestions: AspectScores;
  latestAssessment: FitnessAssessment | null;
  /** Fold a just-saved check-in in without waiting for a refetch. */
  onAssessmentSaved: (a: FitnessAssessment) => void;
}

const periodLabel = (w: { start: string; end: string }) =>
  `${formatDate(w.start)} – ${formatDate(w.end)}`;

export function useAspectProfile({
  logs,
  today,
  mode,
  client,
}: {
  logs: WorkoutLog[] | null;
  today: Date;
  mode: 'app' | 'showcase';
  client: SupabaseClient;
}): AspectProfile {
  const authed = mode === 'app';
  const windows = aspectWindows(today);
  const baselineFrom = windowEndingOn(
    windows.current.end,
    ASPECT_BASELINE_MONTHS * 31,
  ).start;

  const { data: fetchedSnapshots, loading: snapshotsLoading } = useAuthedQuery(
    () => getAspectSnapshots(baselineFrom, windows.current.end, client),
    { auth: authed, key: authed ? `aspects:snapshots:${ASPECT_BASELINE_MONTHS}m` : undefined },
  );
  const { data: assessments, loading: assessmentsLoading } = useAuthedQuery(
    () => getAssessments(client),
    { auth: authed, key: authed ? 'aspects:assessments' : undefined },
  );

  // Snapshots written during this session, merged over what was fetched.
  const [written, setWritten] = useState<{ period_end: string; metrics: AspectMetrics }[]>([]);
  const [building, setBuilding] = useState(false);
  // A check-in saved on this screen, folded in ahead of the fetched list (which
  // is newest-first) so the radar reflects it without a round trip.
  const [saved, setSaved] = useState<FitnessAssessment[]>([]);
  const onAssessmentSaved = (a: FitnessAssessment) => setSaved((prev) => [a, ...prev]);
  const allAssessments = [...saved, ...(assessments ?? [])];

  const stored = [
    ...(fetchedSnapshots ?? []).map((s: AspectSnapshot) => ({
      period_end: s.period_end,
      metrics: s.metrics,
    })),
    ...written,
  ];

  // Keep the stored history complete: reconstruct a cold start in one pass, or
  // top up the single month that has completed since the last visit. Showcase is
  // strictly read-only — it renders someone else's profile under the anon role.
  useEffect(() => {
    if (!authed || logs === null || fetchedSnapshots === null) return;

    const have = new Set(stored.map((s) => s.period_end));
    const missing = completedMonthEnds(today, ASPECT_BACKFILL_MONTHS).filter((e) => !have.has(e));
    if (missing.length === 0) return;

    // The newest completed month's 60-day window always falls inside the logs
    // Stats already fetched, so the common case costs no extra request.
    const coveredFrom = windows.prior.start;
    const needsFetch = missing.some((e) => windowEndingOn(e, ASPECT_WINDOW_DAYS).start < coveredFrom);

    let cancelled = false;
    (async () => {
      let source = logs;
      if (needsFetch) {
        setBuilding(true);
        const from = windowEndingOn(missing[0], ASPECT_WINDOW_DAYS).start;
        source = await getLogsInRange(from, windows.current.end, client);
      }
      const rows = buildSnapshots(source, missing, { seed: stored.map((s) => s.metrics) });
      if (rows.length > 0) await upsertAspectSnapshots(rows);
      if (cancelled) return;
      setWritten((prev) => [...prev, ...rows.map((r) => ({ period_end: r.period_end, metrics: r.metrics }))]);
      setBuilding(false);
    })();

    return () => {
      cancelled = true;
    };
    // Runs once each time the two inputs land; `stored` is derived from them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, logs, fetchedSnapshots]);

  const loading = snapshotsLoading || assessmentsLoading || logs === null;
  if (loading) {
    return {
      loading: true,
      building,
      current: null,
      prior: null,
      earliest: null,
      suggestions: {},
      latestAssessment: null,
      onAssessmentSaved,
    };
  }

  const baselines = buildBaselines(stored);
  const scored = (window: { start: string; end: string }): AspectPeriod | null => {
    const metrics = computeAspectMetrics(logsInWindow(logs, window), { end: window.end });
    if (Object.keys(metrics).length === 0) return null;
    const scoring = applyAssessmentOverride(
      scoreAspects(metrics, baselines),
      allAssessments,
      window.end,
    );
    return { label: periodLabel(window), ...scoring };
  };

  const current = scored(windows.current);
  const prior = scored(windows.prior);

  // Long-range comparison: the oldest month we hold, scored against the same
  // baseline so the two polygons are on one scale.
  const oldest = [...stored].sort((a, b) => a.period_end.localeCompare(b.period_end))[0];
  const earliest =
    oldest && oldest.period_end < windows.prior.start
      ? {
          label: formatDate(oldest.period_end),
          ...applyAssessmentOverride(
            scoreAspects(oldest.metrics, baselines),
            allAssessments,
            oldest.period_end,
          ),
        }
      : null;

  // The check-in sliders are integers, so the seed has to be too.
  const suggestions: AspectScores = {};
  for (const aspect of FITNESS_ASPECTS) {
    const value = current?.scores[aspect.key as AspectKey];
    if (value != null) suggestions[aspect.key as AspectKey] = Math.round(value);
  }

  return {
    loading: false,
    building,
    current,
    prior,
    earliest,
    suggestions,
    latestAssessment: allAssessments[0] ?? null,
    onAssessmentSaved,
  };
}
