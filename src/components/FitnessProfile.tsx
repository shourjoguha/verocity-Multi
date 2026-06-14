import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { AspectScores, FitnessAssessment } from '@/lib/types';
import { getAssessments } from '@/lib/queries';
import { formatDate } from '@/lib/format';
import { SectionHeader } from '@/components/ui/primitives';
import { RadarChart, type RadarSeries } from '@/components/RadarChart';
import { FitnessCheckIn } from '@/components/FitnessCheckIn';

// Stats "Fitness profile" section: a radar of the latest self-assessment,
// overlaid against the earliest snapshot as a progress baseline. `suggestions`
// are computed from logged training (hybrid seed for the check-in). Read-only in
// showcase mode (no check-in button).
export function FitnessProfile({
  suggestions,
  canEdit,
  client = supabase,
}: {
  suggestions: AspectScores;
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
  const baseline = assessments.length > 1 ? assessments[assessments.length - 1] : undefined;

  const series: RadarSeries[] = [];
  if (baseline) {
    series.push({ label: formatDate(baseline.taken_at), scores: baseline.scores, variant: 'baseline' });
  }
  if (latest) {
    series.push({
      label: baseline ? `${formatDate(latest.taken_at)} (now)` : formatDate(latest.taken_at),
      scores: latest.scores,
      variant: 'primary',
    });
  }

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between gap-3">
        <SectionHeader>Fitness profile</SectionHeader>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="hill-btn border border-border bg-surface px-3 py-1 text-[0.65rem] uppercase tracking-wider text-fg transition-colors hover:border-fg"
          >
            {latest ? 'Update' : 'Check in'}
          </button>
        ) : null}
      </div>

      {latest ? (
        <div className="lift border border-border bg-surface p-4">
          <RadarChart series={series} />
        </div>
      ) : (
        <p className="border border-border bg-surface p-6 text-center text-sm text-muted">
          {canEdit
            ? 'No check-in yet. Rate where you are today to start tracking progress across aspects of fitness.'
            : 'No fitness check-ins yet.'}
        </p>
      )}

      {canEdit ? (
        <FitnessCheckIn
          open={open}
          onClose={() => setOpen(false)}
          previous={latest?.scores ?? {}}
          suggestions={suggestions}
          onSaved={(a) => setAssessments((prev) => [a, ...(prev ?? [])])}
        />
      ) : null}
    </section>
  );
}
