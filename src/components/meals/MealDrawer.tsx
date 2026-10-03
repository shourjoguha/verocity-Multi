import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/lib/toast';
import { track } from '@/lib/analytics';
import { createMealLog, createMealPreset, updateMealLog, updateMealPreset } from '@/lib/queries';
import { uploadMealPhoto } from '@/lib/mealPhoto';
import {
  applyPreset,
  clearPreset,
  differsFromPreset,
  presetInputFromDraft,
  toggleTag,
  toInput,
  type MealDraft,
} from '@/lib/mealDraft';
import type { MealLog, MealPreset } from '@/lib/types';
import {
  CompositionFields,
  ExtrasRow,
  FieldRow,
  HungerSection,
  MoreDetails,
  NotesRow,
  PhotoRow,
  SaveAsPresetRow,
  SegmentedChoice,
  StartFromRow,
  TimeRow,
} from '@/components/meals/MealFields';

// The quick-capture bottom drawer, per docs/MEAL_LOGGING.md §10.2. Draft state
// is CONTROLLED by the caller (hoisted into ProfileView, §11.3) so the chip
// rail and Today's meals share one drawer instance — one dialog, one focus
// trap, one scroll lock. `open` is derived from `draft !== null`, and Modal
// unmounts its children when closed, which is what resets PhotoRow's local
// file state and every <Disclosure> (including the nested Hunger one) back to
// collapsed on the NEXT open, per acceptance criterion 8. The same unmount
// resets the drawer's local save-as / update-or-log-once state.
export function MealDrawer({
  draft,
  onDraftChange,
  onClose,
  editingId = null,
  onSaved,
  presets = [],
  onPresetSaved,
}: {
  draft: MealDraft | null;
  onDraftChange: (patch: Partial<MealDraft>) => void;
  onClose: () => void;
  editingId?: string | null;
  // Called after a successful save. `meal` is the created row for a new meal;
  // null on an edit (updateMealLog returns only a boolean — the caller already
  // holds the original row and the draft that patched it).
  onSaved: (meal: MealLog | null) => void;
  // Saved meals for "Start from". Empty hides the row; editing an existing
  // meal hides it too, along with "Save as a saved meal".
  presets?: MealPreset[];
  // A saved meal was created or updated by this save.
  onPresetSaved?: (preset: MealPreset) => void;
}) {
  return (
    <Modal open={draft !== null} onClose={onClose} keyboardInset ariaLabel="Log a meal">
      {draft ? (
        <MealDrawerBody
          draft={draft}
          onDraftChange={onDraftChange}
          onClose={onClose}
          editingId={editingId}
          onSaved={onSaved}
          presets={presets}
          onPresetSaved={onPresetSaved}
        />
      ) : null}
    </Modal>
  );
}

function MealDrawerBody({
  draft,
  onDraftChange,
  onClose,
  editingId,
  onSaved,
  presets,
  onPresetSaved,
}: {
  draft: MealDraft;
  onDraftChange: (patch: Partial<MealDraft>) => void;
  onClose: () => void;
  editingId: string | null;
  onSaved: (meal: MealLog | null) => void;
  presets: MealPreset[];
  onPresetSaved?: (preset: MealPreset) => void;
}) {
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveAs, setSaveAs] = useState(false);
  const [presetName, setPresetName] = useState('');
  // Set when Save found the draft changed from the saved meal it started from:
  // the footer then asks "update it, or log this once?".
  const [asking, setAsking] = useState(false);

  const isNew = !editingId;
  const fromPreset = draft.presetId ? presets.find((p) => p.id === draft.presetId) : undefined;
  const change = (patch: Partial<MealDraft>) => {
    setAsking(false);
    onDraftChange(patch);
  };
  const pickPreset = (p: MealPreset) => change(p.id === draft.presetId ? clearPreset(draft) : applyPreset(draft, p));

  async function save(mode: 'check' | 'once' | 'update') {
    if (mode === 'check' && isNew && fromPreset && !saveAs && differsFromPreset(draft, fromPreset)) {
      setAsking(true);
      return;
    }
    const name = presetName.trim();
    if (saveAs && !name) {
      toast('Name the saved meal, or turn saving it off.', 'error');
      return;
    }

    setSaving(true);
    let presetId = draft.presetId;
    if (saveAs) {
      const res = await createMealPreset(presetInputFromDraft(draft, name));
      if (!res.ok) {
        setSaving(false);
        toast(
          res.error === 'duplicate'
            ? `You already have a saved meal called "${name}".`
            : 'Could not save the meal. Check your connection and try again.',
          'error',
        );
        return;
      }
      presetId = res.preset.id;
      onPresetSaved?.(res.preset);
    } else if (mode === 'update' && fromPreset) {
      const res = await updateMealPreset(fromPreset.id, presetInputFromDraft(draft, fromPreset.name));
      if (!res.ok) {
        setSaving(false);
        toast('Could not update the saved meal. Check your connection and try again.', 'error');
        return;
      }
      onPresetSaved?.(res.preset);
    }

    let photoPath: string | null = null;
    let photoFailed = false;
    if (photoFile) {
      photoPath = await uploadMealPhoto(photoFile);
      if (photoPath === null) photoFailed = true;
    }

    const input = toInput({ ...draft, presetId }, photoPath);
    let created: MealLog | null = null;
    let ok = true;
    if (editingId) {
      ok = await updateMealLog(editingId, input);
    } else {
      created = await createMealLog(input);
      ok = created !== null;
    }
    setSaving(false);

    if (!ok) {
      toast('Could not save the meal. Check your connection and try again.', 'error');
      return;
    }

    track('meal_logged', {
      size: draft.size,
      kind: draft.kind,
      source: draft.source,
      has_photo: !!photoPath,
      tag_count: draft.tags.length,
    });

    onSaved(created);
    onClose();
    // Losing the log over a photo failure is worse than losing the photo —
    // the row above is already saved by this point.
    toast(photoFailed ? 'Meal saved — photo did not upload' : 'Meal saved', photoFailed ? 'error' : 'success');
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="t-eyebrow text-teal">Quick capture</div>
          <div className="font-display text-sm uppercase tracking-[0.04em] text-fg">Log a meal</div>
        </div>
        <button
          type="button"
          data-modal-close
          onClick={onClose}
          aria-label="Close"
          className="flex min-h-11 min-w-11 items-center justify-center text-muted transition-colors hover:text-fg"
        >
          <span aria-hidden>✕</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
        <div className="flex flex-col gap-3">
          {isNew && presets.length > 0 ? (
            <FieldRow label="Start from">
              <StartFromRow presets={presets} activeId={draft.presetId} onPick={pickPreset} />
            </FieldRow>
          ) : null}
          <FieldRow label="Time">
            <TimeRow value={draft.time} onChange={(time) => change({ time })} />
          </FieldRow>
          <FieldRow label="Size">
            <SegmentedChoice
              axis="size"
              active={draft.size}
              onChange={(size) => change({ size: size as MealDraft['size'] })}
            />
          </FieldRow>
          <FieldRow label="Kind">
            <SegmentedChoice
              axis="kind"
              active={draft.kind}
              onChange={(kind) => change({ kind: kind as MealDraft['kind'] })}
            />
          </FieldRow>
          <CompositionFields draft={draft} onChange={change} />
          <FieldRow label="Source">
            <SegmentedChoice
              axis="source"
              active={draft.source}
              onChange={(source) => change({ source: source as MealDraft['source'] })}
            />
          </FieldRow>
          <FieldRow label="Photo">
            <PhotoRow value={photoFile} onChange={setPhotoFile} />
          </FieldRow>
          {isNew ? (
            <SaveAsPresetRow
              on={saveAs}
              name={presetName}
              onToggle={() => {
                setAsking(false);
                setSaveAs((v) => !v);
              }}
              onName={setPresetName}
            />
          ) : null}

          <MoreDetails>
            <div className="flex flex-col gap-4">
              <FieldRow label="Date">
                <input
                  type="date"
                  value={draft.date}
                  onChange={(e) => onDraftChange({ date: e.target.value })}
                  aria-label="Date eaten"
                  className="min-h-11 w-full rounded-control border border-border bg-surface px-3 tabular-nums text-fg outline-none focus:border-subtle"
                />
              </FieldRow>
              <FieldRow label="Also">
                <ExtrasRow tags={draft.tags} onToggle={(key) => change(toggleTag(draft, key))} />
              </FieldRow>
              <HungerSection
                before={draft.hungerBefore}
                after={draft.hungerAfter}
                onChangeBefore={(hungerBefore) => onDraftChange({ hungerBefore })}
                onChangeAfter={(hungerAfter) => onDraftChange({ hungerAfter })}
              />
              <div>
                <div className="t-label mb-2 text-muted">Notes</div>
                <NotesRow value={draft.notes} onChange={(notes) => onDraftChange({ notes })} />
              </div>
            </div>
          </MoreDetails>
        </div>
      </div>

      {asking && fromPreset ? (
        <div className="flex shrink-0 flex-col gap-2 border-t border-border bg-elevated px-4 py-3 text-sm text-fg">
          <span>You changed “{fromPreset.name}”.</span>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => save('once')}
              className="hill-btn flex min-h-11 items-center border border-border bg-surface px-4 t-control text-fg transition-colors hover:border-fg disabled:opacity-40"
            >
              Log once
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => save('update')}
              className="hill-btn flex min-h-11 items-center bg-fg px-4 t-control text-bg transition-colors hover:bg-fg/85 disabled:opacity-40"
            >
              Update and log
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex shrink-0 gap-2 border-t border-border p-4">
        <button
          type="button"
          aria-label="Open the full logger"
          onClick={() => {
            window.location.href = '/app/meals/log';
          }}
          className="hill-btn flex min-h-11 min-w-11 shrink-0 items-center justify-center border border-border bg-surface text-fg transition-colors hover:border-fg"
        >
          <span aria-hidden>⤢</span>
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => save('check')}
          className="hill-btn flex min-h-11 flex-1 items-center justify-center bg-fg px-4 text-sm uppercase tracking-wider text-bg transition-colors hover:bg-fg/85 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save meal'}
        </button>
      </div>
    </>
  );
}
