import { describe, it, expect } from 'vitest';
import { METRICS, PRIMARY_METRICS, WEIGHTED_PRIMARIES, type MetricKey } from '@/app.config';
import { DEFAULT_PRIMARY_METRIC, isPrimaryMetric, showsWeightField } from '@/lib/metrics';

describe('primary metrics', () => {
  it('offers only the four that make sense as a primary', () => {
    expect([...PRIMARY_METRICS]).toEqual(['reps', 'time', 'distance', 'cal']);
  });

  // The whole point of the rework: weight stopped being the only way to record
  // load, and rpe never rendered a primary field at all.
  it('does not offer weight or rpe as a primary', () => {
    expect(isPrimaryMetric('weight')).toBe(false);
    expect(isPrimaryMetric('rpe')).toBe(false);
  });

  // ...but both must stay valid MetricKeys, or every plan, session and log that
  // already names one as its primaryMetric stops resolving.
  it('keeps weight and rpe as real per-set metrics', () => {
    expect(METRICS.weight).toBeDefined();
    expect(METRICS.rpe).toBeDefined();
  });

  it('defaults a new movement to reps, never to weight', () => {
    expect(DEFAULT_PRIMARY_METRIC).toBe('reps');
    expect(isPrimaryMetric(DEFAULT_PRIMARY_METRIC)).toBe(true);
  });
});

describe('the always-on weight field', () => {
  it('offers weight on every primary that can carry load', () => {
    for (const m of WEIGHTED_PRIMARIES) expect(showsWeightField(m)).toBe(true);
  });

  // A loaded carry is distance + weight; a weighted plank is time + weight. Both
  // were impossible before, because load lived only inside the `weight` metric.
  it('offers weight on distance and time, not just reps', () => {
    expect(showsWeightField('distance')).toBe(true);
    expect(showsWeightField('time')).toBe(true);
  });

  // An erg scores calories against its own resistance — there is no plate to name.
  it('does not offer weight on calories', () => {
    expect(showsWeightField('cal')).toBe(false);
  });

  // A movement stored before the rework keeps rendering the field it was logged
  // with, rather than silently losing its load.
  it('still offers weight on a legacy weight-primary row', () => {
    expect(showsWeightField('weight')).toBe(true);
  });

  it('every weighted primary is itself offerable as a primary', () => {
    for (const m of WEIGHTED_PRIMARIES) expect(isPrimaryMetric(m as MetricKey)).toBe(true);
  });
});
