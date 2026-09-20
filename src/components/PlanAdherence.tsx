// The plan-adherence breakdown: one bar, one table, behind a Disclosure.
//
// Lives on /app/plan rather than /app/stats because it is a question about the
// PLAN's whole life, and Stats reads a rolling 8-week window. A plan in week 12
// has history the Stats fetch never loaded.
//
// Collapsed, the header still carries the headline percentage — the number is
// the point, and the table is the detail behind it.

import type { AdherenceRow, PlanAdherence as Adherence } from '@/lib/planAdherence';
import { Disclosure } from '@/components/ui/Disclosure';

// The bands, in the order they stack. Monochrome per the chrome rule — this is
// not a delta and not an activity, so it takes no hue. Each band is also
// labelled and numbered under the bar, so the greys never carry it alone.
const BANDS = [
  { key: 'exact', label: 'As written', shade: 'bg-fg/80' },
  { key: 'swap', label: 'Swapped', shade: 'bg-fg/45' },
  { key: 'makeUp', label: 'Made up later', shade: 'bg-fg/25' },
  { key: 'missed', label: 'Missed', shade: 'bg-fg/10' },
] as const;

function RowLine({ row }: { row: AdherenceRow }) {
  return (
    <tr className="border-b border-border-soft last:border-0">
      <td className="py-2 pr-3 align-top min-w-0">
        <span className="break-words capitalize text-fg">{row.movement}</span>
        {row.substitutions.length > 0 ? (
          <span className="mt-0.5 block text-[0.7rem] text-muted">
            {row.substitutions
              .map(
                (s) =>
                  `${s.verdict === 'minor' ? '↔' : '×'} ${s.movement}${
                    s.sets > 1 ? ` ×${s.sets}` : ''
                  }`,
              )
              .join(' · ')}
          </span>
        ) : null}
      </td>
      <td className="py-2 pr-3 text-right align-top tabular-nums text-muted">
        {row.exactSets + row.swapSets + row.makeUpSets}/{row.prescribedSets}
      </td>
      <td className="py-2 text-right align-top tabular-nums text-fg">{row.pct}%</td>
    </tr>
  );
}

export function PlanAdherenceSection({ adherence }: { adherence: Adherence | null }) {
  if (!adherence) return null;
  const a = adherence;
  const sets: Record<(typeof BANDS)[number]['key'], number> = {
    exact: a.exactSets,
    swap: a.swapSets,
    makeUp: a.makeUpSets,
    missed: a.missedSets,
  };

  return (
    <Disclosure
      title="Plan adherence"
      headerRight={
        <span className="font-display text-lg leading-none tabular-nums text-fg">
          {a.pct}
          <span className="ml-0.5 text-xs font-medium text-muted">%</span>
        </span>
      }
    >
      <p className="text-[0.7rem] text-muted">
        Week {a.elapsedWeeks} of {a.planWeeks} · {a.calendarWeeks} weeks since you started
        {a.extraSets > 0 ? ` · ${a.extraSets} extra sets` : ''}
      </p>

      {/* Segments below 4% keep a sliver so the bar always sums to the whole. */}
      <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-fg/10">
        {BANDS.map((b) => {
          const pct = a.prescribedSets > 0 ? (sets[b.key] / a.prescribedSets) * 100 : 0;
          return (
            <span
              key={b.key}
              className={b.shade}
              style={{ width: `${Math.max(pct, pct > 0 ? 1.5 : 0)}%` }}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.65rem] text-muted">
        {BANDS.filter((b) => sets[b.key] > 0).map((b) => (
          <span key={b.key} className="inline-flex items-center gap-1">
            <span aria-hidden className={`inline-block h-2 w-2 rounded-[1px] ${b.shade}`} />
            {b.label} {sets[b.key]}
          </span>
        ))}
      </div>

      <table className="mt-4 w-full table-fixed text-left text-sm">
        <thead>
          <tr className="text-[0.65rem] uppercase tracking-wide text-muted">
            <th className="pb-1 pr-3 font-medium">Movement</th>
            <th className="w-16 pb-1 pr-3 text-right font-medium">Sets</th>
            <th className="w-12 pb-1 text-right font-medium">Hit</th>
          </tr>
        </thead>
        <tbody>
          {a.rows.map((row) => (
            <RowLine key={`${row.dayKey}|${row.movement}`} row={row} />
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[0.65rem] text-muted">
        ↔ counted — trains the same thing. × not counted — a different prescription.
      </p>
    </Disclosure>
  );
}
