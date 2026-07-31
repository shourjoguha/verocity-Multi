import { useState } from 'react';
import { ASPECT_WINDOWS } from '@/app.config';
import { SectionHeader } from '@/components/ui/primitives';
import { RadarChart, type RadarSeries } from '@/components/RadarChart';
import { FitnessCheckIn } from '@/components/FitnessCheckIn';
import { AspectExplainer } from '@/components/AspectExplainer';
import type { AspectProfile } from '@/lib/useAspectProfile';

// Stats "Fitness profile" radar — presentation only. Every measurement, fetch
// and write-back lives in useAspectProfile; this file decides what the two
// overlaid series are and what to say when there is nothing to draw.
//
// Two toggles, answering different questions. The window toggle is the
// responsiveness control: a shorter window makes a single session move the shape
// (the displayed value has always rolled daily — window length was what made it
// feel inert). The compare toggle picks what the dashed series is: the previous
// block for "am I moving now", the oldest sample held for "am I better than I
// was". Read-only in showcase mode (no check-in button).
export function FitnessProfile({
  profile,
  canEdit,
}: {
  profile: AspectProfile;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [compare, setCompare] = useState<'prior' | 'earliest'>('prior');

  if (profile.loading) return null;

  const { current, prior, earliest, latestAssessment, windowKey, windowDays } = profile;
  const baseline = compare === 'earliest' && earliest ? earliest : prior;

  const series: RadarSeries[] = [];
  if (baseline) {
    series.push({
      label: baseline.label,
      scores: baseline.scores,
      metrics: baseline.metrics,
      variant: 'baseline',
    });
  }
  if (current) {
    series.push({
      label: current.label,
      scores: current.scores,
      metrics: current.metrics,
      confidence: current.confidence,
      variant: 'primary',
    });
  }

  const toggleClass = (on: boolean) =>
    `hill-btn flex min-h-11 items-center border bg-surface px-3 t-control transition-colors ${
      on ? 'border-fg text-fg' : 'border-border text-muted hover:text-fg'
    }`;

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <SectionHeader>Fitness profile</SectionHeader>
          <button
            type="button"
            onClick={() => setExplaining(true)}
            aria-label="How this chart is scored"
            className="flex h-11 w-11 items-center justify-center text-muted transition-colors hover:text-fg"
          >
            <span
              aria-hidden="true"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[0.7rem] leading-none"
            >
              !
            </span>
          </button>
        </div>
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
          <div className="mb-4 flex justify-center gap-1">
            {ASPECT_WINDOWS.map((w) => (
              <button
                key={w.key}
                type="button"
                aria-pressed={windowKey === w.key}
                onClick={() => profile.setWindowKey(w.key)}
                className={toggleClass(windowKey === w.key)}
              >
                {w.label}
              </button>
            ))}
          </div>

          <RadarChart series={series} />

          {profile.weeksUntilBaseline > 0 ? (
            <p className="mt-3 text-center text-xs text-muted">
              Still building your baseline — about {profile.weeksUntilBaseline} more{' '}
              {profile.weeksUntilBaseline === 1 ? 'week' : 'weeks'} of logging before these
              become scores.
            </p>
          ) : null}

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
                  className={toggleClass(compare === key)}
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

      <AspectExplainer
        open={explaining}
        onClose={() => setExplaining(false)}
        windowKey={windowKey}
        windowDays={windowDays}
        baselineSamples={profile.baselineSamples}
      />

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
