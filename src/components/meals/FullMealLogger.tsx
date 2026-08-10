import { useState } from 'react';
import { toast } from '@/lib/toast';
import { track } from '@/lib/analytics';
import { createMealLog } from '@/lib/queries';
import { uploadMealPhoto } from '@/lib/mealPhoto';
import { draftFor, toInput, type MealDraft } from '@/lib/mealDraft';
import {
  FieldRow,
  HungerSection,
  NotesRow,
  PhotoRow,
  SegmentedChoice,
  TagsSection,
  TimeRow,
} from '@/components/meals/MealFields';

// Dedicated page (docs/MEAL_LOGGING.md §10.5), not a modal — opened by the
// drawer's secondary button. Same MealDraft state and the exact same §10.1
// field components as MealDrawer; zero duplicated field code. Every field is
// shown flat except Hunger, which stays its own collapsible.
export default function FullMealLogger() {
  const [draft, setDraft] = useState<MealDraft>(() => draftFor({ kind: 'custom' }));
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = (p: Partial<MealDraft>) => setDraft((d) => ({ ...d, ...p }));

  const toggleTag = (key: string, isSuggested: boolean) => {
    if (isSuggested) {
      patch({ tags: draft.tags.includes(key) ? draft.tags.filter((t) => t !== key) : [...draft.tags, key] });
    } else {
      patch({
        customTags: draft.customTags.includes(key)
          ? draft.customTags.filter((t) => t !== key)
          : [...draft.customTags, key],
      });
    }
  };
  const addCustomTag = (tag: string) => {
    if (draft.customTags.includes(tag)) return;
    patch({ customTags: [...draft.customTags, tag] });
  };

  async function save() {
    setSaving(true);
    let photoPath: string | null = null;
    let photoFailed = false;
    if (photoFile) {
      photoPath = await uploadMealPhoto(photoFile);
      if (photoPath === null) photoFailed = true;
    }
    const created = await createMealLog(toInput(draft, photoPath));
    setSaving(false);
    if (!created) {
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
    toast(photoFailed ? 'Meal saved — photo did not upload' : 'Meal saved', photoFailed ? 'error' : 'success');
    window.location.href = '/app';
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col px-4 sm:px-6 py-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <a
          href="/app"
          className="t-control -ml-2 flex min-h-11 items-center px-2 text-muted transition-colors hover:text-fg"
        >
          ← Back
        </a>
        <div className="text-center">
          <div className="font-display text-sm uppercase tracking-[0.04em] text-fg">Log a meal</div>
          <div className="t-label text-muted">Full logger</div>
        </div>
        <span className="w-11" aria-hidden />
      </div>

      <div className="flex flex-col gap-4">
        <FieldRow label="Time">
          <TimeRow value={draft.time} onChange={(time) => patch({ time })} />
        </FieldRow>
        <FieldRow label="Size">
          <SegmentedChoice axis="size" active={draft.size} onChange={(size) => patch({ size: size as MealDraft['size'] })} />
        </FieldRow>
        <FieldRow label="Kind">
          <SegmentedChoice axis="kind" active={draft.kind} onChange={(kind) => patch({ kind: kind as MealDraft['kind'] })} />
        </FieldRow>
        <FieldRow label="Source">
          <SegmentedChoice
            axis="source"
            active={draft.source}
            onChange={(source) => patch({ source: source as MealDraft['source'] })}
          />
        </FieldRow>
        <FieldRow label="Photo">
          <PhotoRow value={photoFile} onChange={setPhotoFile} />
        </FieldRow>
        <FieldRow label="Date">
          <input
            type="date"
            value={draft.date}
            onChange={(e) => patch({ date: e.target.value })}
            aria-label="Date eaten"
            className="min-h-11 w-full rounded-control border border-border bg-surface px-3 tabular-nums text-fg outline-none focus:border-subtle"
          />
        </FieldRow>

        <HungerSection
          before={draft.hungerBefore}
          after={draft.hungerAfter}
          onChangeBefore={(hungerBefore) => patch({ hungerBefore })}
          onChangeAfter={(hungerAfter) => patch({ hungerAfter })}
        />

        <TagsSection
          selected={[...draft.tags, ...draft.customTags]}
          customTags={draft.customTags}
          onToggle={toggleTag}
          onAddCustom={addCustomTag}
        />

        <div>
          <div className="t-label mb-2 text-muted">Notes</div>
          <NotesRow value={draft.notes} onChange={(notes) => patch({ notes })} />
        </div>
      </div>

      {/* Sticky against [data-scroll-root], NOT the viewport — the Logger's
          Finish-bar pattern (docs/LESSONS.md § "The bottom bar detaches…").
          App.astro's shell moves scrolling into that inner element, so this
          sticks to a real element whose bottom edge cannot lag behind iOS
          Safari's retracting address bar. */}
      <div className="pb-safe sticky bottom-0 -mx-4 mt-6 border-t border-border bg-bg px-4 pt-3 pointer-fine:bg-bg/95 pointer-fine:backdrop-blur sm:-mx-6 sm:px-6">
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="hill-btn mb-3 flex min-h-12 w-full items-center justify-center bg-fg px-4 text-sm uppercase tracking-wider text-bg transition-colors hover:bg-fg/85 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save meal'}
        </button>
      </div>
    </div>
  );
}
