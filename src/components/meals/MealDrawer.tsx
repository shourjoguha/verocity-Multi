import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/lib/toast';
import { track } from '@/lib/analytics';
import { createMealLog, updateMealLog } from '@/lib/queries';
import { uploadMealPhoto } from '@/lib/mealPhoto';
import { toInput, type MealDraft } from '@/lib/mealDraft';
import type { MealLog } from '@/lib/types';
import {
  FieldRow,
  HungerSection,
  MoreDetails,
  NotesRow,
  PhotoRow,
  SegmentedChoice,
  TagsSection,
  TimeRow,
} from '@/components/meals/MealFields';

// The quick-capture bottom drawer, per docs/MEAL_LOGGING.md §10.2. Draft state
// is CONTROLLED by the caller (hoisted into ProfileView, §11.3) so the chip
// rail and Today's meals share one drawer instance — one dialog, one focus
// trap, one scroll lock. `open` is derived from `draft !== null`, and Modal
// unmounts its children when closed, which is what resets PhotoRow's local
// file state and every <Disclosure> (including the nested Hunger one) back to
// collapsed on the NEXT open, per acceptance criterion 8.
export function MealDrawer({
  draft,
  onDraftChange,
  onClose,
  editingId = null,
  onSaved,
}: {
  draft: MealDraft | null;
  onDraftChange: (patch: Partial<MealDraft>) => void;
  onClose: () => void;
  editingId?: string | null;
  // Called after a successful save. `meal` is the created row for a new meal;
  // null on an edit (updateMealLog returns only a boolean — the caller already
  // holds the original row and the draft that patched it).
  onSaved: (meal: MealLog | null) => void;
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
}: {
  draft: MealDraft;
  onDraftChange: (patch: Partial<MealDraft>) => void;
  onClose: () => void;
  editingId: string | null;
  onSaved: (meal: MealLog | null) => void;
}) {
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleTag = (key: string) => {
    onDraftChange({
      tags: draft.tags.includes(key) ? draft.tags.filter((t) => t !== key) : [...draft.tags, key],
    });
  };
  const toggleCustomTag = (key: string) => {
    onDraftChange({
      customTags: draft.customTags.includes(key)
        ? draft.customTags.filter((t) => t !== key)
        : [...draft.customTags, key],
    });
  };
  const addCustomTag = (tag: string) => {
    if (draft.customTags.includes(tag)) return; // duplicate is a no-op
    onDraftChange({ customTags: [...draft.customTags, tag] });
  };

  async function save() {
    setSaving(true);
    let photoPath: string | null = null;
    let photoFailed = false;
    if (photoFile) {
      photoPath = await uploadMealPhoto(photoFile);
      if (photoPath === null) photoFailed = true;
    }

    const input = toInput(draft, photoPath);
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
      tag_count: draft.tags.length + draft.customTags.length,
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

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-3">
          <FieldRow label="Time">
            <TimeRow value={draft.time} onChange={(time) => onDraftChange({ time })} />
          </FieldRow>
          <FieldRow label="Size">
            <SegmentedChoice
              axis="size"
              active={draft.size}
              onChange={(size) => onDraftChange({ size: size as MealDraft['size'] })}
            />
          </FieldRow>
          <FieldRow label="Kind">
            <SegmentedChoice
              axis="kind"
              active={draft.kind}
              onChange={(kind) => onDraftChange({ kind: kind as MealDraft['kind'] })}
            />
          </FieldRow>
          <FieldRow label="Source">
            <SegmentedChoice
              axis="source"
              active={draft.source}
              onChange={(source) => onDraftChange({ source: source as MealDraft['source'] })}
            />
          </FieldRow>
          <FieldRow label="Photo">
            <PhotoRow value={photoFile} onChange={setPhotoFile} />
          </FieldRow>

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
              <HungerSection
                before={draft.hungerBefore}
                after={draft.hungerAfter}
                onChangeBefore={(hungerBefore) => onDraftChange({ hungerBefore })}
                onChangeAfter={(hungerAfter) => onDraftChange({ hungerAfter })}
              />
              <TagsSection
                selected={[...draft.tags, ...draft.customTags]}
                customTags={draft.customTags}
                onToggle={(key, isSuggested) => (isSuggested ? toggleTag(key) : toggleCustomTag(key))}
                onAddCustom={addCustomTag}
              />
              <div>
                <div className="t-label mb-2 text-muted">Notes</div>
                <NotesRow value={draft.notes} onChange={(notes) => onDraftChange({ notes })} />
              </div>
            </div>
          </MoreDetails>
        </div>
      </div>

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
          onClick={save}
          className="hill-btn flex min-h-11 flex-1 items-center justify-center bg-fg px-4 text-sm uppercase tracking-wider text-bg transition-colors hover:bg-fg/85 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save meal'}
        </button>
      </div>
    </>
  );
}
