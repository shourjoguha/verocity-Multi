import { METRICS, PRIMARY_METRICS, WEIGHTED_PRIMARIES, type MetricKey } from '@/app.config';

// Small shared helpers for the metric model, so the Logger, the movement library
// and the session editor cannot drift on what "primary" means.
//
// `weight` and `rpe` deliberately remain valid MetricKeys: they are still per-set
// fields, and plans, sessions and logs authored before the rework still name them
// as a primaryMetric. Nothing here rejects a stored value — these only decide
// what is OFFERED and what the entry sheet renders.

/** The primary a new movement gets, and the fallback when none is known. */
export const DEFAULT_PRIMARY_METRIC: MetricKey = 'reps';

/** May this metric be chosen as a movement's primary? */
export function isPrimaryMetric(metric: MetricKey): boolean {
  return (PRIMARY_METRICS as readonly string[]).includes(metric);
}

/**
 * Does this primary show the always-on weight field?
 *
 * True for reps/time/distance — a squat, a loaded carry and a weighted plank all
 * take external load. Also true for a legacy `weight`-primary row, so an old
 * movement keeps rendering its load rather than losing the field it was logged
 * with.
 */
export function showsWeightField(metric: MetricKey): boolean {
  return (WEIGHTED_PRIMARIES as readonly string[]).includes(metric) || metric === 'weight';
}

/** The metrics offered in a picker, newest model first, as {key,label} pairs. */
export const PRIMARY_METRIC_OPTIONS = PRIMARY_METRICS.map((key) => ({
  key,
  label: METRICS[key].label,
}));
