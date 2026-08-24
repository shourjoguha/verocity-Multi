import { useEffect, useMemo, useState } from 'react';
import {
  createMovement,
  deleteMovement,
  getMovements,
  updateMovement,
  type MovementInput,
} from '@/lib/queries';
import { useAuthedQuery } from '@/lib/useAuthedQuery';
import { track } from '@/lib/analytics';
import { supabasePublic } from '@/lib/supabase';
import type { Movement } from '@/lib/types';
import { METRICS, type MetricKey, PRIMARY_METRICS } from '@/app.config';
import { DEFAULT_PRIMARY_METRIC } from '@/lib/metrics';
import { isSubroutine } from '@/lib/subroutine';
import { Button, EmptyState, LoadingScreen } from '@/components/ui/primitives';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';
import { SubroutineBody } from '@/components/SubroutineBody';
import { MovementDemoSheet, MovementDemoThumb } from '@/components/MovementDemo';
import { SubroutineEditor } from '@/components/logger/SubroutineEditor';
import { TaxonomyEditor } from '@/components/TaxonomyEditor';
import type { MovementProfile } from '@/app.config';

// Only primary-eligible metrics are offered. A movement already stored as
// weight/rpe-primary still renders (METRICS keeps both), it just cannot be chosen.
const METRIC_KEYS = PRIMARY_METRICS as readonly MetricKey[];
const inputClass =
  'min-h-11 w-full border border-border bg-surface px-3 text-base text-fg outline-none placeholder:text-muted focus:border-subtle';

type Draft = MovementInput;

function emptyDraft(): Draft {
  return { name: '', category: '', primary_metric: DEFAULT_PRIMARY_METRIC, default_rest_seconds: 120 };
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
  // Subroutine add/edit uses the shared modal editor rather than the inline form.
  const [subEditing, setSubEditing] = useState<
    { mode: 'add' } | { mode: 'edit'; id: string } | null
  >(null);
  // Muscle-map override for one owned movement. Corrects what the static rules
  // in lib/movementTaxonomy.ts got wrong; feeds the /app/body map.
  const [mapEditingId, setMapEditingId] = useState<string | null>(null);
  // Movement whose demo GIF sheet is open, by name (the demo mapping is
  // name-keyed, not id-keyed).
  const [demoFor, setDemoFor] = useState<string | null>(null);

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

  const subEditItem =
    subEditing?.mode === 'edit' ? movements.find((m) => m.id === subEditing.id) : undefined;

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
      track('movement_created', {
        category: created.category,
        primary_metric: created.primary_metric,
        kind: created.kind,
      });
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

  // Persist a library subroutine (create or update). Title → name, description →
  // notes, plus the link; metric/rest are unused placeholders for this kind.
  async function handleSaveSubroutine(values: { title: string; description: string; url: string }) {
    if (busy || !subEditing || !values.title.trim()) return;
    const input = {
      name: values.title,
      category: null,
      primary_metric: 'reps' as MetricKey,
      default_rest_seconds: 0,
      kind: 'subroutine' as const,
      notes: values.description || null,
      url: values.url || null,
    };
    setBusy(true);
    if (subEditing.mode === 'add') {
      const created = await createMovement(input);
      setBusy(false);
      if (created) {
        setItems((prev) => [...(prev ?? []), created].sort(byName));
        setSubEditing(null);
        track('movement_created', {
          category: created.category,
          primary_metric: created.primary_metric,
          kind: created.kind,
        });
      }
    } else {
      const { id } = subEditing;
      const ok = await updateMovement(id, input);
      setBusy(false);
      if (ok) {
        setItems((prev) =>
          (prev ?? [])
            .map((m) => (m.id === id ? { ...m, name: input.name, notes: input.notes, url: input.url } : m))
            .sort(byName),
        );
        setSubEditing(null);
      }
    }
  }

  // Persist a muscle-map override. Only ever written to an owned row —
  // 0005_lock_shared_library.sql blocks writes to shared rows, so the control
  // is not offered on them.
  async function handleSaveTaxonomy(id: string, taxonomy: MovementProfile) {
    const m = movements.find((x) => x.id === id);
    if (busy || !m) return;
    setBusy(true);
    const ok = await updateMovement(id, {
      name: m.name,
      category: m.category,
      primary_metric: m.primary_metric,
      default_rest_seconds: m.default_rest_seconds,
      taxonomy,
    });
    setBusy(false);
    if (ok) {
      setItems((prev) => (prev ?? []).map((x) => (x.id === id ? { ...x, taxonomy } : x)));
      setMapEditingId(null);
    }
  }

  async function handleDelete(m: Movement) {
    if (busy) return;
    if (!confirm(`Delete "${m.name}"? This can't be undone.`)) return;
    setBusy(true);
    const ok = await deleteMovement(m.id);
    setBusy(false);
    if (ok) {
      setItems((prev) => (prev ?? []).filter((x) => x.id !== m.id));
      track('movement_deleted', {
        category: m.category,
        primary_metric: m.primary_metric,
        kind: m.kind,
        is_custom: m.owner_user_id !== null,
      });
    }
  }

  if (loading || items === null) {
    return <LoadingScreen />;
  }

  return (
    <>
    <PageStagger className="mx-auto max-w-3xl px-4 pb-8 pt-5 sm:px-6">
      <Item>
        <div className="mb-6 flex items-end justify-between gap-4">
          <EchoText
            text="LIBRARY"
            as="h1"
            className={ECHO_APP_TITLE}
          />
          {!showcase && !adding ? (
            <div className="flex shrink-0 gap-2 pb-1">
              <Button variant="ghost" onClick={startAdd}>+ Movement</Button>
              <Button variant="ghost" onClick={() => setSubEditing({ mode: 'add' })}>+ Subroutine</Button>
            </div>
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
              className={`flex min-h-11 items-center border px-3 t-control transition-colors ${
                category === null ? 'border-fg text-fg' : 'border-border text-muted hover:text-fg'
              }`}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`flex min-h-11 items-center border px-3 t-control transition-colors ${
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
            const sub = isSubroutine(m);
            return (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                {sub ? null : (
                  <MovementDemoThumb name={m.name} onOpen={() => setDemoFor(m.name)} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="capitalize text-fg">{m.name}</div>
                  {sub ? (
                    <>
                      <SubroutineBody description={m.notes ?? undefined} url={m.url ?? undefined} className="mt-0.5" />
                      <div className="mt-0.5 t-control text-muted">
                        subroutine{custom ? ' · custom' : ' · shared'}
                      </div>
                    </>
                  ) : (
                    <div className="t-control text-muted">
                      {m.category ?? 'uncategorized'}
                      {custom ? ' · custom' : ' · shared'}
                      {m.taxonomy ? ' · mapped' : ''}
                    </div>
                  )}
                </div>
                {sub ? null : (
                  <div className="text-right text-sm text-subtle">
                    {METRICS[m.primary_metric]?.label ?? m.primary_metric}
                    <div className="text-[0.7rem] text-muted">{m.default_rest_seconds}s rest</div>
                  </div>
                )}
                {custom && !showcase ? (
                  <div className="flex shrink-0 items-center gap-1">
                    {sub ? null : (
                      <button
                        onClick={() => setMapEditingId(m.id)}
                        className="flex min-h-11 items-center px-2 t-control text-muted hover:text-fg"
                        aria-label={`Muscle map for ${m.name}`}
                      >
                        Map
                      </button>
                    )}
                    <button
                      onClick={() => (sub ? setSubEditing({ mode: 'edit', id: m.id }) : startEdit(m))}
                      className="flex min-h-11 items-center px-2 t-control text-muted hover:text-fg"
                      aria-label={`Edit ${m.name}`}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(m)}
                      className="flex min-h-11 items-center px-2 text-muted hover:text-accent"
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

      {/* Outside PageStagger, like every other view's sheets, and mounted
          permanently with `open`. Unmounting it instead destroyed the
          AnimatePresence inside Modal along with the child it was supposed to
          animate out, so the sheet vanished in a single frame. */}
      <SubroutineEditor
        open={subEditing !== null}
        initial={{
          title: subEditItem?.name ?? '',
          description: subEditItem?.notes ?? '',
          url: subEditItem?.url ?? '',
        }}
        onSave={handleSaveSubroutine}
        onClose={() => setSubEditing(null)}
      />

      <MovementDemoSheet
        name={demoFor}
        open={demoFor !== null}
        onClose={() => setDemoFor(null)}
      />

      <TaxonomyEditor
        open={mapEditingId !== null}
        movementName={movements.find((m) => m.id === mapEditingId)?.name ?? ''}
        initial={movements.find((m) => m.id === mapEditingId)?.taxonomy}
        busy={busy}
        onSave={(profile) => mapEditingId && handleSaveTaxonomy(mapEditingId, profile)}
        onClose={() => setMapEditingId(null)}
      />
    </>
  );
}
