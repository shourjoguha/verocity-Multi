import { useEffect, useMemo, useState } from 'react';
import {
  createMovement,
  deleteMovement,
  getMovements,
  updateMovement,
  type MovementInput,
} from '@/lib/queries';
import { useAuthedQuery } from '@/lib/useAuthedQuery';
import { supabasePublic } from '@/lib/supabase';
import type { Movement } from '@/lib/types';
import { METRICS, type MetricKey } from '@/app.config';
import { Button, EmptyState, LoadingScreen } from '@/components/ui/primitives';
import { EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';

const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];
const inputClass =
  'min-h-11 w-full border border-border bg-surface px-3 text-base text-fg outline-none placeholder:text-muted focus:border-subtle';

type Draft = MovementInput;

function emptyDraft(): Draft {
  return { name: '', category: '', primary_metric: 'weight', default_rest_seconds: 120 };
}

function MovementForm({
  draft,
  setDraft,
  onSubmit,
  onCancel,
  submitLabel,
  busy,
  categories,
  customCat,
  setCustomCat,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  busy: boolean;
  categories: string[];
  customCat: boolean;
  setCustomCat: (v: boolean) => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-3 border border-border bg-surface p-4"
    >
      <input
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        placeholder="Movement name"
        className={inputClass}
        aria-label="Movement name"
        autoFocus
      />
      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-40 flex-1 flex-col gap-2">
          <select
            value={customCat ? '__new__' : (draft.category ?? '')}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__new__') {
                setCustomCat(true);
                setDraft({ ...draft, category: '' });
              } else {
                setCustomCat(false);
                setDraft({ ...draft, category: v || null });
              }
            }}
            className={inputClass}
            aria-label="Category"
          >
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="__new__">New category…</option>
          </select>
          {customCat ? (
            <input
              value={draft.category ?? ''}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              placeholder="New category name"
              className={inputClass}
              aria-label="New category name"
              autoFocus
            />
          ) : null}
        </div>
        <select
          value={draft.primary_metric}
          onChange={(e) => setDraft({ ...draft, primary_metric: e.target.value as MetricKey })}
          className={`${inputClass} w-36`}
          aria-label="Primary metric"
        >
          {METRIC_KEYS.map((k) => (
            <option key={k} value={k}>
              {METRICS[k].label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="number"
            min={0}
            step={5}
            value={draft.default_rest_seconds}
            onChange={(e) => setDraft({ ...draft, default_rest_seconds: Number(e.target.value) })}
            className={`${inputClass} w-24 tabular-nums`}
            aria-label="Default rest seconds"
          />
          s rest
        </label>
      </div>
      <div className="flex gap-3">
        <Button type="submit" disabled={busy || !draft.name.trim()}>
          {submitLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const byName = (a: Movement, b: Movement) => a.name.localeCompare(b.name);

export default function LibraryView({ mode = 'app' }: { mode?: 'app' | 'showcase' }) {
  const showcase = mode === 'showcase';
  const { data, loading } = useAuthedQuery(
    () => getMovements(showcase ? supabasePublic : undefined),
    { auth: !showcase, key: showcase ? undefined : 'movements' },
  );
  const [items, setItems] = useState<Movement[] | null>(null);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [customCat, setCustomCat] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setItems(data);
  }, [data]);

  const movements = items ?? [];
  const categories = useMemo(
    () => [...new Set(movements.map((m) => m.category).filter((c): c is string => !!c))].sort(),
    [movements],
  );

  const filtered = movements.filter((m) => {
    if (category && m.category !== category) return false;
    if (q && !m.name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const trimmed = (d: Draft): Draft => ({
    name: d.name.trim(),
    category: d.category && d.category.trim() ? d.category.trim() : null,
    primary_metric: d.primary_metric,
    default_rest_seconds: d.default_rest_seconds,
  });

  function startAdd() {
    setEditingId(null);
    setDraft(emptyDraft());
    setCustomCat(false);
    setAdding(true);
  }

  function startEdit(m: Movement) {
    setAdding(false);
    setEditingId(m.id);
    setCustomCat(false);
    setDraft({
      name: m.name,
      category: m.category,
      primary_metric: m.primary_metric,
      default_rest_seconds: m.default_rest_seconds,
    });
  }

  function cancel() {
    setAdding(false);
    setEditingId(null);
    setCustomCat(false);
    setDraft(emptyDraft());
  }

  async function handleCreate() {
    if (busy || !draft.name.trim()) return;
    setBusy(true);
    const created = await createMovement(trimmed(draft));
    setBusy(false);
    if (created) {
      setItems((prev) => [...(prev ?? []), created].sort(byName));
      cancel();
    }
  }

  async function handleUpdate(id: string) {
    if (busy || !draft.name.trim()) return;
    const patch = trimmed(draft);
    setBusy(true);
    const ok = await updateMovement(id, patch);
    setBusy(false);
    if (ok) {
      setItems((prev) => (prev ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m)).sort(byName));
      cancel();
    }
  }

  async function handleDelete(m: Movement) {
    if (busy) return;
    if (!confirm(`Delete "${m.name}"? This can't be undone.`)) return;
    setBusy(true);
    const ok = await deleteMovement(m.id);
    setBusy(false);
    if (ok) setItems((prev) => (prev ?? []).filter((x) => x.id !== m.id));
  }

  if (loading || items === null) {
    return <LoadingScreen />;
  }

  return (
    <PageStagger className="mx-auto max-w-3xl px-6 py-8">
      <Item>
        <div className="mb-6 flex items-end justify-between gap-4">
          <EchoText
            text="LIBRARY"
            as="h1"
            className="font-display text-5xl font-bold uppercase leading-[0.9] tracking-[-0.04em] text-fg md:text-7xl"
          />
          {!showcase && !adding ? (
            <button
              onClick={startAdd}
              className="shrink-0 pb-1 t-control text-muted transition-colors hover:text-fg"
            >
              + Movement
            </button>
          ) : null}
        </div>
      </Item>

      {adding ? (
        <Item>
          <div className="mb-6">
            <MovementForm
              draft={draft}
              setDraft={setDraft}
              onSubmit={handleCreate}
              onCancel={cancel}
              submitLabel="Add"
              busy={busy}
              categories={categories}
              customCat={customCat}
              setCustomCat={setCustomCat}
            />
          </div>
        </Item>
      ) : null}

      <Item>
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
              className={`min-h-9 border px-3 t-control transition-colors ${
                category === null ? 'border-fg text-fg' : 'border-border text-muted hover:text-fg'
              }`}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`min-h-9 border px-3 t-control transition-colors ${
                  category === c ? 'border-fg text-fg' : 'border-border text-muted hover:text-fg'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        ) : null}
      </Item>

      {filtered.length === 0 ? (
        <Item>
          <EmptyState>No movements match.</EmptyState>
        </Item>
      ) : (
        <Item>
          <ul className="divide-y divide-border border border-border">
          {filtered.map((m) => {
            const custom = m.owner_user_id != null;
            if (editingId === m.id) {
              return (
                <li key={m.id} className="p-4">
                  <MovementForm
                    draft={draft}
                    setDraft={setDraft}
                    onSubmit={() => handleUpdate(m.id)}
                    onCancel={cancel}
                    submitLabel="Save"
                    busy={busy}
                    categories={categories}
                    customCat={customCat}
                    setCustomCat={setCustomCat}
                  />
                </li>
              );
            }
            return (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1">
                  <div className="capitalize text-fg">{m.name}</div>
                  <div className="t-control text-muted">
                    {m.category ?? 'uncategorized'}
                    {custom ? ' · custom' : ' · shared'}
                  </div>
                </div>
                <div className="text-right text-sm text-subtle">
                  {METRICS[m.primary_metric]?.label ?? m.primary_metric}
                  <div className="text-[0.7rem] text-muted">{m.default_rest_seconds}s rest</div>
                </div>
                {custom && !showcase ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => startEdit(m)}
                      className="px-2 t-control text-muted hover:text-fg"
                      aria-label={`Edit ${m.name}`}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(m)}
                      className="px-2 text-muted hover:text-accent"
                      aria-label={`Delete ${m.name}`}
                    >
                      ×
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
          </ul>
        </Item>
      )}
    </PageStagger>
  );
}
