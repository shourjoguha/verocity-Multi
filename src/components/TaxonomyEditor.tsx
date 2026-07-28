import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/primitives';
import {
  MODALITY_KEYS,
  MOVEMENT_MODALITIES,
  MOVEMENT_PLANES,
  MUSCLE_REGIONS,
  MUSCLE_REGION_KEYS,
  PLANE_KEYS,
  ROTARY_ROLES,
  type ModalityKey,
  type MovementProfile,
  type PlaneKey,
  type RegionKey,
  type RotaryRole,
} from '@/app.config';

// Corrects what the static rules in lib/movementTaxonomy.ts got wrong — or
// could not get at all, as with the truncated "Wtd". The user picks regions,
// never weights: a primary alone is 100%, a primary plus a secondary is 65/35.
// Typing a number here would be a worse question than the one being answered.
const PRIMARY_SHARE = 0.65;

const selectClass =
  'min-h-11 w-full border border-border bg-surface px-3 text-base text-fg outline-none focus:border-subtle';

export interface TaxonomyDraft {
  primary: RegionKey | '';
  secondary: RegionKey | '';
  modality: ModalityKey;
  plane: PlaneKey;
  rotary: RotaryRole | '';
  systemic: boolean;
}

export function emptyTaxonomyDraft(): TaxonomyDraft {
  return {
    primary: '',
    secondary: '',
    modality: 'resistance',
    plane: 'sagittal',
    rotary: '',
    systemic: false,
  };
}

export function draftFromProfile(p?: Partial<MovementProfile> | null): TaxonomyDraft {
  const base = emptyTaxonomyDraft();
  if (!p) return base;
  const regions = Object.entries(p.regions ?? {}).sort((a, b) => b[1] - a[1]);
  const planes = Object.entries(p.planes ?? {}).sort((a, b) => b[1] - a[1]);
  return {
    primary: (regions[0]?.[0] as RegionKey) ?? '',
    secondary: (regions[1]?.[0] as RegionKey) ?? '',
    modality: p.modality ?? base.modality,
    plane: (planes[0]?.[0] as PlaneKey) ?? base.plane,
    rotary: p.rotary ?? '',
    systemic: p.systemic ?? false,
  };
}

export function profileFromDraft(d: TaxonomyDraft): MovementProfile | null {
  if (!d.primary) return null;
  const regions =
    d.secondary && d.secondary !== d.primary
      ? { [d.primary]: PRIMARY_SHARE, [d.secondary]: 1 - PRIMARY_SHARE }
      : { [d.primary]: 1 };
  return {
    regions,
    modality: d.modality,
    planes: { [d.plane]: 1 },
    rotary: d.rotary === '' ? null : d.rotary,
    systemic: d.systemic,
  };
}

export function TaxonomyEditor({
  open,
  movementName,
  initial,
  busy,
  onSave,
  onClose,
}: {
  open: boolean;
  movementName: string;
  initial?: Partial<MovementProfile> | null;
  busy?: boolean;
  onSave: (profile: MovementProfile) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TaxonomyDraft>(() => draftFromProfile(initial));

  // Re-seed whenever the editor is opened for a different movement.
  useEffect(() => {
    if (open) setDraft(draftFromProfile(initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, movementName]);

  const profile = profileFromDraft(draft);

  return (
    <Modal open={open} onClose={onClose} title={`Muscle map · ${movementName}`}>
      <div className="flex flex-col gap-4 overflow-y-auto p-4">
        <label className="flex flex-col gap-1">
          <span className="t-label text-muted">Primary region</span>
          <select
            className={selectClass}
            value={draft.primary}
            onChange={(e) => setDraft({ ...draft, primary: e.target.value as RegionKey | '' })}
          >
            <option value="">Choose a region…</option>
            {MUSCLE_REGION_KEYS.map((k) => (
              <option key={k} value={k}>
                {MUSCLE_REGIONS[k].label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-label text-muted">Secondary region (optional)</span>
          <select
            className={selectClass}
            value={draft.secondary}
            onChange={(e) => setDraft({ ...draft, secondary: e.target.value as RegionKey | '' })}
          >
            <option value="">None</option>
            {MUSCLE_REGION_KEYS.filter((k) => k !== draft.primary).map((k) => (
              <option key={k} value={k}>
                {MUSCLE_REGIONS[k].label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-label text-muted">Modality</span>
          <select
            className={selectClass}
            value={draft.modality}
            onChange={(e) => setDraft({ ...draft, modality: e.target.value as ModalityKey })}
          >
            {MODALITY_KEYS.map((k) => (
              <option key={k} value={k}>
                {MOVEMENT_MODALITIES[k].label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-label text-muted">Plane of motion</span>
          <select
            className={selectClass}
            value={draft.plane}
            onChange={(e) => setDraft({ ...draft, plane: e.target.value as PlaneKey })}
          >
            {PLANE_KEYS.map((k) => (
              <option key={k} value={k}>
                {MOVEMENT_PLANES[k].label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-label text-muted">Rotary role</span>
          <select
            className={selectClass}
            value={draft.rotary}
            onChange={(e) => setDraft({ ...draft, rotary: e.target.value as RotaryRole | '' })}
          >
            <option value="">None</option>
            {(['rotational', 'antiRotational'] as const).map((k) => (
              <option key={k} value={k}>
                {ROTARY_ROLES[k].label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-h-11 items-center gap-3 text-sm text-subtle">
          <input
            type="checkbox"
            checked={draft.systemic}
            onChange={(e) => setDraft({ ...draft, systemic: e.target.checked })}
            className="h-5 w-5 accent-[var(--color-fg)]"
          />
          Whole-body / systemic demand
        </label>
      </div>

      <div className="flex gap-3 border-t border-border p-4">
        <Button
          type="button"
          disabled={busy || !profile}
          onClick={() => profile && onSave(profile)}
        >
          Save map
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
