import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MEAL_KINDS, MEAL_SCALE, MEAL_SIZES, MEAL_SOURCES, MEAL_TAGS } from '@/app.config';
import { Disclosure } from '@/components/ui/Disclosure';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { mixKeysOrdered, normalizeTag } from '@/lib/mealDraft';
import type { MealTagMix } from '@/lib/types';

// Shared field components for meal capture, used IDENTICALLY by the quick
// drawer (MealDrawer.tsx) and the full logger (FullMealLogger.tsx) — see
// docs/MEAL_LOGGING.md §10.1. Zero field code is duplicated between the two
// surfaces; only how they're arranged (MoreDetails collapsing vs. flat) differs.

const SIZE_TABS = Object.entries(MEAL_SIZES).map(([key, v]) => ({ key, label: v.label }));
const KIND_TABS = Object.entries(MEAL_KINDS).map(([key, v]) => ({ key, label: v.label }));
const SOURCE_TABS = Object.entries(MEAL_SOURCES).map(([key, v]) => ({ key, label: v.label }));

// The condensed core row: a fixed 56px label column + a control that fills the
// rest. No label ABOVE the control — the row IS the label/value pair.
export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="t-label w-14 shrink-0 uppercase text-muted">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// Thin wrapper around the extended SegmentedTabs for the three meal axes
// (size/kind/source): value-picker semantics (`as="radiogroup"`), compact
// sizing (§0.1 — 44px hit box, tighter visual footprint than the default).
export function SegmentedChoice({
  axis,
  active,
  onChange,
}: {
  axis: 'size' | 'kind' | 'source';
  active: string;
  onChange: (key: string) => void;
}) {
  const tabs = axis === 'size' ? SIZE_TABS : axis === 'kind' ? KIND_TABS : SOURCE_TABS;
  const label = axis === 'size' ? 'Size' : axis === 'kind' ? 'Kind' : 'Source';
  return (
    <SegmentedTabs
      tabs={tabs}
      active={active}
      onChange={onChange}
      as="radiogroup"
      size="compact"
      ariaLabel={label}
    />
  );
}

// Native time input — on iOS Safari this IS the scrollable wheel, drawn by
// the OS. Do not build a custom one (docs/MEAL_LOGGING.md explicitly rules
// this out).
export function TimeRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Time eaten"
      className="min-h-11 w-full rounded-control border border-border bg-surface px-3 tabular-nums text-fg outline-none focus:border-subtle"
    />
  );
}

// "Add picture" — hidden file input behind a button (the PlanUpload.tsx /
// GarminPanel.tsx pattern). No `capture` attribute: that forces the camera and
// removes "Photo Library" from the iOS action sheet.
export function PhotoRow({
  value,
  onChange,
}: {
  value: File | null;
  onChange: (file: File | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Revoke the previous blob: URL on replace and on unmount, or every pick leaks.
  useEffect(() => {
    if (!value) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(value);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  return (
    <div className="flex items-center gap-3">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="hidden"
      />
      {value && previewUrl ? (
        <>
          <img
            src={previewUrl}
            alt=""
            className="h-11 w-11 shrink-0 rounded-control border border-border object-cover"
          />
          <span className="min-w-0 flex-1 truncate text-sm text-fg">Photo added</span>
          <button
            type="button"
            aria-label="Remove photo"
            onClick={() => onChange(null)}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center text-muted transition-colors hover:text-fg"
          >
            <span aria-hidden>✕</span>
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="hill-btn flex min-h-11 items-center border border-border bg-surface px-3 t-control text-fg transition-colors hover:border-fg"
        >
          Add picture
        </button>
      )}
    </div>
  );
}

// Nested collapsible (its own Disclosure, inside MoreDetails). Two 1-5
// sliders, defaults 4/1. Range inputs are natively keyboard-accessible —
// arrow keys must not be intercepted.
export function HungerSection({
  before,
  after,
  onChangeBefore,
  onChangeAfter,
}: {
  before: number;
  after: number;
  onChangeBefore: (v: number) => void;
  onChangeAfter: (v: number) => void;
}) {
  return (
    <Disclosure title="Hunger" headerRight={`Before ${before} · After ${after}`}>
      <div className="flex flex-col gap-4">
        <HungerSlider label="Hunger before eating" value={before} onChange={onChangeBefore} />
        <HungerSlider label="Hunger after eating" value={after} onChange={onChangeAfter} />
      </div>
    </Disclosure>
  );
}

function HungerSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const listId = `hunger-marks-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={MEAL_SCALE.min}
        max={MEAL_SCALE.max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        list={listId}
        aria-label={label}
        className="min-h-11 flex-1"
      />
      <datalist id={listId}>
        {Array.from({ length: MEAL_SCALE.max - MEAL_SCALE.min + 1 }, (_, i) => (
          <option key={i} value={MEAL_SCALE.min + i} />
        ))}
      </datalist>
      <span className="w-4 shrink-0 text-right tabular-nums text-fg">{value}</span>
    </div>
  );
}

// Suggested chips (MEAL_TAGS) + the user's custom tags, all toggleable.
// Selected -> teal accent; a new custom tag is selected immediately on add.
export function TagsSection({
  selected,
  customTags,
  onToggle,
  onAddCustom,
}: {
  selected: string[];
  customTags: string[];
  // `isSuggested` tells the caller which of the two persisted arrays (draft's
  // `tags` vs. `customTags`) to flip — TagsSection itself is the one place
  // that knows a chip's origin (it built the row from MEAL_TAGS + customTags).
  onToggle: (key: string, isSuggested: boolean) => void;
  onAddCustom: (tag: string) => void;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const norm = normalizeTag(draft);
    setDraft('');
    if (!norm) return;
    onAddCustom(norm);
  };

  const allChips = [...MEAL_TAGS.map((t) => t.key), ...customTags.filter((t) => !MEAL_TAGS.some((m) => m.key === t))];

  return (
    <div>
      <div className="t-label mb-2 text-muted">Tags · optional</div>
      <div className="flex flex-wrap gap-2">
        {allChips.map((key) => {
          const preset = MEAL_TAGS.find((t) => t.key === key);
          const on = selected.includes(key);
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(key, !!preset)}
              className={`hill-btn flex min-h-11 items-center rounded-chip border px-3 t-control transition-colors ${
                on ? 'border-teal text-teal' : 'border-border bg-surface text-muted'
              }`}
            >
              {preset?.label ?? key}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Prevents the drawer's form (if any) from submitting on Enter.
              e.preventDefault();
              add();
            }
          }}
          placeholder="Custom tag"
          aria-label="Add a custom tag"
          className="min-h-11 min-w-0 flex-1 rounded-control border border-border bg-surface px-3 text-sm text-fg outline-none placeholder:text-muted focus:border-subtle"
        />
        <button
          type="button"
          onClick={add}
          className="hill-btn flex min-h-11 shrink-0 items-center border border-border bg-surface px-3 t-control text-fg transition-colors hover:border-fg"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// Composition sliders, one per selected tag, sharing 100%. The last tag (in
// mixKeysOrdered) is the balancer: its slider is read-only and always shows
// 100 minus the rest, so dragging the first n-1 is all it takes. Rendered only
// when two or more tags participate — a single tag is trivially 100%.
export function MacroMixSection({
  mix,
  onChange,
}: {
  mix: MealTagMix;
  onChange: (key: string, value: number) => void;
}) {
  const keys = mixKeysOrdered(mix);
  if (keys.length < 2) return null;
  const balancer = keys[keys.length - 1];
  const label = (key: string) => MEAL_TAGS.find((t) => t.key === key)?.label ?? key;

  return (
    <div>
      <div className="t-label mb-2 text-muted">Composition · sums to 100%</div>
      <div className="flex flex-col gap-3">
        {keys.map((key) => {
          const isBalancer = key === balancer;
          return (
            <div key={key} className="flex items-center gap-3">
              <span className="t-label w-16 shrink-0 truncate capitalize text-muted">{label(key)}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={mix[key] ?? 0}
                disabled={isBalancer}
                onChange={(e) => onChange(key, Number(e.target.value))}
                aria-label={`${label(key)} percent${isBalancer ? ' (auto-balanced)' : ''}`}
                className="min-h-11 min-w-0 flex-1 disabled:opacity-50"
              />
              <span className="w-9 shrink-0 text-right tabular-nums text-fg">{mix[key] ?? 0}%</span>
            </div>
          );
        })}
      </div>
      <div className="t-label mt-1.5 text-faint">
        <span className="capitalize">{label(balancer)}</span> balances the rest to 100%
      </div>
    </div>
  );
}

export function NotesRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
      placeholder="Anything worth remembering?"
      className="w-full resize-none rounded-control border border-border bg-surface p-3 text-sm text-fg outline-none placeholder:text-muted focus:border-subtle"
    />
  );
}

// Full-width utility row, collapsed on EVERY open. No defaultOpen, no hoisted
// state, no key that could keep it open across drawer re-opens — Modal
// unmounts its children on close, so this resets for free as long as nothing
// here fights that.
export function MoreDetails({ children }: { children: ReactNode }) {
  return <Disclosure title="More details">{children}</Disclosure>;
}
