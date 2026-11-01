// A logged movement's sets, compressed for a glance (LogQuickView). The full
// per-set breakdown stays on the session page; this answers "what did I do"
// in one short line without wrapping mid-set.
//
// Consecutive sets that share everything but their primary count collapse into
// one run: the shared part is written once and the counts are listed —
// "15kg × 5, 5, 5, 4". Runs are joined by " · ". RPE is lifted out of the sets
// into a range on its own, and only where the athlete actually rated it: an
// untouched picker still carries RPE.default, which is not a rating.
import { UNITS } from '@/app.config';
import type { SetActual } from '@/lib/types';
import { formatDuration } from '@/lib/format';

export type SetSummary = { line: string; count: number; rpe: string | null };

const num = (n: number) => String(Number.isInteger(n) ? n : Math.round(n * 10) / 10);

const hasData = (a: SetActual) =>
  a.weight != null || a.reps != null || a.time != null || a.distance != null || a.calories != null || a.mark != null;

// The field that varies set to set, listed; everything else is the run's key.
type Varying = 'reps' | 'calories' | 'distance' | 'time' | 'mark';
const VARYING: Varying[] = ['reps', 'calories', 'distance', 'time', 'mark'];

const fmtVarying = (k: Varying, v: number) => (k === 'time' ? formatDuration(v) : num(v));
const suffix: Record<Varying, string> = { reps: '', calories: ' cal', distance: 'm', time: '', mark: 'cm' };

function split(a: SetActual): { key: string; varying: Varying | null; value: number | null; prefix: string; extras: string } {
  const varying = VARYING.find((k) => a[k] != null) ?? null;
  const value = varying ? (a[varying] as number) : null;
  const extras = VARYING.filter((k) => k !== varying && a[k] != null)
    .map((k) => `${fmtVarying(k, a[k] as number)}${suffix[k]}`)
    .join(' ');
  const prefix = a.weight != null ? `${num(a.weight)}${UNITS.weight} × ` : '';
  return { key: `${varying}|${prefix}|${extras}`, varying, value, prefix, extras };
}

export function summarizeSets(actuals: SetActual[]): SetSummary {
  const sets = actuals.filter(hasData);
  const runs: { key: string; varying: Varying | null; prefix: string; extras: string; values: number[] }[] = [];
  for (const a of sets) {
    const s = split(a);
    const last = runs[runs.length - 1];
    if (last && last.key === s.key) {
      if (s.value != null) last.values.push(s.value);
    } else {
      runs.push({ key: s.key, varying: s.varying, prefix: s.prefix, extras: s.extras, values: s.value != null ? [s.value] : [] });
    }
  }
  const line = runs
    .map((r) => {
      const list = r.varying ? r.values.map((v) => fmtVarying(r.varying!, v)).join(', ') : '';
      // Bare rep counts with no load read as nothing without a unit.
      const unit = r.varying === 'reps' && !r.prefix ? ' reps' : r.varying ? suffix[r.varying] : '';
      const head = r.prefix && !r.varying ? r.prefix.replace(/ × $/, '') : `${r.prefix}${list}${unit}`;
      return [head, r.extras].filter(Boolean).join(' · ');
    })
    .join(' · ');

  const rated = sets.filter((a) => a.rpeRated !== false && a.rpe != null).map((a) => a.rpe as number);
  const lo = Math.min(...rated);
  const hi = Math.max(...rated);
  const rpe = rated.length === 0 ? null : lo === hi ? `@${num(lo)}` : `@${num(lo)}–${num(hi)}`;

  return { line: line || '—', count: sets.length, rpe };
}
