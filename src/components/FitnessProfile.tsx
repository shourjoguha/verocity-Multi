import { useState } from 'react';
import { SectionHeader } from '@/components/ui/primitives';
import { RadarChart, type RadarSeries } from '@/components/RadarChart';
import { FitnessCheckIn } from '@/components/FitnessCheckIn';
import type { AspectProfile } from '@/lib/useAspectProfile';

// Stats "Fitness profile" radar — presentation only. Every measurement, fetch
// and write-back lives in useAspectProfile; this file decides what the two
// overlaid series are and what to say when there is nothing to draw.
//
// The baseline series is selectable because the two comparisons answer different
// questions: the previous block says "am I moving right now", the oldest stored
// snapshot says "am I better than I was". Read-only in showcase mode (no
// check-in button).
export function FitnessProfile({
  profile,
  canEdit,
}: {
  profile: AspectProfile;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [compare, setCompare] = useState<'prior' | 'earliest'>('prior');

  if (profile.loading) return null;

  const { current, prior, earliest, latestAssessment } = profile;
  const baseline = compare === 'earliest' && earliest ? earliest : prior;

  const series: RadarSeries[] = [];
  if (baseline) {
    series.push({ label: baseline.label, scores: baseline.scores, variant: 'baseline' });
  }
  if (current) {
    series.push({
      label: current.label,
      scores: current.scores,
      confidence: current.confidence,
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
            className="hill-btn flex min-h-11 items-center border border-border bg-surface px-3 t-control text-fg transition-colors hover:border-fg"
          >
            {latestAssessment ? 'Update' : 'Check in'}
          </button>
        ) : null}
      </div>

      {series.length > 0 ? (
        <div className="lift border border-border bg-surface p-4">
          <RadarChart series={series} />
          {earliest ? (
            <div className="mt-3 flex items-center justify-center gap-2">
              <span className="t-control text-subtle">Compare to</span>
              {(
                [
                  ['prior', prior?.label ?? 'Previous block'],
                  ['earliest', earliest.label],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={compare === key}
                  onClick={() => setCompare(key)}
                  className={`hill-btn flex min-h-11 items-center border bg-surface px-3 t-control transition-colors ${
                    compare === key ? 'border-fg text-fg' : 'border-border text-muted hover:text-fg'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="border border-border bg-surface p-6 text-center text-sm text-muted">
          {profile.building
            ? 'Building your baseline from your training history…'
            : canEdit
              ? 'No sessions or check-ins yet. Log a workout, or rate where you are today, to start tracking progress across aspects of fitness.'
              : 'No training or fitness check-ins yet.'}
        </p>
      )}

      {canEdit ? (
        <FitnessCheckIn
          open={open}
          onClose={() => setOpen(false)}
          previous={latestAssessment?.scores ?? {}}
          suggestions={profile.suggestions}
          onSaved={profile.onAssessmentSaved}
        />
      ) : null}
    </section>
  );
}
