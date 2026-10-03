import { useState, type ReactNode } from 'react';
import { MEAL_KINDS, MEAL_SIZES } from '@/app.config';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/lib/toast';
import { createMealPreset, deleteMealPreset, updateMealPreset } from '@/lib/queries';
import { draftFor, presetInputFromDraft, toggleTag, type MealDraft } from '@/lib/mealDraft';
import { macroMix } from '@/lib/mealInsights';
import type { MealPreset } from '@/lib/types';
import { MacroStack } from '@/components/meals/MacroStack';
import {
  CompositionFields,
  ExtrasRow,
  FieldRow,
  PresetNameInput,
  SegmentedChoice,
} from '@/components/meals/MealFields';

// Manage saved meals, opened from the rail's "•••". One Modal whose body
// switches between the list and the editor, so going list → edit → list never
// unmounts the sheet (one dialog, one focus trap, one scroll lock — the same
// reason MealDrawer is hoisted). Logged meals copied their values at log time,
// so editing or deleting here never changes history (0046).
type View =
  | { mode: 'list'; confirmId: string | null }
  | { mode: 'edit'; preset: MealPreset | null; draft: MealDraft; name: string; confirmDelete: boolean };

export function SavedMealsSheet({
  open,
  presets,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  presets: MealPreset[];
  onClose: () => void;
  onSaved: (preset: MealPreset) => void;
  onDeleted: (id: string) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} ariaLabel="Saved meals" keyboardInset>
      {open ? <SheetBody presets={presets} onClose={onClose} onSaved={onSaved} onDeleted={onDeleted} /> : null}
    </Modal>
  );
}

function SheetBody({
  presets,
  onClose,
  onSaved,
  onDeleted,
}: {
  presets: MealPreset[];
  onClose: () => void;
  onSaved: (preset: MealPreset) => void;
  onDeleted: (id: string) => void;
}) {
  const [view, setView] = useState<View>({ mode: 'list', confirmId: null });
  const [busy, setBusy] = useState(false);

  const edit = (preset: MealPreset | null) =>
    setView({
      mode: 'edit',
      preset,
      draft: preset ? draftFor({ kind: 'preset', preset }) : draftFor({ kind: 'meal' }),
      name: preset?.name ?? '',
      confirmDelete: false,
    });

  async function remove(id: string) {
    setBusy(true);
    const ok = await deleteMealPreset(id);
    setBusy(false);
    if (!ok) {
      toast('Could not delete the saved meal. Check your connection and try again.', 'error');
      return;
    }
    onDeleted(id);
    setView({ mode: 'list', confirmId: null });
    toast('Saved meal deleted');
  }

  async function save(v: Extract<View, { mode: 'edit' }>) {
    const name = v.name.trim();
    if (!name) {
      toast('Give the saved meal a name.', 'error');
      return;
    }
    setBusy(true);
    const input = presetInputFromDraft(v.draft, name);
    const res = v.preset ? await updateMealPreset(v.preset.id, input) : await createMealPreset(input);
    setBusy(false);
    if (!res.ok) {
      toast(
        res.error === 'duplicate'
          ? `You already have a saved meal called "${name}".`
          : 'Could not save. Check your connection and try again.',
        'error',
      );
      return;
    }
    onSaved(res.preset);
    setView({ mode: 'list', confirmId: null });
  }

  const header = (title: string, action: ReactNode) => (
    <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
      <div className="font-display text-sm uppercase tracking-[0.04em] text-fg">{title}</div>
      {action}
    </div>
  );
  const textButton = 'flex min-h-11 items-center px-2 t-control text-muted transition-colors hover:text-fg';

  if (view.mode === 'edit') {
    const v = view;
    const patch = (next: Partial<typeof v>) => setView({ ...v, ...next });
    const setDraft = (draft: MealDraft) => patch({ draft });
    return (
      <>
        {header(
          v.preset ? 'Edit saved meal' : 'New saved meal',
          <button type="button" onClick={() => setView({ mode: 'list', confirmId: null })} className={textButton}>
            Back
          </button>,
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
          <div className="flex flex-col gap-3">
            <FieldRow label="Name">
              <PresetNameInput value={v.name} onChange={(name) => patch({ name })} />
            </FieldRow>
            <FieldRow label="Size">
              <SegmentedChoice
                axis="size"
                active={v.draft.size}
                onChange={(size) => setDraft({ ...v.draft, size: size as MealDraft['size'] })}
              />
            </FieldRow>
            <FieldRow label="Kind">
              <SegmentedChoice
                axis="kind"
                active={v.draft.kind}
                onChange={(kind) => setDraft({ ...v.draft, kind: kind as MealDraft['kind'] })}
              />
            </FieldRow>
            <CompositionFields draft={v.draft} onChange={setDraft} />
            <FieldRow label="Source">
              <SegmentedChoice
                axis="source"
                active={v.draft.source}
                onChange={(source) => setDraft({ ...v.draft, source: source as MealDraft['source'] })}
              />
            </FieldRow>
            <FieldRow label="Also">
              <ExtrasRow tags={v.draft.tags} onToggle={(key) => setDraft(toggleTag(v.draft, key))} />
            </FieldRow>
            {v.preset ? (
              v.confirmDelete ? (
                <ConfirmDelete
                  text="Delete this saved meal? Meals you logged with it keep their data."
                  busy={busy}
                  onCancel={() => patch({ confirmDelete: false })}
                  onConfirm={() => remove(v.preset!.id)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => patch({ confirmDelete: true })}
                  className="flex min-h-11 items-center self-start t-control text-danger"
                >
                  Delete saved meal
                </button>
              )
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 border-t border-border p-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => save(v)}
            className="hill-btn flex min-h-11 flex-1 items-center justify-center bg-fg px-4 text-sm uppercase tracking-wider text-bg transition-colors hover:bg-fg/85 disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      {header(
        'Saved meals',
        <button type="button" data-modal-close onClick={onClose} className={textButton}>
          Done
        </button>,
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-2">
        {presets.length === 0 ? (
          <p className="py-4 text-sm text-muted">
            No saved meals yet. Turn on “Save as a saved meal” when you log one, or add one here.
          </p>
        ) : (
          <ul className="flex flex-col">
            {presets.map((p) => {
              const mix = macroMix(p.tags, p.tag_mix);
              return (
                <li key={p.id} className="border-t border-border-soft py-2 first:border-t-0">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-fg">{p.name}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                        <span>
                          {MEAL_SIZES[p.size].label} · {MEAL_KINDS[p.kind].label}
                        </span>
                        {mix ? (
                          <span aria-hidden className="inline-flex h-[5px] w-12 overflow-hidden rounded-[1px]">
                            <MacroStack mix={mix} fibrePct={p.carb_fibre_pct} direction="right" />
                          </span>
                        ) : p.tags.some((t) => t === 'protein' || t === 'carbs' || t === 'fat') ? (
                          <span className="text-faint">split not set</span>
                        ) : null}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => edit(p)}
                      className="hill-btn flex min-h-11 shrink-0 items-center border border-border bg-surface px-3 t-control text-fg transition-colors hover:border-fg"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${p.name}`}
                      onClick={() => setView({ mode: 'list', confirmId: p.id })}
                      className="flex min-h-11 min-w-11 shrink-0 items-center justify-center text-muted transition-colors hover:text-fg"
                    >
                      <span aria-hidden>✕</span>
                    </button>
                  </div>
                  {view.confirmId === p.id ? (
                    <ConfirmDelete
                      text={`Delete “${p.name}”? Meals you logged with it keep their data.`}
                      busy={busy}
                      onCancel={() => setView({ mode: 'list', confirmId: null })}
                      onConfirm={() => remove(p.id)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="flex shrink-0 border-t border-border p-4">
        <button
          type="button"
          onClick={() => edit(null)}
          className="hill-btn flex min-h-11 flex-1 items-center justify-center border border-border bg-surface px-4 t-control text-fg transition-colors hover:border-fg"
        >
          + New saved meal
        </button>
      </div>
    </>
  );
}

function ConfirmDelete({
  text,
  busy,
  onCancel,
  onConfirm,
}: {
  text: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-control bg-elevated p-3 text-sm text-fg">
      <span>{text}</span>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex min-h-11 items-center px-3 t-control text-muted transition-colors hover:text-fg"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="hill-btn flex min-h-11 items-center border border-danger bg-surface px-4 t-control text-danger disabled:opacity-40"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
