import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  MEAL_CARB_FIBRE_LABELS,
  MEAL_CARB_FIBRE_STEPS,
  MEAL_KINDS,
  MEAL_MACRO_TAGS,
  MEAL_MIX_STEP,
  MEAL_PRESET_NAME_MAX,
  MEAL_SCALE,
  MEAL_SIZES,
  MEAL_SOURCES,
  MEAL_TAGS,
} from '@/app.config';
import { Disclosure } from '@/components/ui/Disclosure';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { MACRO_FILL } from '@/components/meals/MacroStack';
import { macrosIn, moveDivider, placeholderMix, toggleTag, type MealDraft } from '@/lib/mealDraft';
import type { MacroKey } from '@/lib/mealInsights';
import type { MealPreset, MealTagMix } from '@/lib/types';

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

// A toggle chip. Monochrome on purpose: a selected chip is chrome, not data.
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`hill-btn flex min-h-11 shrink-0 items-center rounded-chip border px-3 t-control transition-colors ${
        on ? 'border-fg bg-elevated text-fg' : 'border-border bg-surface text-muted hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

const tagLabel = (key: string) => MEAL_TAGS.find((t) => t.key === key)?.label ?? key;

// "Start from": the saved meals, as chips. Tapping the active one again goes
// back to a plain draft. Scrolls sideways rather than wrapping, so a long list
// never pushes the form down.
export function StartFromRow({
  presets,
  activeId,
  onPick,
}: {
  presets: MealPreset[];
  activeId: string | null;
  onPick: (preset: MealPreset) => void;
}) {
  if (presets.length === 0) return null;
  return (
    <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto overscroll-x-contain px-1">
      {presets.map((p) => (
        <Chip key={p.id} on={p.id === activeId} onClick={() => onPick(p)}>
          <span className="max-w-[12rem] truncate">{p.name}</span>
        </Chip>
      ))}
    </div>
  );
}

// The macros (P/C/F) — the only tags that enter the split.
export function MacrosRow({ tags, onToggle }: { tags: string[]; onToggle: (key: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {MEAL_MACRO_TAGS.map((k) => (
        <Chip key={k} on={tags.includes(k)} onClick={() => onToggle(k)}>
          {tagLabel(k)}
        </Chip>
      ))}
    </div>
  );
}

// Yes/no extras (sweet, coffee): every vocabulary tag that is not a macro.
export function ExtrasRow({ tags, onToggle }: { tags: string[]; onToggle: (key: string) => void }) {
  const extras = MEAL_TAGS.filter((t) => !(MEAL_MACRO_TAGS as readonly string[]).includes(t.key));
  return (
    <div className="flex flex-wrap gap-1.5">
      {extras.map((t) => (
        <Chip key={t.key} on={tags.includes(t.key)} onClick={() => onToggle(t.key)}>
          {t.label}
        </Chip>
      ))}
    </div>
  );
}

const ABBR: Record<MacroKey, string> = { protein: 'P', carbs: 'C', fat: 'F' };
// Text on each step of the ramp: the two darker steps (light theme) / lighter
// steps (dark theme) take the page colour, fat takes ink.
const ON_FILL: Record<MacroKey, string> = { protein: 'text-bg', carbs: 'text-bg', fat: 'text-fg' };

/**
 * The macro split as ONE bar with draggable dividers, replacing a slider per
 * tag. Until the athlete moves a divider the bar is a dashed even placeholder
 * and nothing is saved (`mix` stays null) — a seeded split nobody touched
 * would read as a measurement.
 *
 * Each divider is a role="slider" (arrow keys step by MEAL_MIX_STEP) with a
 * 44px hit box over a 26px bar. Not a <button>, so it is not a second Save.
 * The fibrous share of carbs shows as a hatch inside the carbs segment.
 */
export function SplitBar({
  macros,
  mix,
  fibrePct,
  onChange,
  onClear,
}: {
  macros: MacroKey[];
  mix: MealTagMix | null;
  fibrePct: number | null;
  onChange: (mix: MealTagMix) => void;
  onClear: () => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const isSet = mix !== null;
  const shown = mix ?? placeholderMix(macros);

  const move = (index: number, position: number) => onChange(moveDivider(shown, macros, index, position));

  const onPointerDown = (index: number) => (e: ReactPointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const toPosition = (clientX: number) => {
      const r = barRef.current?.getBoundingClientRect();
      return r ? ((clientX - r.left) / r.width) * 100 : 0;
    };
    // Track the live mix locally: each move derives from the last one, not
    // from the render-time `shown`, which is stale until the parent re-renders.
    let current = shown;
    const onMove = (ev: PointerEvent) => {
      current = moveDivider(current, macros, index, toPosition(ev.clientX));
      onChange(current);
    };
    const stop = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  };

  let cum = 0;
  const boundaries = macros.slice(0, -1).map((k) => (cum += shown[k] ?? 0));

  return (
    <div className="flex flex-col gap-1">
      <div ref={barRef} className="relative flex h-11 touch-none select-none items-center">
        <div className="flex h-[26px] w-full">
          {macros.map((k, i) => (
            <div
              key={k}
              className={`relative flex min-w-0 items-center justify-center overflow-hidden text-[11px] font-bold tabular-nums ${
                i === 0 ? 'rounded-l-[3px]' : ''
              } ${i === macros.length - 1 ? 'rounded-r-[3px]' : ''} ${
                isSet ? `${MACRO_FILL[k]} ${ON_FILL[k]}` : `border border-dashed border-muted text-muted ${i > 0 ? 'border-l-0' : ''}`
              }`}
              style={{ width: `${shown[k] ?? 0}%` }}
            >
              {isSet && k === 'carbs' && fibrePct ? (
                <span aria-hidden className="absolute inset-y-0 right-0 bg-surface/70" style={{ width: `${fibrePct}%` }}>
                  <span className="macro-hatch absolute inset-0" />
                </span>
              ) : null}
              {/* Backed by the segment's own fill so the label stays legible over the hatch. */}
              <span className={`relative rounded-[2px] px-1 ${isSet ? MACRO_FILL[k] : ''}`}>
                {(shown[k] ?? 0) >= 12 ? `${ABBR[k]} ${shown[k]}` : ABBR[k]}
              </span>
            </div>
          ))}
        </div>
        {boundaries.map((pos, i) => (
          <span
            key={macros[i]}
            role="slider"
            tabIndex={0}
            aria-label={`Divider between ${tagLabel(macros[i])} and ${tagLabel(macros[i + 1])}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pos}
            aria-valuetext={macros.map((k) => `${tagLabel(k)} ${shown[k] ?? 0}%`).join(', ')}
            onPointerDown={onPointerDown(i)}
            onKeyDown={(e) => {
              const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
              if (!d) return;
              e.preventDefault();
              move(i, pos + d * MEAL_MIX_STEP);
            }}
            className="group absolute inset-y-0 -ml-[22px] flex w-11 cursor-ew-resize justify-center focus-visible:outline-none"
            style={{ left: `${pos}%` }}
          >
            <span className="my-[5px] w-[3px] rounded-full border border-fg bg-surface group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:[outline-color:var(--color-focus)]" />
          </span>
        ))}
      </div>
      <div className="flex justify-between gap-3 text-[11px] text-faint">
        <span>{isSet ? 'Drag a divider to adjust.' : 'Not set. Drag a divider to set it.'}</span>
        {isSet ? (
          <button type="button" onClick={onClear} className="-my-3 -mr-2 min-h-11 min-w-11 px-2 text-muted underline hover:text-fg">
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

const FIBRE_TABS = MEAL_CARB_FIBRE_STEPS.map((v) => ({ key: String(v), label: MEAL_CARB_FIBRE_LABELS[v] }));

function fibreHint(pct: number | null): string {
  if (pct === null) return 'Not set. How much of the carbs was fibrous?';
  if (pct === 0) return 'All starchy: rice, pasta, bread, potato.';
  if (pct === 100) return 'All fibrous: veg, fruit, legumes, nuts.';
  return `${MEAL_CARB_FIBRE_LABELS[pct as keyof typeof MEAL_CARB_FIBRE_LABELS]} fibrous (veg, fruit, legumes, nuts), the rest starchy.`;
}

// "Carbs from": the share of the carbs that was fibrous, in quarters. Rendered
// ONLY when carbs are in the meal — a share of no carbs means nothing. Tapping
// the selected step again clears it back to "not set".
export function CarbsFromRow({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <SegmentedTabs
        tabs={FIBRE_TABS}
        active={value === null ? '' : String(value)}
        onChange={(key) => onChange(String(value) === key ? null : Number(key))}
        as="radiogroup"
        size="compact"
        ariaLabel="Share of carbs from fibrous sources"
      />
      <span className="text-[11px] text-faint">{fibreHint(value)}</span>
    </div>
  );
}

// "Save as a saved meal": a switch, and a name field once it is on.
export function SaveAsPresetRow({
  on,
  name,
  onToggle,
  onName,
}: {
  on: boolean;
  name: string;
  onToggle: () => void;
  onName: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={onToggle}
        className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
      >
        <span className="t-label uppercase text-muted">Save as a saved meal</span>
        <span
          aria-hidden
          className={`relative h-[18px] w-8 shrink-0 rounded-full border transition-colors ${
            on ? 'border-fg bg-fg' : 'border-border bg-elevated'
          }`}
        >
          <span
            className={`absolute top-[2px] h-3 w-3 rounded-full transition-[left] ${on ? 'left-[16px] bg-bg' : 'left-[2px] bg-muted'}`}
          />
        </span>
      </button>
      {on ? <PresetNameInput value={name} onChange={onName} placeholder="Name, e.g. Chicken rice bowl" /> : null}
    </div>
  );
}

export function PresetNameInput({
  value,
  onChange,
  placeholder = 'e.g. Oats',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      maxLength={MEAL_PRESET_NAME_MAX}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label="Saved meal name"
      className="min-h-11 w-full rounded-control border border-border bg-surface px-3 text-sm text-fg outline-none placeholder:text-muted focus:border-subtle"
    />
  );
}

// Macros, then the split bar (2+ macros), then "Carbs from" (only with carbs).
// Shared by the quick drawer, the full logger and the saved-meal editor, so
// the three can never disagree about what a meal's composition is.
export function CompositionFields({ draft, onChange }: { draft: MealDraft; onChange: (next: MealDraft) => void }) {
  const macros = macrosIn(draft.tags);
  return (
    <>
      <FieldRow label="Macros">
        <MacrosRow tags={draft.tags} onToggle={(key) => onChange(toggleTag(draft, key))} />
      </FieldRow>
      {macros.length >= 2 ? (
        <FieldRow label="Split">
          <SplitBar
            macros={macros}
            mix={draft.tagMix}
            fibrePct={draft.carbFibrePct}
            onChange={(tagMix) => onChange({ ...draft, tagMix })}
            onClear={() => onChange({ ...draft, tagMix: null })}
          />
        </FieldRow>
      ) : macros.length === 1 ? (
        <FieldRow label="Split">
          <span className="text-xs text-muted">{tagLabel(macros[0])} only, 100%</span>
        </FieldRow>
      ) : null}
      {draft.tags.includes('carbs') ? (
        <FieldRow label="Carbs from">
          <CarbsFromRow value={draft.carbFibrePct} onChange={(carbFibrePct) => onChange({ ...draft, carbFibrePct })} />
        </FieldRow>
      ) : null}
    </>
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
