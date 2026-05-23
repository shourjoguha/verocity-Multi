import { getLogsInRange } from '@/lib/queries';
import { useAuthedQuery } from '@/lib/useAuthedQuery';
import type { WorkoutLog } from '@/lib/types';
import { e1rm } from '@/lib/e1rm';
import { flattenSets, familyOf, sessionVolume } from '@/lib/stats';
import { formatDuration, formatRound } from '@/lib/format';
import { EmptyState, SectionHeader, StatCard } from '@/components/ui/primitives';

const WEEKS = 8;

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

function mondayOf(d: Date): Date {
  const idx = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - idx));
}

export default function StatsView() {
  const today = new Date();
  const from = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (WEEKS * 7 - 1)),
  );
  const { data: logs, loading } = useAuthedQuery(() => getLogsInRange(ymd(from), ymd(today)));

  if (loading) return <div className="px-6 py-16 text-sm text-muted">Loading…</div>;
  const all: WorkoutLog[] = logs ?? [];

  // Week buckets (oldest → newest).
  const thisMonday = mondayOf(today);
  const weekStarts = Array.from({ length: WEEKS }, (_, i) => {
    const d = new Date(thisMonday);
    d.setUTCDate(thisMonday.getUTCDate() - (WEEKS - 1 - i) * 7);
    return d;
  });

  const weekRows = weekStarts.map((start) => {
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    const inWeek = all.filter((l) => {
      const d = l.log_date.slice(0, 10);
      return d >= ymd(start) && d <= ymd(end);
    });
    return {
      label: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      count: inWeek.length,
      seconds: inWeek.reduce((a, l) => a + (l.total_seconds ?? 0), 0),
      volume: inWeek.reduce((a, l) => a + sessionVolume(l), 0),
    };
  });

  // Heatmap: weekday rows × week columns, intensity by volume.
  const heat: number[][] = Array.from({ length: 7 }, () => Array(WEEKS).fill(0));
  for (const log of all) {
    const d = new Date(log.log_date);
    const row = (d.getUTCDay() + 6) % 7;
    const col = weekStarts.findIndex((ws) => {
      const we = new Date(ws);
      we.setUTCDate(ws.getUTCDate() + 6);
      const ds = log.log_date.slice(0, 10);
      return ds >= ymd(ws) && ds <= ymd(we);
    });
    if (col >= 0) heat[row][col] += sessionVolume(log) || 1;
  }
  const heatMax = Math.max(1, ...heat.flat());

  // RPE fingerprint by family.
  const fam = new Map<string, { sum: number; n: number }>();
  for (const log of all) {
    for (const s of flattenSets(log)) {
      if (s.rpe == null) continue;
      const f = familyOf(s.movement);
      if (!f) continue;
      const cur = fam.get(f) ?? { sum: 0, n: 0 };
      fam.set(f, { sum: cur.sum + s.rpe, n: cur.n + 1 });
    }
  }
  const rpeRows = [...fam.entries()].map(([f, v]) => ({ family: f, avg: v.sum / v.n }));

  // Top movements by best e1RM.
  const best = new Map<string, number>();
  for (const log of all) {
    for (const s of flattenSets(log)) {
      if (s.weight == null || s.reps == null) continue;
      const est = e1rm(s.weight, s.reps);
      if (est == null) continue;
      best.set(s.movement, Math.max(best.get(s.movement) ?? 0, est));
    }
  }
  const topMoves = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const topMax = topMoves.length ? topMoves[0][1] : 1;

  const totalSeconds = all.reduce((a, l) => a + (l.total_seconds ?? 0), 0);
  const totalVolume = all.reduce((a, l) => a + sessionVolume(l), 0);

  if (all.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="mb-6 font-display text-3xl font-semibold tracking-tight text-fg">Stats</h1>
        <EmptyState>No sessions in the last {WEEKS} weeks.</EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 font-display text-3xl font-semibold tracking-tight text-fg">Stats</h1>

      <section className="mb-8 grid grid-cols-3 gap-px bg-border">
        <StatCard label="Sessions" value={all.length} />
        <StatCard label="Time" value={formatDuration(totalSeconds)} />
        <StatCard label="Volume" value={formatRound(totalVolume)} unit="kg" />
      </section>

      <section className="mb-8">
        <SectionHeader>Consistency</SectionHeader>
        <div className="flex gap-1">
          {Array.from({ length: WEEKS }).map((_, col) => (
            <div key={col} className="flex flex-1 flex-col gap-1">
              {Array.from({ length: 7 }).map((__, row) => (
                <div
                  key={row}
                  className="aspect-square bg-fg"
                  style={{ opacity: 0.08 + (heat[row][col] / heatMax) * 0.92 }}
                />
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <SectionHeader>Weekly</SectionHeader>
        <table className="w-full border border-border text-sm">
          <thead>
            <tr className="text-[0.65rem] uppercase tracking-wider text-muted">
              <th className="border-b border-border px-3 py-2 text-left font-medium">Week</th>
              <th className="border-b border-border px-3 py-2 text-right font-medium">Sessions</th>
              <th className="border-b border-border px-3 py-2 text-right font-medium">Time</th>
              <th className="border-b border-border px-3 py-2 text-right font-medium">Volume</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {weekRows.map((w) => (
              <tr key={w.label} className="border-b border-border last:border-0">
                <td className="px-3 py-2 text-subtle">{w.label}</td>
                <td className="px-3 py-2 text-right text-fg">{w.count}</td>
                <td className="px-3 py-2 text-right text-fg">{formatDuration(w.seconds)}</td>
                <td className="px-3 py-2 text-right text-fg">{formatRound(w.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {rpeRows.length > 0 ? (
        <section className="mb-8">
          <SectionHeader>RPE by family</SectionHeader>
          <div className="flex flex-col gap-2">
            {rpeRows.map((r) => (
              <div key={r.family} className="flex items-center gap-3 text-sm">
                <div className="w-20 shrink-0 capitalize text-subtle">{r.family}</div>
                <div className="h-2 flex-1 bg-elevated">
                  <div className="h-full bg-fg" style={{ width: `${(r.avg / 10) * 100}%` }} />
                </div>
                <div className="w-8 shrink-0 text-right tabular-nums text-muted">
                  {formatRound(r.avg, 1)}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {topMoves.length > 0 ? (
        <section>
          <SectionHeader>Top movements (e1RM)</SectionHeader>
          <div className="flex flex-col gap-2">
            {topMoves.map(([name, value]) => (
              <div key={name} className="flex items-center gap-3 text-sm">
                <div className="w-32 shrink-0 truncate capitalize text-subtle">{name}</div>
                <div className="h-2 flex-1 bg-elevated">
                  <div className="h-full bg-fg" style={{ width: `${(value / topMax) * 100}%` }} />
                </div>
                <div className="w-14 shrink-0 text-right tabular-nums text-muted">
                  {formatRound(value)} kg
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
