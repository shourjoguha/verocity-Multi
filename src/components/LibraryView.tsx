import { useMemo, useState } from 'react';
import { getMovements } from '@/lib/queries';
import { useAuthedQuery } from '@/lib/useAuthedQuery';
import type { Movement } from '@/lib/types';
import { METRICS, type MetricKey } from '@/app.config';
import { EmptyState } from '@/components/ui/primitives';

export default function LibraryView() {
  const { data, loading } = useAuthedQuery(() => getMovements());
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const movements = useMemo<Movement[]>(() => data ?? [], [data]);
  const categories = useMemo(
    () => [...new Set(movements.map((m) => m.category).filter((c): c is string => !!c))].sort(),
    [movements],
  );

  const filtered = movements.filter((m) => {
    if (category && m.category !== category) return false;
    if (q && !m.name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  if (loading) return <div className="px-6 py-16 text-sm text-muted">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 font-display text-3xl font-semibold tracking-tight text-fg">Library</h1>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search movements"
        className="mb-4 min-h-11 w-full border border-border bg-surface px-3 text-base text-fg outline-none placeholder:text-muted focus:border-subtle"
      />

      {categories.length > 0 ? (
        <div className="mb-5 flex flex-wrap gap-2">
          <button
            onClick={() => setCategory(null)}
            className={`min-h-9 border px-3 text-[0.7rem] uppercase tracking-wider ${
              category === null ? 'border-fg text-fg' : 'border-border text-muted hover:text-fg'
            }`}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`min-h-9 border px-3 text-[0.7rem] uppercase tracking-wider ${
                category === c ? 'border-fg text-fg' : 'border-border text-muted hover:text-fg'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState>No movements match.</EmptyState>
      ) : (
        <ul className="divide-y divide-border border border-border">
          {filtered.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1">
                <div className="capitalize text-fg">{m.name}</div>
                <div className="text-[0.7rem] uppercase tracking-wider text-muted">
                  {m.category ?? 'uncategorized'}
                  {m.owner_user_id == null ? ' · shared' : ' · custom'}
                </div>
              </div>
              <div className="text-right text-sm text-subtle">
                {METRICS[m.primary_metric as MetricKey]?.label ?? m.primary_metric}
                <div className="text-[0.7rem] text-muted">{m.default_rest_seconds}s rest</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
