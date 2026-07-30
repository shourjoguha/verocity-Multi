import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { FITNESS_ASPECTS, type AspectKey } from '@/app.config';
import type { AspectScores, FitnessAssessment } from '@/lib/types';
import { getAssessments } from '@/lib/queries';
import { SectionHeader } from '@/components/ui/primitives';
import { RadarChart, type RadarSeries } from '@/components/RadarChart';
import { FitnessCheckIn } from '@/components/FitnessCheckIn';

// Axes with no derivation from logged data (`auto: false`) — these come from the
// user's check-in. Read from config so adding a derivable axis there is enough.
const MANUAL_ASPECTS = FITNESS_ASPECTS.filter((a) => !a.auto).map((a) => a.key as AspectKey);

export type AspectPeriod = {
  // Legend text, e.g. "Jun 1 – Jul 30". Built by the caller, which owns the dates.
  label: string;
  // Window end as ymd — picks which check-in supplies the manual axes.
  endDate: string;
  // Derived scores for the `auto` axes over that window.
  scores: AspectScores;
};

// Stats "Fitness profile" radar. The derivable axes are recomputed from logs in
// the rolling window on every load — so the chart and its dates track the
// calendar without the user touching anything — and the two non-derivable axes
// (power, mobility) are overlaid from the newest check-in that predates each
// window's end, so the dashed baseline shows the earlier rating rather than
// repeating today's. Read-only in showcase mode (no check-in button).
export function FitnessProfile({
  current,
  prior,
  canEdit,
  client = supabase,
}: {
  current: AspectPeriod;
  prior: AspectPeriod | null;
  canEdit: boolean;
  client?: SupabaseClient;
}) {
  const [assessments, setAssessments] = useState<FitnessAssessment[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getAssessments(client).then(setAssessments);
  }, []);

  if (assessments === null) return null;

  const latest = assessments[0];

  // assessments arrive `taken_at desc`, so the first match is the newest one at
  // or before this window's end.
  const withManual = (scores: AspectScores, endDate: string): AspectScores => {
    const rated = assessments.find((a) => a.taken_at.slice(0, 10) <= endDate)?.scores;
    if (!rated) return scores;
    const out: AspectScores = { ...scores };
    for (const key of MANUAL_ASPECTS) {
      if (rated[key] != null) out[key] = rated[key];
    }
    return out;
  };

  const series: RadarSeries[] = [];
  if (prior) {
    series.push({
      label: prior.label,
      scores: withManual(prior.scores, prior.endDate),
      variant: 'baseline',
    });
  }
  series.push({
    label: current.label,
    scores: withManual(current.scores, current.endDate),
    variant: 'primary',
  });

  const hasData = Object.keys(current.scores).length > 0 || latest !== undefined;

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between gap-3">
        <SectionHeader>Fitness profile</SectionHeader>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="hill-btn flex min-h-11 items-center border border-border bg-surface px-3 t-control text-fg transition-colors hover:border-fg"
          >
            {latest ? 'Update' : 'Check in'}
          </button>
        ) : null}
      </div>

      {hasData ? (
        <div className="lift border border-border bg-surface p-4">
          <RadarChart series={series} />
        </div>
      ) : (
        <p className="border border-border bg-surface p-6 text-center text-sm text-muted">
          {canEdit
            ? 'No sessions or check-ins yet. Log a workout, or rate where you are today, to start tracking progress across aspects of fitness.'
            : 'No training or fitness check-ins yet.'}
        </p>
      )}

      {canEdit ? (
        <FitnessCheckIn
          open={open}
          onClose={() => setOpen(false)}
          previous={latest?.scores ?? {}}
          suggestions={current.scores}
          onSaved={(a) => setAssessments((prev) => [a, ...(prev ?? [])])}
        />
      ) : null}
    </section>
  );
}
