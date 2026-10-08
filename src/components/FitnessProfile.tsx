import { useState } from 'react';
import { ASPECT_WINDOWS, type AspectWindowKey } from '@/app.config';
import { Delta } from '@/components/ui/primitives';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { RadarChart, type RadarSeries } from '@/components/RadarChart';
import { AspectExplainer } from '@/components/AspectExplainer';
import type { AspectProfile } from '@/lib/useAspectProfile';

/** The biggest riser and faller between the two periods (StatsView `movers`). */
export type ProfileMovers = {
  up: { label: string; delta: number };
  down: { label: string; delta: number } | null;
  lowest: string | null;
} | null;

// One decimal, as a number, so Delta prints "4.7" rather than "4.6999…".
const tenth = (v: number) => Math.round(v * 10) / 10;

// Stats "Fitness profile" radar — presentation only. Every measurement, fetch
// and write-back lives in useAspectProfile; this file decides what the two
// overlaid series are and what to say when there is nothing to draw.
//
// One card, read top to bottom: the window toggle (the control people use
// most, so it leads), the takeaway it produces, the shape, then a one-line
// legend whose comparison chip picks what the ghost series is — the previous
// block for "am I moving now", the oldest sample held for "am I better than I
// was". The scoring caption lives behind the (!) sheet, not under the chart.
export function FitnessProfile({
  profile,
  movers,
}: {
  profile: AspectProfile;
  movers: ProfileMovers;
}) {
  const [explaining, setExplaining] = useState(false);
  const [compare, setCompare] = useState<'prior' | 'earliest'>('prior');

  if (profile.loading) return null;

  const { current, prior, earliest, windowKey, windowDays } = profile;
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

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-1">
        <h2 className="t-label text-muted">Fitness profile</h2>
        <button
          type="button"
          onClick={() => setExplaining(true)}
          aria-label="How this chart is scored"
          className="-my-3 flex h-11 w-11 items-center justify-center text-muted transition-colors hover:text-fg"
        >
          <span
            aria-hidden="true"
            className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[0.7rem] leading-none"
          >
            !
          </span>
        </button>
      </div>

      {series.length > 0 ? (
        <div className="lift border border-border bg-surface">
          <div className="px-3 pt-3">
            <SegmentedTabs
              tabs={ASPECT_WINDOWS.map((w) => ({ key: w.key, label: w.label }))}
              active={windowKey}
              onChange={(k) => profile.setWindowKey(k as AspectWindowKey)}
              ariaLabel="Measurement window"
              size="sm"
              className="max-w-[16rem]"
            />
          </div>

          {/* The takeaway, under the toggle that changes it. Renders nothing
              until there is a prior period to compare against — an invented
              takeaway is worse than none. Compared with the PREVIOUS block
              always, whatever the chip below shows. */}
          {movers ? (
            <div className="px-3 pt-3">
              <p className="flex flex-wrap gap-x-3 text-sm font-bold text-fg">
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                  {movers.up.label} <Delta value={tenth(movers.up.delta)} />
                </span>
                {movers.down ? (
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    {movers.down.label} <Delta value={tenth(movers.down.delta)} />
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                vs the previous {windowDays} days
                {movers.lowest ? ` · ${movers.lowest} is now your lowest` : ''}
              </p>
            </div>
          ) : null}

          {profile.weeksUntilBaseline > 0 ? (
            <p className="px-3 pt-2 text-xs text-muted">
              Still building your baseline — about {profile.weeksUntilBaseline} more{' '}
              {profile.weeksUntilBaseline === 1 ? 'week' : 'weeks'} of logging before these
              become scores.
            </p>
          ) : null}

          <div className="px-6">
            <RadarChart series={series} />
          </div>

          <div className="flex items-center justify-between gap-3 px-3 pb-3 t-label text-muted">
            {current ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span aria-hidden="true" className="inline-block w-3 border-t-2 border-fg" />
                <span className="text-fg">Now</span>
                <span className="truncate text-subtle opacity-70 normal-case tracking-normal tabular-nums">
                  {current.label}
                </span>
              </span>
            ) : (
              <span />
            )}
            {baseline ? (
              earliest ? (
                <button
                  type="button"
                  onClick={() => setCompare(compare === 'prior' ? 'earliest' : 'prior')}
                  aria-label={`Comparing with ${baseline.label}. Switch to ${
                    compare === 'prior' ? earliest.label : (prior?.label ?? 'the previous block')
                  }`}
                  className="-my-3 inline-flex min-h-11 shrink-0 items-center rounded-control text-muted transition-colors hover:text-fg"
                >
                  <span className="inline-flex items-center gap-1.5 rounded-control border border-border px-1.5 py-1 normal-case tracking-normal tabular-nums">
                    <GhostSwatch />
                    vs {baseline.label}
                    <span aria-hidden="true">⇄</span>
                  </span>
                </button>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1.5 normal-case tracking-normal tabular-nums">
                  <GhostSwatch />
                  vs {baseline.label}
                </span>
              )
            ) : null}
          </div>
        </div>
      ) : (
        <p className="border border-border bg-surface p-6 text-center text-sm text-muted">
          {profile.building
            ? 'Building your baseline from your training history…'
            : 'No training logged yet.'}
        </p>
      )}

      <AspectExplainer
        open={explaining}
        onClose={() => setExplaining(false)}
        windowDays={windowDays}
        baselineSamples={profile.baselineSamples}
      />
    </section>
  );
}

// The comparison series is drawn as a soft area, so its legend key is one too.
function GhostSwatch() {
  return <span aria-hidden="true" className="inline-block h-2 w-2.5 rounded-[1px] bg-fg/15" />;
}
